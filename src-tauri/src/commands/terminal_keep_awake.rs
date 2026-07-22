//! Real, process-scoped idle-sleep protection for terminal work.
//!
//! The renderer decides when a lease is wanted (off / auto / always). This
//! module owns the OS request and makes stopping it idempotent, so neither a
//! stale React render nor app shutdown can leave a helper process behind.

use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalKeepAwakeStatus {
    pub active: bool,
}

enum KeepAwakeLease {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    Process(std::process::Child),
    #[cfg(windows)]
    Windows(WindowsKeepAwakeLease),
}

#[cfg(windows)]
struct WindowsKeepAwakeLease {
    stop: std::sync::mpsc::Sender<()>,
}

#[derive(Default)]
struct TerminalKeepAwakeController {
    owners: HashSet<String>,
    lease: Option<KeepAwakeLease>,
}

impl TerminalKeepAwakeController {
    fn is_active(&self) -> bool {
        self.lease.is_some()
    }

    fn set_owner_active(&mut self, owner_id: String, requested: bool) -> Result<bool, String> {
        if requested {
            self.owners.insert(owner_id);
        } else {
            self.owners.remove(&owner_id);
        }
        if self.owners.is_empty() {
            self.release();
        } else if self.lease.is_none() {
            self.lease = Some(acquire_keep_awake_lease()?);
        }
        Ok(self.is_active())
    }

    fn release(&mut self) {
        let Some(lease) = self.lease.take() else {
            return;
        };
        match lease {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            KeepAwakeLease::Process(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(windows)]
            KeepAwakeLease::Windows(lease) => {
                let _ = lease.stop.send(());
            }
        }
    }

    fn shutdown(&mut self) {
        self.owners.clear();
        self.release();
    }
}

fn controller() -> &'static Mutex<TerminalKeepAwakeController> {
    static CONTROLLER: OnceLock<Mutex<TerminalKeepAwakeController>> = OnceLock::new();
    CONTROLLER.get_or_init(|| Mutex::new(TerminalKeepAwakeController::default()))
}

fn normalize_owner_id(value: &str) -> Result<String, String> {
    let owner = value.trim();
    if owner.is_empty() || owner.len() > 128 {
        return Err("invalid terminal keep-awake owner".to_string());
    }
    if !owner
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
    {
        return Err("invalid terminal keep-awake owner".to_string());
    }
    Ok(owner.to_string())
}

#[cfg(target_os = "macos")]
fn macos_caffeinate_command(parent_pid: u32) -> std::process::Command {
    use std::process::{Command, Stdio};

    // `-i` blocks idle system sleep but deliberately leaves display sleep to
    // macOS. `-w` ties the assertion to this app process even after a crash.
    let pid = parent_pid.to_string();
    let mut command = Command::new("/usr/bin/caffeinate");
    command
        .args(["-i", "-w", pid.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

#[cfg(target_os = "macos")]
fn acquire_keep_awake_lease() -> Result<KeepAwakeLease, String> {
    let child = macos_caffeinate_command(std::process::id())
        .spawn()
        .map_err(|error| format!("start macOS keep-awake assertion: {error}"))?;
    Ok(KeepAwakeLease::Process(child))
}

#[cfg(target_os = "linux")]
fn acquire_keep_awake_lease() -> Result<KeepAwakeLease, String> {
    use std::process::{Command, Stdio};

    let program = crate::platform::detect_path("systemd-inhibit");
    if program.trim().is_empty() {
        return Err("systemd-inhibit is unavailable on this Linux system".to_string());
    }
    let child = Command::new(program)
        .args([
            "--what=idle:sleep",
            "--mode=block",
            "--why=JunQi terminal agent or SSH session",
            "sleep",
            "2147483647",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("start Linux keep-awake inhibitor: {error}"))?;
    Ok(KeepAwakeLease::Process(child))
}

#[cfg(windows)]
fn acquire_keep_awake_lease() -> Result<KeepAwakeLease, String> {
    use std::sync::mpsc::{sync_channel, RecvTimeoutError};
    use std::thread;
    use std::time::Duration;
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED,
    };

    let (stop_tx, stop_rx) = std::sync::mpsc::channel::<()>();
    let (ready_tx, ready_rx) = sync_channel::<bool>(1);
    thread::Builder::new()
        .name("junqi-terminal-keep-awake".to_string())
        .spawn(move || {
            let applied =
                unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) } != 0;
            let _ = ready_tx.send(applied);
            if !applied {
                return;
            }
            loop {
                match stop_rx.recv_timeout(Duration::from_secs(25)) {
                    Ok(()) | Err(RecvTimeoutError::Disconnected) => {
                        unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
                        return;
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        // Refresh on the same dedicated OS thread that owns
                        // the request; this survives Tauri worker scheduling.
                        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
                    }
                }
            }
        })
        .map_err(|error| format!("start Windows keep-awake worker: {error}"))?;

    match ready_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(true) => Ok(KeepAwakeLease::Windows(WindowsKeepAwakeLease {
            stop: stop_tx,
        })),
        Ok(false) => Err("Windows rejected the keep-awake request".to_string()),
        Err(error) => Err(format!("wait for Windows keep-awake worker: {error}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn acquire_keep_awake_lease() -> Result<KeepAwakeLease, String> {
    Err("keep-awake is unsupported on this platform".to_string())
}

/// Apply one terminal window's sleep-protection requirement. The frontend
/// supplies only its validated owner id and a boolean, never an executable,
/// assertion type, or arbitrary OS command.
#[tauri::command]
pub async fn set_terminal_keep_awake(
    active: bool,
    owner_id: String,
) -> Result<TerminalKeepAwakeStatus, String> {
    tokio::task::spawn_blocking(move || {
        let owner_id = normalize_owner_id(&owner_id)?;
        let mut state = controller()
            .lock()
            .map_err(|_| "terminal keep-awake state lock poisoned".to_string())?;
        let active = state.set_owner_active(owner_id, active)?;
        Ok(TerminalKeepAwakeStatus { active })
    })
    .await
    .map_err(|error| format!("terminal keep-awake task failed: {error}"))?
}

/// Best-effort process cleanup for Tauri's synchronous shutdown callback.
pub fn shutdown() {
    if let Ok(mut state) = controller().lock() {
        state.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_owner_id, TerminalKeepAwakeController};

    #[test]
    fn a_new_controller_holds_no_system_lease() {
        assert!(!TerminalKeepAwakeController::default().is_active());
    }

    #[test]
    fn keep_awake_owner_ids_are_bounded_and_non_shell_like() {
        assert_eq!(
            normalize_owner_id("terminal:main").as_deref(),
            Ok("terminal:main")
        );
        assert!(normalize_owner_id("terminal main").is_err());
        assert!(normalize_owner_id("terminal;rm").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_keep_awake_uses_an_idle_sleep_assertion_tied_to_the_app() {
        use super::macos_caffeinate_command;

        let command = macos_caffeinate_command(42);
        assert_eq!(
            command.get_program().to_string_lossy(),
            "/usr/bin/caffeinate"
        );
        assert_eq!(
            command
                .get_args()
                .map(|argument| argument.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
            vec!["-i", "-w", "42"],
        );
    }
}
