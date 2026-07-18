//! Non-destructive directory compensation for user-selected locations.
//!
//! A selected path can be created or written by another process after JunQi
//! validates it. Transaction rollback must therefore preserve its contents
//! instead of recursively deleting a directory merely because this operation
//! originally expected to own it.

use std::path::{Path, PathBuf};

/// Move a transaction target aside without destroying its contents.
///
/// The recovery directory is a sibling, so a successful rename is atomic on
/// the selected filesystem. Callers can restore an older directory at the
/// original path while reporting the preserved payload to the user.
pub(crate) fn preserve_directory_for_recovery(
    path: &Path,
    label: &str,
) -> Result<Option<PathBuf>, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Failed to inspect {label} directory {}: {error}",
                path.display()
            ))
        }
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!(
            "Refusing to move non-directory or symbolic-link {label} path {} during rollback",
            path.display()
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        format!(
            "Cannot preserve {label} directory {} because it has no parent",
            path.display()
        )
    })?;
    let stem = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("runtime");
    for _ in 0..8 {
        let recovery = parent.join(format!(".{stem}-junqi-recovery-{}", uuid::Uuid::new_v4()));
        if recovery.exists() {
            continue;
        }
        match std::fs::rename(path, &recovery) {
            Ok(()) => return Ok(Some(recovery)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to preserve {label} directory {} for recovery: {error}",
                    path.display()
                ))
            }
        }
    }
    Err(format!(
        "Could not allocate a recovery directory beside {}",
        path.display()
    ))
}

/// Remove only an empty user-selected directory. This is useful before an
/// atomic replacement, but it must never become a recursive cleanup fallback.
pub(crate) fn remove_empty_directory(path: &Path, label: &str) -> Result<(), String> {
    match std::fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove empty {label} directory {}: {error}",
            path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_move_preserves_all_user_visible_files() {
        let root = std::env::temp_dir().join(format!(
            "junqi-directory-transaction-{}",
            uuid::Uuid::new_v4()
        ));
        let target = root.join("target");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("external.txt"), "preserve me").unwrap();

        let recovery = preserve_directory_for_recovery(&target, "test")
            .unwrap()
            .unwrap();

        assert!(!target.exists());
        assert_eq!(
            std::fs::read_to_string(recovery.join("external.txt")).unwrap(),
            "preserve me"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn empty_directory_cleanup_never_recurses() {
        let root =
            std::env::temp_dir().join(format!("junqi-empty-directory-{}", uuid::Uuid::new_v4()));
        let target = root.join("target");
        std::fs::create_dir_all(&target).unwrap();
        remove_empty_directory(&target, "test").unwrap();
        assert!(!target.exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
