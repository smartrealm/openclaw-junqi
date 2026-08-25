use super::*;

#[test]
fn confirmed_health_removes_plugin_rollback_artifacts_and_closes_recovery() {
    let root =
        std::env::temp_dir().join(format!("junqi-confirmed-cleanup-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
    let target = test_mutation_target(&root, RuntimeDeploymentKind::SystemService);
    let operation_dir = private_operation_dir(&control, "op").unwrap();
    let staged_package = operation_dir.join("junqi-collab.tgz");
    let original_plugin = operation_dir.join("original-junqi-collab.tgz");
    let original_config = operation_dir.join(CONFIG_BACKUP_FILE_NAME);
    std::fs::write(&staged_package, b"new-plugin").unwrap();
    std::fs::write(&original_plugin, b"old-plugin").unwrap();
    std::fs::write(&original_config, b"config").unwrap();

    let mut journal = test_journal(BootstrapPluginSnapshot {
        installed: true,
        enabled: true,
        status: Some("loaded".to_string()),
        version: Some("0.0.9".to_string()),
        source: Some("installed".to_string()),
        root_dir: Some(root.join("installed-plugin").to_string_lossy().to_string()),
        install_record: Some(serde_json::json!({ "source": "path" })),
    });
    journal.status = BootstrapJournalStatus::Completed;
    journal.health_pending = true;
    journal.restart_required = true;
    journal.package.source_tgz_path = staged_package.to_string_lossy().to_string();
    journal.package.host_tgz_path = staged_package.to_string_lossy().to_string();
    journal.package.tgz_path = staged_package.to_string_lossy().to_string();
    journal.original_plugin_backup_tgz_path = Some(original_plugin.to_string_lossy().to_string());
    journal.original_plugin_backup_host_tgz_path =
        Some(original_plugin.to_string_lossy().to_string());
    journal.original_plugin_backup_sha256 = Some("b".repeat(64));
    journal.original_plugin_content_sha256 = Some("c".repeat(64));
    journal.original_config_backup_path = Some(original_config.to_string_lossy().to_string());
    control.save_journal(&journal).unwrap();

    close_bootstrap_recovery_window(&control, &target, &mut journal).unwrap();

    assert!(!operation_dir.exists());
    assert!(!bootstrap_recovery_available(&journal));
    assert!(bootstrap_artifact_cleanup_completed(&journal));
    assert!(journal.package.source_tgz_path.is_empty());
    assert!(journal.package.host_tgz_path.is_empty());
    assert!(journal.package.tgz_path.is_empty());
    assert!(journal.original_plugin.source.is_none());
    assert!(journal.original_plugin.root_dir.is_none());
    assert!(journal.original_plugin.install_record.is_none());
    assert!(journal.original_plugin_backup_tgz_path.is_none());
    assert!(journal.original_plugin_backup_host_tgz_path.is_none());
    assert!(journal.original_plugin_backup_sha256.is_none());
    assert!(journal.original_plugin_content_sha256.is_none());
    assert!(journal.original_config_backup_path.is_none());

    let persisted = control.load_journal().unwrap().unwrap();
    assert!(!bootstrap_recovery_available(&persisted));
    let backup = load_archived_journal(&root.join("journal.json.bak")).unwrap();
    assert!(backup.original_plugin_backup_host_tgz_path.is_none());
    assert!(backup.original_config_backup_path.is_none());
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn failed_terminal_cleanup_keeps_recovery_closed_without_following_symlinks() {
    use std::os::unix::fs::symlink;

    let root = std::env::temp_dir().join(format!(
        "junqi-confirmed-cleanup-failure-{}",
        uuid::Uuid::new_v4()
    ));
    let outside = root.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
    let target = test_mutation_target(&root, RuntimeDeploymentKind::SystemService);
    symlink(&outside, root.join("collaboration-bootstrap-backups")).unwrap();
    let mut journal = test_journal(BootstrapPluginSnapshot::default());
    journal.status = BootstrapJournalStatus::Completed;
    journal.health_pending = true;
    journal.restart_required = true;
    journal.original_plugin_backup_host_tgz_path =
        Some(outside.join("old-plugin.tgz").to_string_lossy().to_string());
    control.save_journal(&journal).unwrap();

    let error = close_bootstrap_recovery_window(&control, &target, &mut journal).unwrap_err();

    assert!(error.contains("backup root"));
    assert!(!bootstrap_recovery_available(&journal));
    assert!(journal.original_plugin_backup_host_tgz_path.is_none());
    assert!(std::fs::read_dir(&outside).unwrap().next().is_none());
    let persisted = control.load_journal().unwrap().unwrap();
    assert!(!bootstrap_recovery_available(&persisted));
    assert!(persisted
        .steps
        .iter()
        .any(|step| step.name == "bootstrap_artifacts_cleanup" && step.status == "failed"));
    let _ = std::fs::remove_dir_all(root);
}
