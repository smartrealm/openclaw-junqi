// Screenshot commands for Tauri macOS.
// Uses native screencapture CLI. No pre-flight permission check —
// screencapture -i handles the macOS permission prompt natively.
// If the user has already granted Screen Recording permission in
// System Settings, it works silently. Otherwise macOS shows its own dialog.
use std::process::Command as StdCommand;
use std::fs;
use base64::{engine::general_purpose::STANDARD, Engine};

/// Interactive screenshot — native macOS crosshair (drag area / Space for window).
/// macOS handles the permission prompt itself if not yet granted.
#[tauri::command]
pub async fn screenshot_interactive() -> Result<serde_json::Value, String> {
    let tmp = std::env::temp_dir().join(format!("junqi-screenshot-{}.png", std::process::id()));
    let path_str = tmp.to_string_lossy().to_string();

    let output = StdCommand::new("screencapture")
        .args(["-i", "-x", "-t", "png", &path_str])
        .output()
        .map_err(|e| format!("screencapture 执行失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
        if stderr.contains("not authorized") || stderr.contains("not permitted") || stderr.contains("no screen capture") {
            return Err("PERMISSION_DENIED:请在 系统设置 → 隐私与安全性 → 屏幕录制 中允许 JunQi Desktop".to_string());
        }
        // User pressed Esc or cancelled
        return Err("CANCELLED".to_string());
    }
    if !tmp.exists() {
        return Err("CANCELLED".to_string());
    }

    let bytes = fs::read(&tmp).map_err(|e| format!("读取截图失败: {}", e))?;
    let _ = fs::remove_file(&tmp);
    let b64 = STANDARD.encode(&bytes);
    Ok(serde_json::json!({ "success": true, "data": format!("data:image/png;base64,{}", b64) }))
}

/// Full-screen capture (no interaction).
#[tauri::command]
pub async fn screenshot_fullscreen() -> Result<serde_json::Value, String> {
    let tmp = std::env::temp_dir().join(format!("junqi-screenshot-{}.png", std::process::id()));
    let path_str = tmp.to_string_lossy().to_string();
    let output = StdCommand::new("screencapture")
        .args(["-x", "-t", "png", &path_str])
        .output()
        .map_err(|e| format!("screencapture 执行失败: {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
    if stderr.contains("not authorized") || stderr.contains("not permitted") {
        return Err("PERMISSION_DENIED:请在 系统设置 → 隐私与安全性 → 屏幕录制 中允许 JunQi Desktop".to_string());
    }
    if !output.status.success() || !tmp.exists() {
        return Err("截图失败".to_string());
    }
    let bytes = fs::read(&tmp).map_err(|e| format!("读取截图失败: {}", e))?;
    let _ = fs::remove_file(&tmp);
    let b64 = STANDARD.encode(&bytes);
    Ok(serde_json::json!({ "success": true, "data": format!("data:image/png;base64,{}", b64) }))
}

/// Test-only: check if screencapture can access the display.
/// Writes to /dev/null to avoid leaving files.
#[tauri::command]
pub fn screenshot_check_permission() -> Result<serde_json::Value, String> {
    let output = StdCommand::new("screencapture")
        .args(["-x", "-t", "png", "/dev/null"])
        .output()
        .map_err(|e| format!("screencapture failed: {}", e))?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
    let granted = output.status.success() && !stderr.contains("not authorized");
    Ok(serde_json::json!({ "granted": granted }))
}

/// List windows for the picker UI (non-interactive).
#[tauri::command]
pub fn screenshot_list_windows() -> Result<Vec<serde_json::Value>, String> {
    let output = StdCommand::new("screencapture")
        .arg("-l").output()
        .map_err(|e| format!("列出窗口失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut windows: Vec<serde_json::Value> = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with('[') { continue; }
        if let Some(end) = trimmed.find(']') {
            windows.push(serde_json::json!({
                "id": format!("window:{}", &trimmed[1..end]),
                "name": trimmed[end + 1..].trim().to_string(),
                "thumbnail": ""
            }));
        }
    }
    windows.push(serde_json::json!({ "id": "screen:1", "name": "Full Screen", "thumbnail": "" }));
    Ok(windows)
}

/// Capture specific window by ID.
#[tauri::command]
pub fn screenshot_capture_window(id: String) -> Result<serde_json::Value, String> {
    let win_id = if id.starts_with("window:") { &id[7..] }
                 else if id.starts_with("screen:") { return screenshot_capture_inner(); }
                 else { &id };
    let tmp = std::env::temp_dir().join(format!("junqi-screenshot-{}.png", std::process::id()));
    let path_str = tmp.to_string_lossy().to_string();
    let status = StdCommand::new("screencapture")
        .args(["-x", "-t", "png", "-l", win_id, &path_str])
        .status().map_err(|e| format!("截图窗口失败: {}", e))?;
    if !status.success() || !tmp.exists() { return Err("截图窗口失败".to_string()); }
    let bytes = fs::read(&tmp).map_err(|e| format!("读取截图失败: {}", e))?;
    let _ = fs::remove_file(&tmp);
    let b64 = STANDARD.encode(&bytes);
    Ok(serde_json::json!({ "success": true, "data": format!("data:image/png;base64,{}", b64) }))
}

fn screenshot_capture_inner() -> Result<serde_json::Value, String> {
    let tmp = std::env::temp_dir().join(format!("junqi-screenshot-{}.png", std::process::id()));
    let path_str = tmp.to_string_lossy().to_string();
    let status = StdCommand::new("screencapture")
        .args(["-x", "-t", "png", &path_str])
        .status().map_err(|e| format!("screencapture failed: {}", e))?;
    if !status.success() || !tmp.exists() { return Err("Screenshot failed".to_string()); }
    let bytes = fs::read(&tmp).map_err(|e| format!("Failed to read screenshot: {}", e))?;
    let _ = fs::remove_file(&tmp);
    let b64 = STANDARD.encode(&bytes);
    Ok(serde_json::json!({ "success": true, "data": format!("data:image/png;base64,{}", b64) }))
}
