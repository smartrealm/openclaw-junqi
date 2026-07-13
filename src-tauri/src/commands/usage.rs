use std::io::{BufRead, BufReader, Read, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, LazyLock};
use std::time::{Duration, Instant};

use chrono::DateTime;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};

const CODEX_ATTEMPT_TIMEOUT_SECS: u64 = 10;
const CLAUDE_429_BACKOFF_SECS: u64 = 300;

static CODEX_RPC: LazyLock<Arc<Mutex<Option<CodexRpcClient>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(None)));
static CLAUDE_429_UNTIL: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));

struct CodexRpcClient {
    stdin: ChildStdin,
    rx: mpsc::Receiver<Result<Value, String>>,
    child: std::process::Child,
    next_id: i64,
}

impl CodexRpcClient {
    fn spawn() -> Result<Self, String> {
        let mut command = Command::new(super::app_settings::get_agent_program("codex"));
        command
            .arg("app-server")
            .env("PATH", crate::platform::login_shell_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to start Codex app-server: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex app-server stdout unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Codex app-server stderr unavailable".to_string())?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex app-server stdin unavailable".to_string())?;

        let (tx, rx) = mpsc::channel::<Result<Value, String>>();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let message = match line {
                    Ok(line) => {
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        serde_json::from_str::<Value>(line)
                            .map_err(|error| format!("Invalid Codex app-server JSON: {error}"))
                    }
                    Err(error) => Err(format!("Failed reading Codex app-server output: {error}")),
                };
                if tx.send(message).is_err() {
                    break;
                }
            }
        });
        std::thread::spawn(move || {
            let mut output = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut output);
        });

        let deadline = Instant::now() + Duration::from_secs(CODEX_ATTEMPT_TIMEOUT_SECS);
        let handshake = (|| -> Result<(), String> {
            write_json_line(
                &mut stdin,
                &json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "clientInfo": { "name": "junqi", "version": env!("CARGO_PKG_VERSION") },
                        "capabilities": {}
                    }
                }),
            )?;
            wait_for_result(&rx, 1, deadline)?;
            write_json_line(
                &mut stdin,
                &json!({ "jsonrpc": "2.0", "method": "initialized" }),
            )
        })();

        if let Err(reason) = handshake {
            let _ = child.kill();
            let _ = child.wait();
            return Err(reason);
        }

        Ok(Self {
            stdin,
            rx,
            child,
            next_id: 2,
        })
    }

    fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn call(&mut self, method: &str, params: Value, deadline: Instant) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        write_json_line(
            &mut self.stdin,
            &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }),
        )?;
        wait_for_result(&self.rx, id, deadline)
    }
}

impl Drop for CodexRpcClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum UsageSource<T> {
    Available { data: T },
    Unavailable { reason: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageSnapshot {
    pub claude: UsageSource<ClaudeUsageData>,
    pub codex: UsageSource<CodexUsageData>,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UsageWindow {
    #[serde(rename = "usedPercent")]
    pub used_percent: u8,
    #[serde(rename = "remainingPercent")]
    pub remaining_percent: u8,
    #[serde(rename = "resetAt")]
    pub reset_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeUsageData {
    #[serde(rename = "fiveHour")]
    pub five_hour: Option<UsageWindow>,
    #[serde(rename = "sevenDay")]
    pub seven_day: Option<UsageWindow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexUsageData {
    pub email: Option<String>,
    #[serde(rename = "planType")]
    pub plan_type: Option<String>,
    pub primary: Option<UsageWindow>,
    pub secondary: Option<UsageWindow>,
}

#[tauri::command]
pub async fn read_usage_snapshot() -> Result<UsageSnapshot, String> {
    if cfg!(windows) {
        return Ok(UsageSnapshot {
            claude: unavailable("Usage insights are temporarily disabled on Windows."),
            codex: unavailable("Usage insights are temporarily disabled on Windows."),
            fetched_at: chrono::Utc::now().timestamp(),
        });
    }

    let codex_rpc = Arc::clone(&CODEX_RPC);
    let (claude, codex_result) = tokio::join!(
        read_claude_usage(),
        tokio::task::spawn_blocking(move || read_codex_usage(codex_rpc)),
    );
    let codex = match codex_result {
        Ok(source) => source,
        Err(error) => unavailable(format!("Failed to read Codex usage: {error}")),
    };

    Ok(UsageSnapshot {
        claude,
        codex,
        fetched_at: chrono::Utc::now().timestamp(),
    })
}

fn read_codex_usage(codex_rpc: Arc<Mutex<Option<CodexRpcClient>>>) -> UsageSource<CodexUsageData> {
    let mut guard = codex_rpc.lock();
    if guard.as_mut().is_some_and(|client| !client.is_alive()) {
        *guard = None;
    }
    if guard.is_none() {
        match CodexRpcClient::spawn() {
            Ok(client) => *guard = Some(client),
            Err(reason) => return unavailable(reason),
        }
    }

    let client = guard.as_mut().expect("Codex RPC client initialized");
    match attempt_codex_usage_calls(client) {
        Ok(data) => UsageSource::Available { data },
        Err(reason) => {
            *guard = None;
            unavailable(reason)
        }
    }
}

fn attempt_codex_usage_calls(client: &mut CodexRpcClient) -> Result<CodexUsageData, String> {
    let deadline = Instant::now() + Duration::from_secs(CODEX_ATTEMPT_TIMEOUT_SECS);
    let account = client.call("account/read", json!({}), deadline)?;
    let rate_limits = client
        .call("account/rateLimits/read", Value::Null, deadline)
        .or_else(|_| {
            client.call(
                "account/rateLimits/read",
                json!({}),
                Instant::now() + Duration::from_secs(CODEX_ATTEMPT_TIMEOUT_SECS),
            )
        })?;
    Ok(parse_codex_usage(account, rate_limits))
}

async fn read_claude_usage() -> UsageSource<ClaudeUsageData> {
    if let Some(until) = *CLAUDE_429_UNTIL.lock() {
        let remaining = until.saturating_duration_since(Instant::now());
        if !remaining.is_zero() {
            return unavailable(format!(
                "Claude usage rate-limited; retry in {}s.",
                remaining.as_secs()
            ));
        }
    }

    let token = match super::oauth::find_oauth_token() {
        Some(token) => Some(token),
        None => tokio::task::spawn_blocking(super::oauth::find_keychain_oauth_token)
            .await
            .ok()
            .flatten(),
    };
    let Some(token) = token else {
        return unavailable("Claude OAuth credentials are unavailable.");
    };
    let fetched = match super::oauth::fetch_claude_usage(&token).await {
        Ok(usage) => usage,
        Err(reason) => {
            if reason.contains("429") {
                *CLAUDE_429_UNTIL.lock() =
                    Some(Instant::now() + Duration::from_secs(CLAUDE_429_BACKOFF_SECS));
            }
            return unavailable(reason);
        }
    };
    let map_window = |window: super::oauth::FetchedWindow| UsageWindow {
        used_percent: percent_to_u8(window.used_percent),
        remaining_percent: percent_to_u8(window.remaining_percent),
        reset_at: window.reset_at_epoch,
    };
    let data = ClaudeUsageData {
        five_hour: fetched.claude_five_hour.map(&map_window),
        seven_day: fetched.claude_seven_day.map(map_window),
    };
    if data.five_hour.is_none() && data.seven_day.is_none() {
        unavailable("Claude usage response did not include recognized windows.")
    } else {
        UsageSource::Available { data }
    }
}

fn write_json_line(stdin: &mut dyn Write, value: &Value) -> Result<(), String> {
    let payload = serde_json::to_string(value)
        .map_err(|error| format!("Failed to serialize Codex request: {error}"))?;
    stdin
        .write_all(payload.as_bytes())
        .map_err(|error| format!("Failed writing Codex request: {error}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|error| format!("Failed writing Codex request terminator: {error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("Failed flushing Codex request: {error}"))
}

fn wait_for_result(
    rx: &mpsc::Receiver<Result<Value, String>>,
    expected_id: i64,
    deadline: Instant,
) -> Result<Value, String> {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(format!(
                "Timed out waiting for Codex response {expected_id}."
            ));
        }
        let message = rx
            .recv_timeout(remaining)
            .map_err(|_| format!("Codex app-server closed before response {expected_id}."))??;
        if message.get("id").and_then(Value::as_i64) != Some(expected_id) {
            continue;
        }
        if let Some(result) = message.get("result") {
            return Ok(result.clone());
        }
        if let Some(error) = message.get("error") {
            return Err(error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Unknown Codex app-server error")
                .to_string());
        }
        return Err(format!(
            "Codex response {expected_id} did not include result or error."
        ));
    }
}

fn parse_codex_usage(account: Value, rate_limits: Value) -> CodexUsageData {
    let account_node = account.get("account").unwrap_or(&Value::Null);
    let rate_limit_source = rate_limits
        .get("rateLimitsByLimitId")
        .and_then(Value::as_object)
        .and_then(|limits| {
            limits
                .get("codex")
                .cloned()
                .or_else(|| limits.values().next().cloned())
        })
        .or_else(|| rate_limits.get("rateLimits").cloned())
        .unwrap_or(Value::Null);

    CodexUsageData {
        email: account_node
            .get("email")
            .and_then(Value::as_str)
            .map(str::to_string),
        plan_type: account_node
            .get("planType")
            .and_then(Value::as_str)
            .map(str::to_string),
        primary: rate_limit_source
            .get("primary")
            .and_then(parse_codex_window),
        secondary: rate_limit_source
            .get("secondary")
            .and_then(parse_codex_window),
    }
}

fn parse_codex_window(value: &Value) -> Option<UsageWindow> {
    let used_percent = value.get("usedPercent").and_then(parse_percent_value)?;
    Some(UsageWindow {
        used_percent,
        remaining_percent: 100_u8.saturating_sub(used_percent),
        reset_at: value.get("resetsAt").and_then(parse_reset_value),
    })
}

fn parse_percent_value(value: &Value) -> Option<u8> {
    let raw = match value {
        Value::Number(number) => number.as_f64()?,
        Value::String(string) => string.parse::<f64>().ok()?,
        _ => return None,
    };
    let normalized = if raw <= 1.0 { raw * 100.0 } else { raw };
    Some(percent_to_u8(normalized))
}

fn percent_to_u8(value: f64) -> u8 {
    value.clamp(0.0, 100.0).round() as u8
}

fn parse_reset_value(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64(),
        Value::String(string) => string.parse::<i64>().ok().or_else(|| {
            DateTime::parse_from_rfc3339(string)
                .ok()
                .map(|date| date.timestamp())
        }),
        _ => None,
    }
}

fn unavailable<T>(reason: impl Into<String>) -> UsageSource<T> {
    UsageSource::Unavailable {
        reason: reason.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_codex_usage, parse_codex_window, read_codex_usage, UsageSource, UsageWindow,
        CODEX_RPC,
    };
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn codex_usage_parses_account_and_named_rate_limit_windows() {
        let usage = parse_codex_usage(
            json!({ "account": { "email": "dev@example.com", "planType": "plus" } }),
            json!({
                "rateLimitsByLimitId": {
                    "codex": {
                        "primary": { "usedPercent": 24, "resetsAt": 1234 },
                        "secondary": { "usedPercent": "81", "resetsAt": "2026-07-13T08:00:00Z" }
                    }
                }
            }),
        );
        assert_eq!(usage.email.as_deref(), Some("dev@example.com"));
        assert_eq!(usage.plan_type.as_deref(), Some("plus"));
        assert_eq!(usage.primary.unwrap().remaining_percent, 76);
        assert_eq!(usage.secondary.unwrap().remaining_percent, 19);
    }

    #[test]
    fn codex_window_clamps_percentages_and_accepts_fractional_values() {
        assert_eq!(
            parse_codex_window(&json!({ "usedPercent": 0.42, "resetsAt": "99" })),
            Some(UsageWindow {
                used_percent: 42,
                remaining_percent: 58,
                reset_at: Some(99),
            })
        );
        assert_eq!(
            parse_codex_window(&json!({ "usedPercent": 120 })),
            Some(UsageWindow {
                used_percent: 100,
                remaining_percent: 0,
                reset_at: None,
            })
        );
    }

    #[test]
    fn production_usage_source_contains_no_demo_snapshot() {
        let source = include_str!("usage.rs");
        let removed_mock = ["mock_", "snapshot"].concat();
        let removed_demo_account = ["demo@", "junqi.local"].concat();
        assert!(!source.contains(&removed_mock));
        assert!(!source.contains(&removed_demo_account));
        assert!(source.contains("account/rateLimits/read"));
    }

    #[test]
    #[ignore = "requires an installed and authenticated Codex CLI"]
    fn live_codex_app_server_returns_account_usage() {
        match read_codex_usage(Arc::clone(&CODEX_RPC)) {
            UsageSource::Available { data } => {
                assert!(data.primary.is_some() || data.secondary.is_some());
            }
            UsageSource::Unavailable { reason } => {
                assert!(
                    reason.contains("authentication required"),
                    "unexpected Codex app-server failure: {reason}"
                );
            }
        }
    }
}
