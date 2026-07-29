use super::storage::{backup_path, load, reset, save};
use serde_json::json;

fn root(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "junqi-workbench-session-{name}-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ))
}

#[test]
fn generation_and_hash_noop_are_enforced() {
    let root = root("generation");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("session.json");
    let first = save(&path, 0, json!({"active":"a"})).unwrap();
    assert_eq!(first.generation, 1);
    assert!(!first.unchanged);
    let noop = save(&path, 1, json!({"active":"a"})).unwrap();
    assert_eq!(noop.generation, 1);
    assert!(noop.unchanged);
    assert!(save(&path, 0, json!({"active":"b"}))
        .unwrap_err()
        .contains("generation conflict"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn corrupted_primary_recovers_the_newest_valid_backup() {
    let root = root("recovery");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("session.json");
    save(&path, 0, json!({"value":1})).unwrap();
    save(&path, 1, json!({"value":2})).unwrap();
    assert!(backup_path(&path, 2).exists());
    std::fs::write(&path, b"broken").unwrap();
    let loaded = load(&path).unwrap();
    assert!(loaded.recovered);
    assert_eq!(loaded.generation, 1);
    assert_eq!(loaded.payload.unwrap(), json!({"value":1}));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn reset_archives_primary_and_backups_without_deleting_evidence() {
    let root = root("reset");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("session.json");
    save(&path, 0, json!({"value":1})).unwrap();
    save(&path, 1, json!({"value":2})).unwrap();
    assert!(reset(&path).unwrap());
    assert!(!path.exists());
    assert!(!backup_path(&path, 2).exists());
    let recovery = std::fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("recovery-")
        })
        .unwrap();
    assert!(recovery.join("session.json").exists());
    assert!(recovery.join("session.backup-2.json").exists());
    assert!(!reset(&path).unwrap());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn writes_replace_existing_content_and_leave_no_temporary_files() {
    let root = root("atomic");
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("session.json");
    save(&path, 0, json!({"value":1})).unwrap();
    save(&path, 1, json!({"value":2})).unwrap();
    assert_eq!(load(&path).unwrap().payload.unwrap(), json!({"value":2}));
    assert!(std::fs::read_dir(&root).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .ends_with(".tmp")));
    std::fs::remove_dir_all(root).unwrap();
}
