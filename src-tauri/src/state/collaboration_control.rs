use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, OwnedMutexGuard};

pub const BOOTSTRAP_JOURNAL_VERSION: u32 = 1;
const MAX_BOOTSTRAP_OPERATION_ID_BYTES: usize = 256;

/// Validate the identifier that is used as a directory component for all
/// bootstrap staging and recovery artifacts. Bootstrap journals are durable
/// local input, so a malformed or hand-edited journal must never be allowed to
/// turn an operation id into a path.
pub(crate) fn validate_bootstrap_operation_id(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err("Bootstrap operation id must not be empty".to_string());
    }
    if value.len() > MAX_BOOTSTRAP_OPERATION_ID_BYTES {
        return Err(format!(
            "Bootstrap operation id exceeds the {MAX_BOOTSTRAP_OPERATION_ID_BYTES}-byte limit"
        ));
    }
    if value != value.trim() {
        return Err("Bootstrap operation id must not contain surrounding whitespace".to_string());
    }
    if value == "." || value == ".." {
        return Err("Bootstrap operation id cannot be a dot path component".to_string());
    }
    if value.chars().any(char::is_control) {
        return Err("Bootstrap operation id contains control characters".to_string());
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(
            "Bootstrap operation id must contain only ASCII letters, digits, '-' or '_'"
                .to_string(),
        );
    }

    // Keep this explicit even though the byte allow-list above rejects these
    // forms. It documents and enforces the filesystem invariant on every
    // platform, including platform-specific absolute/prefix path syntax.
    let mut components = Path::new(value).components();
    if Path::new(value).is_absolute()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Err("Bootstrap operation id must be one safe relative path component".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BootstrapOperationKind {
    Apply,
    RecoverResume,
    RecoverRollback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BootstrapJournalStatus {
    Running,
    RecoveryRequired,
    Completed,
    RolledBack,
    Abandoned,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapJournalStep {
    pub name: String,
    pub status: String,
    pub at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapTargetSnapshot {
    pub target_fingerprint: String,
    pub connection_id: String,
    pub deployment_kind: String,
    pub ownership: String,
    pub gateway_version: String,
    pub binary_path: String,
    pub state_dir: String,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPackageSnapshot {
    pub source_tgz_path: String,
    pub host_tgz_path: String,
    /// Path visible to the selected CLI target (container path for Docker).
    pub tgz_path: String,
    pub sha256: String,
    pub plugin_id: String,
    pub plugin_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPluginSnapshot {
    pub installed: bool,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_record: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapHealthSnapshot {
    pub collaboration_instance_id: String,
    pub plugin_version: String,
    pub schema_version: u32,
    pub confirmed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationBootstrapJournal {
    pub version: u32,
    pub operation_id: String,
    pub operation: BootstrapOperationKind,
    pub status: BootstrapJournalStatus,
    pub target: BootstrapTargetSnapshot,
    pub package: BootstrapPackageSnapshot,
    pub original_plugin: BootstrapPluginSnapshot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_plugin_backup_tgz_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_plugin_backup_host_tgz_path: Option<String>,
    /// SHA-256 of the private rollback archive. Rollback must never resolve an
    /// npm spec or another mutable/network source in place of this archive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_plugin_backup_sha256: Option<String>,
    /// SHA-256 of the installed plugin byte tree captured before apply. This
    /// verifies that installing the rollback archive reproduced the exact
    /// package content, not merely a package with the same version string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_plugin_content_sha256: Option<String>,
    pub original_config_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_config_backup_path: Option<String>,
    /// Hash of the last config state written or observed immediately after a
    /// bootstrap-owned mutation. Missing on legacy journals, which must fail
    /// closed before rollback can overwrite configuration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bootstrap_owned_config_sha256: Option<String>,
    pub started_at_ms: i64,
    pub updated_at_ms: i64,
    pub restart_required: bool,
    pub health_pending: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<BootstrapHealthSnapshot>,
    #[serde(default)]
    pub steps: Vec<BootstrapJournalStep>,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

impl CollaborationBootstrapJournal {
    pub fn record_step(
        &mut self,
        name: impl Into<String>,
        status: impl Into<String>,
        diagnostic: Option<String>,
    ) {
        let now = chrono::Utc::now().timestamp_millis();
        self.updated_at_ms = now;
        self.steps.push(BootstrapJournalStep {
            name: name.into(),
            status: status.into(),
            at_ms: now,
            diagnostic,
        });
        if self.steps.len() > 64 {
            self.steps.drain(..self.steps.len() - 64);
        }
    }

    pub fn add_diagnostic(&mut self, diagnostic: impl Into<String>) {
        self.updated_at_ms = chrono::Utc::now().timestamp_millis();
        self.diagnostics.push(diagnostic.into());
        if self.diagnostics.len() > 32 {
            self.diagnostics.drain(..self.diagnostics.len() - 32);
        }
    }
}

pub struct CollaborationControlState {
    operation_gate: Arc<Mutex<()>>,
    journal_path: PathBuf,
}

impl CollaborationControlState {
    pub fn new() -> Self {
        Self::with_journal_path(default_journal_path())
    }

    pub fn with_journal_path(journal_path: PathBuf) -> Self {
        Self {
            operation_gate: Arc::new(Mutex::new(())),
            journal_path,
        }
    }

    pub fn try_acquire(&self) -> Result<OwnedMutexGuard<()>, String> {
        self.operation_gate
            .clone()
            .try_lock_owned()
            .map_err(|_| "A collaboration bootstrap operation is already running".to_string())
    }

    pub fn busy(&self) -> bool {
        self.operation_gate.try_lock().is_err()
    }

    pub fn journal_path(&self) -> &Path {
        &self.journal_path
    }

    pub fn load_journal(&self) -> Result<Option<CollaborationBootstrapJournal>, String> {
        load_journal_from(&self.journal_path)
    }

    pub fn save_journal(&self, journal: &CollaborationBootstrapJournal) -> Result<(), String> {
        save_journal_to(&self.journal_path, journal)
    }
}

impl Default for CollaborationControlState {
    fn default() -> Self {
        Self::new()
    }
}

fn default_journal_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join(".config")
        })
        .join("com.junqi.junqidesktop")
        .join("collaboration-bootstrap.json")
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn load_journal_file(path: &Path) -> Result<CollaborationBootstrapJournal, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect collaboration bootstrap journal: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() > 512 * 1024 {
        return Err("Collaboration bootstrap journal exceeds the 512 KiB limit".to_string());
    }
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to read collaboration bootstrap journal: {error}"))?;
    let mut raw = Vec::new();
    file.take(512 * 1024 + 1)
        .read_to_end(&mut raw)
        .map_err(|error| format!("Failed to read collaboration bootstrap journal: {error}"))?;
    if raw.len() > 512 * 1024 {
        return Err("Collaboration bootstrap journal exceeds the 512 KiB limit".to_string());
    }
    let journal: CollaborationBootstrapJournal = serde_json::from_slice(&raw)
        .map_err(|error| format!("Invalid collaboration bootstrap journal: {error}"))?;
    validate_bootstrap_operation_id(&journal.operation_id).map_err(|error| {
        format!("Invalid collaboration bootstrap journal operation id: {error}")
    })?;
    if journal.version != BOOTSTRAP_JOURNAL_VERSION {
        return Err(format!(
            "Unsupported collaboration bootstrap journal version {}",
            journal.version
        ));
    }
    Ok(journal)
}

fn load_journal_from(path: &Path) -> Result<Option<CollaborationBootstrapJournal>, String> {
    if path.exists() {
        match load_journal_file(path) {
            Ok(journal) => return Ok(Some(journal)),
            Err(primary_error) => {
                let backup = backup_path(path);
                if backup.exists() {
                    return load_journal_file(&backup)
                        .map(Some)
                        .map_err(|backup_error| {
                            format!("{primary_error}; backup is also invalid: {backup_error}")
                        });
                }
                return Err(primary_error);
            }
        }
    }
    let backup = backup_path(path);
    if backup.exists() {
        return load_journal_file(&backup).map(Some);
    }
    Ok(None)
}

fn save_journal_to(path: &Path, journal: &CollaborationBootstrapJournal) -> Result<(), String> {
    validate_bootstrap_operation_id(&journal.operation_id).map_err(|error| {
        format!("Invalid collaboration bootstrap journal operation id: {error}")
    })?;
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid collaboration bootstrap journal path".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create bootstrap journal directory: {error}"))?;
    let payload = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("Failed to encode bootstrap journal: {error}"))?;
    if payload.len() > 512 * 1024 {
        return Err("Collaboration bootstrap journal exceeds the 512 KiB limit".to_string());
    }

    let temporary = parent.join(format!(
        ".collaboration-bootstrap-{}-{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| format!("Failed to create bootstrap journal: {error}"))?;
    use std::io::Write;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Failed to persist bootstrap journal: {error}"))?;

    let backup = backup_path(path);
    if backup.exists() {
        let _ = std::fs::remove_file(&backup);
    }
    if path.exists() {
        std::fs::rename(path, &backup).map_err(|error| {
            let _ = std::fs::remove_file(&temporary);
            format!("Failed to rotate bootstrap journal: {error}")
        })?;
    }
    if let Err(error) = std::fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = std::fs::rename(&backup, path);
        }
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("Failed to activate bootstrap journal: {error}"));
    }
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Failed to sync bootstrap journal directory: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn journal() -> CollaborationBootstrapJournal {
        CollaborationBootstrapJournal {
            version: BOOTSTRAP_JOURNAL_VERSION,
            operation_id: "op-1".to_string(),
            operation: BootstrapOperationKind::Apply,
            status: BootstrapJournalStatus::Running,
            target: BootstrapTargetSnapshot {
                target_fingerprint: "fp".to_string(),
                connection_id: "connection-before".to_string(),
                deployment_kind: "system_service".to_string(),
                ownership: "junqi_managed".to_string(),
                gateway_version: "2026.7.1".to_string(),
                binary_path: "/bin/openclaw".to_string(),
                state_dir: "/tmp/state".to_string(),
                config_path: "/tmp/state/openclaw.json".to_string(),
            },
            package: BootstrapPackageSnapshot {
                source_tgz_path: "/tmp/source-plugin.tgz".to_string(),
                host_tgz_path: "/tmp/plugin.tgz".to_string(),
                tgz_path: "/tmp/plugin.tgz".to_string(),
                sha256: "a".repeat(64),
                plugin_id: "junqi-collab".to_string(),
                plugin_version: "0.1.0".to_string(),
            },
            original_plugin: BootstrapPluginSnapshot::default(),
            original_plugin_backup_tgz_path: None,
            original_plugin_backup_host_tgz_path: None,
            original_plugin_backup_sha256: None,
            original_plugin_content_sha256: None,
            original_config_sha256: "missing".to_string(),
            original_config_backup_path: None,
            bootstrap_owned_config_sha256: Some("missing".to_string()),
            started_at_ms: 1,
            updated_at_ms: 1,
            restart_required: false,
            health_pending: false,
            health: None,
            steps: vec![],
            diagnostics: vec![],
        }
    }

    #[test]
    fn journal_round_trips_and_keeps_a_backup() {
        let root = std::env::temp_dir().join(format!("junqi-bootstrap-{}", uuid::Uuid::new_v4()));
        let path = root.join("journal.json");
        let state = CollaborationControlState::with_journal_path(path.clone());
        state.save_journal(&journal()).unwrap();
        let mut second = journal();
        second.status = BootstrapJournalStatus::Completed;
        state.save_journal(&second).unwrap();
        assert_eq!(
            state.load_journal().unwrap().unwrap().status,
            BootstrapJournalStatus::Completed
        );
        assert!(backup_path(&path).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn operation_id_is_a_single_safe_path_component() {
        for value in ["op-1", "operation_2", "ABC123"] {
            assert!(validate_bootstrap_operation_id(value).is_ok(), "{value}");
        }
        for value in [
            "",
            ".",
            "..",
            "../escape",
            "/absolute",
            r"..\escape",
            "operation/id",
            "operation\nid",
            "operation id",
            "operation.id",
        ] {
            assert!(
                validate_bootstrap_operation_id(value).is_err(),
                "accepted unsafe operation id {value:?}"
            );
        }

        let root = std::env::temp_dir().join(format!(
            "junqi-bootstrap-invalid-id-{}",
            uuid::Uuid::new_v4()
        ));
        let path = root.join("journal.json");
        let state = CollaborationControlState::with_journal_path(path.clone());
        let mut invalid = journal();
        invalid.operation_id = "../escape".to_string();
        assert!(state.save_journal(&invalid).is_err());
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn operation_gate_is_single_flight() {
        let state = CollaborationControlState::with_journal_path(PathBuf::from("unused"));
        let guard = state.try_acquire().unwrap();
        assert!(state.busy());
        assert!(state.try_acquire().is_err());
        drop(guard);
        assert!(!state.busy());
    }

    #[test]
    fn step_and_diagnostic_history_are_bounded() {
        let mut value = journal();
        for index in 0..100 {
            value.record_step(format!("step-{index}"), "ok", None);
            value.add_diagnostic(format!("diagnostic-{index}"));
        }
        assert_eq!(value.steps.len(), 64);
        assert_eq!(value.diagnostics.len(), 32);
        assert_eq!(value.steps.first().unwrap().name, "step-36");
        assert_eq!(value.diagnostics.first().unwrap(), "diagnostic-68");
    }
}
