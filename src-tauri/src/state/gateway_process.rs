use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicU64;
use tokio::process::Child;

/// Maximum number of log entries kept in the circular buffer.
/// Matches the maxauto behaviour: small enough to ship over IPC cheaply,
/// large enough to cover a typical restart cycle's diagnostics.
pub const LOG_BUFFER_CAP: usize = 200;

/// Canonical gateway lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewayLifecycle {
    Stopped,
    Starting,
    Running,
    Error,
    Reconnecting,
}

/// The runtime currently serving the configured Gateway endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewayRuntimeMode {
    None,
    External,
    SystemService,
    ManagedChild,
    Docker,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogSource {
    /// stdout from our managed child (native gateway).
    ChildStdout,
    /// stderr from our managed child.
    ChildStderr,
    /// stdout from `docker logs -f`.
    DockerStdout,
    /// stderr from `docker logs -f`.
    DockerStderr,
    /// Synthetic events from the desktop app (start/stop/restart transitions).
    Lifecycle,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    /// Unix epoch milliseconds.
    pub timestamp_ms: i64,
    pub level: LogLevel,
    pub source: LogSource,
    pub message: String,
}

pub struct GatewayProcess {
    pub child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
    /// True while a real `openclaw gateway restart` is in progress.
    /// While set, `gateway_status` reports `running: true` (so the frontend
    /// status poller does not see the service flap down→up and trigger a
    /// competing `start_gateway`), and `start_gateway` refuses to spawn.
    pub restarting: Mutex<bool>,
    /// Process-wide lifecycle gate. Every mutating operation (ensure, start,
    /// restart, stop, Docker switch and storage migration) must own this gate.
    pub operation_gate: Arc<tokio::sync::Mutex<()>>,
    /// Increments after every complete restart workflow, including its managed
    /// fallback. Contending restart callers use this to distinguish another
    /// restart from an unrelated lifecycle operation holding `operation_gate`.
    pub restart_completed_generation: AtomicU64,
    /// Circular buffer of recent log entries (SPEC §2.4, M6).
    /// Push path evicts the oldest entry once length exceeds LOG_BUFFER_CAP.
    pub logs: Mutex<VecDeque<LogEntry>>,
    /// Canonical lifecycle state machine.
    pub lifecycle: Mutex<GatewayLifecycle>,
    /// Canonical owner/runtime mode for the configured endpoint.
    pub runtime_mode: Mutex<GatewayRuntimeMode>,
}

impl GatewayProcess {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(18789),
            restarting: Mutex::new(false),
            operation_gate: Arc::new(tokio::sync::Mutex::new(())),
            restart_completed_generation: AtomicU64::new(0),
            logs: Mutex::new(VecDeque::with_capacity(LOG_BUFFER_CAP)),
            lifecycle: Mutex::new(GatewayLifecycle::Stopped),
            runtime_mode: Mutex::new(GatewayRuntimeMode::None),
        }
    }
}

#[cfg(test)]
mod operation_gate_tests {
    use super::*;

    #[tokio::test]
    async fn bug_gl01_operation_gate_has_one_global_owner() {
        let state = GatewayProcess::new();
        let owner = state.operation_gate.clone().try_lock_owned().unwrap();
        assert!(state.operation_gate.clone().try_lock_owned().is_err());
        drop(owner);
        assert!(state.operation_gate.clone().try_lock_owned().is_ok());
    }
}

/// Push a log entry into the buffer. Evicts the oldest entry if the buffer
/// is at capacity. Best-effort: a poisoned mutex is logged and skipped so
/// log capture never crashes the calling code path.
///
/// Note: callers pass `state.logs` (the Mutex<VecDeque<LogEntry>>) directly
/// to keep the lock acquisition local to this function — we never hold the
/// lock across an `.await`.
pub fn push_log(
    logs: &Mutex<VecDeque<LogEntry>>,
    source: LogSource,
    level: LogLevel,
    message: impl Into<String>,
) {
    let entry = LogEntry {
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        level,
        source,
        message: message.into(),
    };
    match logs.lock() {
        Ok(mut buf) => {
            if buf.len() >= LOG_BUFFER_CAP {
                buf.pop_front();
            }
            buf.push_back(entry);
        }
        Err(e) => {
            eprintln!("push_log: mutex poisoned: {}", e);
        }
    }
}

// ─── Tests (SPEC §T5 acceptance) ───────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn buffer_caps_at_log_buffer_cap() {
        let buf = Mutex::new(VecDeque::with_capacity(LOG_BUFFER_CAP));
        for i in 0..(LOG_BUFFER_CAP + 800) {
            push_log(
                &buf,
                LogSource::Lifecycle,
                LogLevel::Info,
                format!("entry {}", i),
            );
        }
        let len = buf.lock().unwrap().len();
        assert_eq!(
            len, LOG_BUFFER_CAP,
            "buffer length should be capped at LOG_BUFFER_CAP"
        );
    }

    #[test]
    fn buffer_evicts_oldest_first() {
        let buf = Mutex::new(VecDeque::with_capacity(LOG_BUFFER_CAP));
        // Insert 1000 entries. The buffer keeps the last 200.
        // The first kept entry must be "entry 800" (1000 - 200 = 800).
        for i in 0..1000 {
            push_log(
                &buf,
                LogSource::Lifecycle,
                LogLevel::Info,
                format!("entry {}", i),
            );
        }
        let g = buf.lock().unwrap();
        assert_eq!(g.len(), LOG_BUFFER_CAP);
        let first = g.front().expect("buffer should not be empty");
        assert_eq!(
            first.message, "entry 800",
            "oldest evicted, first kept should be 800"
        );
        let last = g.back().expect("buffer should not be empty");
        assert_eq!(last.message, "entry 999", "newest should be 999");
    }

    #[test]
    fn push_log_sets_timestamp_to_recent_unix_ms() {
        let buf = Mutex::new(VecDeque::new());
        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        push_log(&buf, LogSource::Lifecycle, LogLevel::Info, "hello");
        let after = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let g = buf.lock().unwrap();
        let entry: &LogEntry = g.front().unwrap();
        assert!(entry.timestamp_ms >= before, "timestamp must be ≥ pre-push");
        assert!(entry.timestamp_ms <= after, "timestamp must be ≤ post-push");
    }

    #[test]
    fn push_log_does_not_panic_on_poisoned_mutex() {
        // Poison the mutex by panicking inside a lock guard, then verify
        // push_log still returns cleanly. SPEC: log capture never crashes
        // the calling code path.
        let buf = Arc::new(Mutex::new(VecDeque::<LogEntry>::new()));
        let buf2 = buf.clone();
        let _ = std::thread::spawn(move || {
            let _guard = buf2.lock().unwrap();
            panic!("intentional poison");
        })
        .join();
        push_log(
            &buf,
            LogSource::Lifecycle,
            LogLevel::Info,
            "should not crash",
        );
        // No assertion — test passes if push_log returned without panicking.
    }

    #[test]
    fn log_entry_serializes_with_snake_case_enums() {
        // Frontend uses serde snake_case to deserialize.
        let entry = LogEntry {
            timestamp_ms: 1_700_000_000_000,
            level: LogLevel::Warn,
            source: LogSource::DockerStdout,
            message: "container log line".to_string(),
        };
        let json = serde_json::to_string(&entry).expect("serialize");
        assert!(
            json.contains("\"level\":\"warn\""),
            "level snake_case: {}",
            json
        );
        assert!(
            json.contains("\"source\":\"docker_stdout\""),
            "source snake_case: {}",
            json
        );
        assert!(
            json.contains("\"timestamp_ms\":1700000000000"),
            "timestamp numeric: {}",
            json
        );
    }
}
