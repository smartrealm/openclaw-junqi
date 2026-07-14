use std::time::Duration;

/// Terminate the complete owned process tree on Windows and the owned child on
/// Unix. The bounded waits keep error recovery from hanging the desktop app.
pub async fn terminate_process_tree(child: &mut tokio::process::Child, pid: Option<u32>) {
    #[cfg(windows)]
    if let Some(pid) = pid {
        let pid = pid.to_string();
        let mut taskkill = tokio::process::Command::new("taskkill");
        taskkill.args(["/PID", &pid, "/T", "/F"]);
        crate::platform::configure_background_command(&mut taskkill);
        let _ = tokio::time::timeout(Duration::from_secs(15), taskkill.status()).await;
    }

    #[cfg(not(windows))]
    let _ = pid;

    let _ = child.start_kill();
    let _ = tokio::time::timeout(Duration::from_secs(10), child.wait()).await;
}
