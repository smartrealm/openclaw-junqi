// ── Notification local store (ported from nezha notification.rs) ──────────────
//
// Manages `~/.nezha/notification-store.json` — a per-user persistent store of
// "which notification IDs have been read" + a local notifications queue that
// other modules (e.g. agent_task_pty) can push to.
//
// Architecture:
//   - `get_notifications` — returns mock items + local pushed items, merged with
//     read state
//   - `push_local_notification` — called by other Rust modules to push a
//     notification (e.g. "task failed", "task needs input")
//   - `mark_notification_read` / `mark_all_notifications_read` — persist read state

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationItem {
    pub id: String,
    pub level: String,
    pub title: String,
    pub body: String,
    #[serde(rename = "bodyZh")]
    pub body_zh: Option<String>,
    pub url: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "isRead")]
    pub is_read: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotificationResult {
    pub notifications: Vec<NotificationItem>,
    #[serde(rename = "unreadCount")]
    pub unread_count: usize,
}

#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
struct LocalStore {
    /// IDs the user has explicitly marked as read.
    #[serde(default)]
    read_ids: HashSet<String>,
    /// Last fetch timestamp (epoch seconds). Always 0 in this stub since we
    /// don't fetch anything — kept for API compatibility with nezha.
    #[serde(default)]
    last_fetched_at: i64,
}

fn store_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    let dir = home.join(".nezha");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("notification-store.json"))
}

fn store_lock() -> &'static Mutex<LocalStore> {
    static LOCK: OnceLock<Mutex<LocalStore>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(load_store()))
}

fn load_store() -> LocalStore {
    let path = match store_path() {
        Ok(p) => p,
        Err(_) => return LocalStore::default(),
    };
    load_store_at(&path)
}

/// Pure helper: read a store from the given path. Missing/empty file
/// returns default. Used by tests to inject temp paths.
fn load_store_at(path: &Path) -> LocalStore {
    if !path.exists() {
        return LocalStore::default();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_store(store: &LocalStore) -> Result<(), String> {
    let path = store_path()?;
    save_store_at(&path, store)
}

/// Pure helper: write a store to the given path atomically.
fn save_store_at(path: &Path, store: &LocalStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    atomic_write(path, &raw)
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let uid = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{file_name}.{uid}.tmp"));
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Sanitize free-form text: cap length and strip control characters so a
/// malformed upstream payload can't break the UI.
fn sanitize_text(s: &str, max_len: usize) -> String {
    let cleaned: String = s
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .take(max_len)
        .collect();
    cleaned
}

/// Return the current notification list with `isRead` merged from local store,
/// plus the unread count.
///
/// Mock: returns a fixed set of demo items so the frontend bell has real
/// content to render. Replace `_mock_items()` with a real fetch
/// (HTTP / gateway.call / etc.) when a notification source is ready.
/// `store.read_ids` is still meaningful — items the user marks read will
/// report `is_read: true` on the next fetch.
fn mock_items() -> Vec<NotificationItem> {
    vec![
        NotificationItem {
            id: "welcome-v1".to_string(),
            level: "info".to_string(),
            title: "Welcome to JunQi".to_string(),
            body: "Nezha-style skill hub + worktree support is now available. Open /skill-hub to get started.".to_string(),
            body_zh: Some("已支持 Nezha 风格的 skill hub + worktree。打开 /skill-hub 开始使用。".to_string()),
            url: None,
            created_at: "2026-06-22 10:00".to_string(),
            is_read: false,
        },
        NotificationItem {
            id: "make-target".to_string(),
            level: "info".to_string(),
            title: "New: Run Make targets in one click".to_string(),
            body: "Open a Makefile in the file viewer and click any target button to run it in the terminal.".to_string(),
            body_zh: Some("在文件查看器打开 Makefile，点击 target 按钮即可在终端运行。".to_string()),
            url: None,
            created_at: "2026-06-22 09:30".to_string(),
            is_read: false,
        },
        NotificationItem {
            id: "agent-task-pty".to_string(),
            level: "info".to_string(),
            title: "Agent task PTY is ready".to_string(),
            body: "Claude Code and Codex can now run in a managed PTY. Future updates will add session resume and worktree merge.".to_string(),
            body_zh: Some("Claude Code 和 Codex 现在可以在托管的 PTY 中运行。后续会接入 session 续接和 worktree 合并。".to_string()),
            url: None,
            created_at: "2026-06-22 09:00".to_string(),
            is_read: false,
        },
        NotificationItem {
            id: "usage-mock".to_string(),
            level: "warning".to_string(),
            title: "Usage data is mocked".to_string(),
            body: "Claude/Codex usage windows currently show demo values. Real OAuth / codex app-server integration is on the roadmap.".to_string(),
            body_zh: Some("Claude/Codex 用量窗口目前显示的是演示数据。真实 OAuth / codex app-server 接入在路线图中。".to_string()),
            url: None,
            created_at: "2026-06-22 08:30".to_string(),
            is_read: false,
        },
        NotificationItem {
            id: "docs".to_string(),
            level: "info".to_string(),
            title: "Port plan document".to_string(),
            body: "See docs/NEZHA-PORT-PLAN.md for the full migration status and architecture notes.".to_string(),
            body_zh: None,
            url: Some("https://github.com/hanshuaikang/nezha".to_string()),
            created_at: "2026-06-21 18:00".to_string(),
            is_read: false,
        },
    ]
}

/// Push a notification from another backend module (e.g. agent_task_pty).
/// These are persisted to `~/.nezha/local-notifications.json` and merged
/// into the result of `get_notifications`.
pub fn push_local_notification(level: &str, title: &str, body: &str, url: Option<&str>) {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    let id = format!("local-{}", uuid_v4());
    let item = NotificationItem {
        id,
        level: level.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        body_zh: None,
        url: url.map(|s| s.to_string()),
        created_at: now,
        is_read: false,
    };
    // Append to local notifications file
    if let Ok(path) = local_notifications_path() {
        let mut existing = load_local_notifications(&path);
        // Keep max 50 most recent
        if existing.len() >= 50 {
            existing.drain(0..existing.len() - 49);
        }
        existing.push(item);
        let _ = save_local_notifications(&path, &existing);
    }
}

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{:x}-{:04x}", now.as_secs(), now.subsec_nanos() % 0x10000)
}

fn local_notifications_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    let dir = home.join(".nezha");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("local-notifications.json"))
}

fn load_local_notifications(path: &Path) -> Vec<NotificationItem> {
    if !path.exists() { return Vec::new(); }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_local_notifications(path: &Path, items: &[NotificationItem]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    atomic_write(path, &raw)
}

#[tauri::command]
pub async fn get_notifications() -> Result<NotificationResult, String> {
    tokio::task::spawn_blocking(|| -> Result<NotificationResult, String> {
        let store = store_lock().lock().expect("notification store poisoned");

        let local = local_notifications_path()
            .map(|p| load_local_notifications(&p))
            .unwrap_or_default();

        // Merge: mock items first (pinned to top), then local items (newest first)
        let mock = mock_items();
        let mut all: Vec<NotificationItem> = mock.into_iter().chain(local).collect();

        // Mark read state
        for item in &mut all {
            item.is_read = store.read_ids.contains(&item.id);
        }

        let unread_count = all.iter().filter(|n| !n.is_read).count();
        Ok(NotificationResult { notifications: all, unread_count })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mark_notification_read(id: String) -> Result<(), String> {
    let sanitized_id = sanitize_text(&id, 100);
    if sanitized_id.is_empty() {
        return Err("Notification id is required".into());
    }
    tokio::task::spawn_blocking(move || {
        let mut store = store_lock().lock().expect("notification store poisoned");
        if store.read_ids.insert(sanitized_id) {
            save_store(&store)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mark_all_notifications_read() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        // No items to mark in this stub. If we ever fetch real items,
        // this would iterate them and insert into `store.read_ids`.
        // For now: just touch the file to record that the user pressed it.
        let store = store_lock().lock().expect("notification store poisoned");
        save_store(&store)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_text_preserves_newlines_and_tabs() {
        let s = "line one\nline two\tindented";
        assert_eq!(sanitize_text(s, 200), s);
    }

    #[test]
    fn sanitize_text_drops_other_control_characters() {
        // \x00 NUL, \x01 SOH, and \x07 BEL are all Unicode Cc (control).
        // They're not \n or \t, so the sanitizer filters them. The visible
        // words around them stay intact.
        let s = "before\x00null\x01soh\x07belafter";
        let out = sanitize_text(s, 200);
        assert_eq!(out, "beforenullsohbelafter");
    }

    #[test]
    fn sanitize_text_caps_at_max_len() {
        let s = "a".repeat(500);
        let out = sanitize_text(&s, 10);
        assert_eq!(out.len(), 10);
    }

    #[test]
    fn sanitize_text_on_empty_returns_empty() {
        assert_eq!(sanitize_text("", 100), "");
    }

    #[test]
    fn local_store_round_trip_through_disk() {
        let dir = std::env::temp_dir().join(format!(
            "junqi-notif-store-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("notification-store.json");

        let mut store = LocalStore::default();
        store.read_ids.insert("a".to_string());
        store.read_ids.insert("b".to_string());
        store.last_fetched_at = 1700000000;
        save_store_at(&path, &store).unwrap();

        let loaded = load_store_at(&path);
        assert_eq!(loaded.read_ids.len(), 2);
        assert!(loaded.read_ids.contains("a"));
        assert!(loaded.read_ids.contains("b"));
        assert_eq!(loaded.last_fetched_at, 1700000000);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mock_items_have_unique_ids() {
        let items = mock_items();
        let mut ids: Vec<&String> = items.iter().map(|i| &i.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), items.len(), "mock IDs must be unique");
    }

    #[test]
    fn mock_items_levels_are_valid() {
        for item in mock_items() {
            assert!(
                matches!(item.level.as_str(), "info" | "warning" | "error"),
                "invalid level: {}",
                item.level
            );
        }
    }
}
