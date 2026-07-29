use portable_pty::CommandBuilder;
use serde::Serialize;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};

pub(super) const MAX_ID_BYTES: usize = 160;
pub(super) const MAX_OWNER_ID_BYTES: usize = 16 * 1024;
pub(super) const MAX_INPUT_BYTES: usize = 4 * 1024 * 1024;
pub(super) const MAX_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;
pub(super) const MAX_COMPLETED_RUNS: usize = 512;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkbenchPtyOutput {
    pub(super) pty_id: String,
    pub(super) run_id: String,
    pub(super) sequence: u64,
    pub(super) data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkbenchPtyExit {
    pub(super) pty_id: String,
    pub(super) run_id: String,
    pub(super) exit_code: Option<u32>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchPtyIdentity {
    pub(super) pty_id: String,
    pub(super) run_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchPtyCreateResult {
    pub(super) pty_id: String,
    pub(super) run_id: String,
    pub(super) cwd: String,
    pub(super) created: bool,
    pub(super) completed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchPtySnapshot {
    pub(super) pty_id: String,
    pub(super) run_id: String,
    pub(super) sequence: u64,
    pub(super) data: String,
    pub(super) truncated: bool,
}

pub(super) struct SnapshotBuffer {
    pub(super) chunks: VecDeque<Vec<u8>>,
    pub(super) bytes: usize,
    pub(super) sequence: u64,
    pub(super) truncated: bool,
}

impl SnapshotBuffer {
    pub(super) fn new() -> Self {
        Self {
            chunks: VecDeque::new(),
            bytes: 0,
            sequence: 0,
            truncated: false,
        }
    }

    pub(super) fn push(&mut self, data: &[u8]) -> u64 {
        if data.is_empty() {
            return self.sequence;
        }
        self.chunks.push_back(data.to_vec());
        self.bytes += data.len();
        while self.bytes > MAX_SNAPSHOT_BYTES {
            let overflow = self.bytes - MAX_SNAPSHOT_BYTES;
            let Some(mut front) = self.chunks.pop_front() else {
                break;
            };
            if front.len() > overflow {
                front.drain(..overflow);
                self.bytes -= overflow;
                self.chunks.push_front(front);
            } else {
                self.bytes -= front.len();
            }
            self.truncated = true;
        }
        self.sequence = self.sequence.saturating_add(1);
        self.sequence
    }

    pub(super) fn text(&self) -> String {
        let bytes = self.chunks.iter().flatten().copied().collect::<Vec<_>>();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

pub(super) fn take_utf8_ready(bytes: &mut Vec<u8>) -> String {
    let mut output = String::new();
    loop {
        match std::str::from_utf8(bytes) {
            Ok(text) => {
                output.push_str(text);
                bytes.clear();
                return output;
            }
            Err(error) => {
                let valid_len = error.valid_up_to();
                if valid_len > 0 {
                    output.push_str(&String::from_utf8_lossy(&bytes[..valid_len]));
                }
                match error.error_len() {
                    Some(invalid_len) => {
                        output.push('\u{FFFD}');
                        bytes.drain(..valid_len + invalid_len);
                    }
                    None => {
                        bytes.drain(..valid_len);
                        return output;
                    }
                }
            }
        }
    }
}

pub(super) fn validate_value(label: &str, value: &str, max_bytes: usize) -> Result<(), String> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(format!("invalid workbench {label}"));
    }
    Ok(())
}

pub(super) fn validate_id(label: &str, value: &str) -> Result<(), String> {
    validate_value(label, value, MAX_ID_BYTES)
}

pub(super) fn resolve_cwd(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err("workbench PTY cwd is not an existing directory".into());
    }
    path.canonicalize()
        .map_err(|error| format!("resolve workbench PTY cwd: {error}"))
}

pub(super) fn shell_command(cwd: &Path) -> CommandBuilder {
    let shell = crate::platform::default_shell_command();
    let mut command = CommandBuilder::new(shell.program);
    command.args(shell.args);
    command.cwd(cwd);
    for (key, value) in crate::platform::login_shell_env() {
        command.env(key, value);
    }
    command.env("JUNQI_WORKBENCH", "1");
    command
}
