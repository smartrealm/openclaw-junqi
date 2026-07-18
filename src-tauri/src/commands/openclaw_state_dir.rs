//! OpenClaw state-directory compatibility checks.
//!
//! A directory can be writable while still rejecting the permission changes
//! OpenClaw performs through Node.js. Keep the storage and Gateway callers on
//! one contract so an unsupported filesystem is rejected before a long startup
//! timeout or a partial configuration switch.

use std::path::Path;

const NODE_STATE_DIRECTORY_PROBE: &str = r#"
const fs = require('node:fs');
const path = require('node:path');
const stateDir = process.argv[1];
const probeDir = path.join(stateDir, `.junqi-state-probe-${process.pid}-${Date.now()}`);
const probeFile = path.join(probeDir, 'permission-probe');
const renamedFile = path.join(probeDir, 'permission-probe-renamed');

try {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(probeDir);
  fs.chmodSync(probeDir, 0o700);
  fs.writeFileSync(probeFile, 'junqi-state-directory-probe');
  fs.renameSync(probeFile, renamedFile);
  fs.rmSync(probeDir, { recursive: true, force: true, maxRetries: 1 });
} catch (error) {
  try { fs.rmSync(probeDir, { recursive: true, force: true, maxRetries: 1 }); } catch {}
  const code = error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
  const message = error && error.message ? error.message : String(error);
  console.error(`JUNQI_STATE_DIRECTORY_PROBE_FAILED ${code}: ${message}`);
  process.exit(1);
}
"#;

fn local_directory_guidance() -> &'static str {
    #[cfg(windows)]
    {
        "a local NTFS directory"
    }
    #[cfg(not(windows))]
    {
        "a local directory with standard permission support"
    }
}

fn incompatible_directory_error(state_dir: &Path, detail: impl AsRef<str>) -> String {
    format!(
        "OpenClaw state directory is incompatible: {}. The selected data directory {} does not support the file operations and permission changes OpenClaw requires. Choose {}, then retry. Detail: {}",
        state_dir.display(),
        state_dir.display(),
        local_directory_guidance(),
        detail.as_ref().trim(),
    )
}

/// Checks ordinary filesystem operations before the storage layout is committed.
///
/// This deliberately does not require Node.js: storage is selected before the
/// dependency installer may have made a compatible runtime available. The
/// authoritative Node `fs.chmod` probe runs immediately before Gateway launch.
pub(crate) fn verify_state_directory_basics(state_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(state_dir).map_err(|error| {
        incompatible_directory_error(state_dir, format!("create directory failed: {error}"))
    })?;

    let probe_dir = state_dir.join(format!(".junqi-state-probe-{}", uuid::Uuid::new_v4()));
    let probe_file = probe_dir.join("permission-probe");
    let renamed_file = probe_dir.join("permission-probe-renamed");
    let result = (|| -> Result<(), std::io::Error> {
        std::fs::create_dir(&probe_dir)?;
        let mut permissions = std::fs::metadata(&probe_dir)?.permissions();
        permissions.set_readonly(false);
        std::fs::set_permissions(&probe_dir, permissions)?;
        std::fs::write(&probe_file, b"junqi-state-directory-probe")?;
        std::fs::rename(&probe_file, &renamed_file)?;
        Ok(())
    })();
    let cleanup = std::fs::remove_dir_all(&probe_dir);
    if let Err(error) = result {
        return Err(incompatible_directory_error(
            state_dir,
            format!("filesystem probe failed: {error}"),
        ));
    }
    cleanup.map_err(|error| {
        incompatible_directory_error(state_dir, format!("probe cleanup failed: {error}"))
    })
}

/// Verifies the exact Node.js APIs OpenClaw uses against a disposable child of
/// the selected state directory. This must run after Node compatibility has
/// been established and before JunQi writes Gateway bootstrap configuration.
pub(crate) async fn verify_node_state_directory(
    node_executable: &Path,
    state_dir: &Path,
) -> Result<(), String> {
    verify_state_directory_basics(state_dir)?;

    let mut probe = tokio::process::Command::new(node_executable);
    probe
        .args(["-e", NODE_STATE_DIRECTORY_PROBE])
        .arg(state_dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(30), probe.output())
        .await
        .map_err(|_| {
            incompatible_directory_error(
                state_dir,
                "selected Node.js runtime did not finish the filesystem probe within 30 seconds",
            )
        })?
        .map_err(|error| {
            incompatible_directory_error(
                state_dir,
                format!("could not run the selected Node.js runtime: {error}"),
            )
        })?;

    if output.status.success() {
        return Ok(());
    }

    let detail = String::from_utf8_lossy(&output.stderr)
        .lines()
        .find(|line| line.contains("JUNQI_STATE_DIRECTORY_PROBE_FAILED"))
        .unwrap_or("Node.js rejected the state-directory probe")
        .trim()
        .to_string();
    Err(incompatible_directory_error(state_dir, detail))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_directory_error_is_actionable_without_exposing_probe_details() {
        let error = incompatible_directory_error(
            Path::new("F:/OpenClaw"),
            "JUNQI_STATE_DIRECTORY_PROBE_FAILED EPERM: chmod denied",
        );
        assert!(error.contains("OpenClaw state directory is incompatible"));
        assert!(error.contains(local_directory_guidance()));
        assert!(error.contains("EPERM"));
    }

    #[test]
    fn basic_probe_cleans_its_temporary_child() {
        let root = std::env::temp_dir().join(format!(
            "junqi-state-directory-probe-test-{}",
            uuid::Uuid::new_v4()
        ));
        verify_state_directory_basics(&root).unwrap();
        let entries = std::fs::read_dir(&root).unwrap().count();
        assert_eq!(entries, 0);
        let _ = std::fs::remove_dir_all(root);
    }
}
