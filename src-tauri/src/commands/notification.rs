// ── Notification local store (ported from junqi notification.rs) ──────────────
//
// Manages JunQi's application config directory — a per-user persistent store of
// "which notification IDs have been read" + a local notifications queue that
// other modules (e.g. agent_task_pty) can push to.
//
// Architecture:
//   - `get_notifications` — returns persisted local items merged with read state
//   - `push_local_notification` — called by other Rust modules to push a
//     notification (e.g. "task failed", "task needs input")
//   - `mark_notification_read` / `mark_all_notifications_read` — persist read state

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

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

fn create_notification(
    level: &str,
    title: &str,
    body: &str,
    url: Option<&str>,
) -> NotificationItem {
    let level = match level {
        "warning" | "error" => level,
        _ => "info",
    };
    NotificationItem {
        id: format!("local-{}", uuid::Uuid::new_v4()),
        level: level.to_string(),
        title: sanitize_text(title, 200),
        body: sanitize_text(body, 4_000),
        body_zh: None,
        url: url.map(|value| sanitize_text(value, 2_000)),
        created_at: chrono::Utc::now().to_rfc3339(),
        is_read: false,
    }
}

#[derive(Debug, Default, serde::Deserialize, serde::Serialize)]
struct LocalStore {
    /// IDs the user has explicitly marked as read.
    #[serde(default)]
    read_ids: HashSet<String>,
    /// Last fetch timestamp (epoch seconds). Always 0 in this stub since we
    /// don't fetch anything; retained as part of JunQi's persisted schema.
    #[serde(default)]
    last_fetched_at: i64,
}

struct NotificationRepository {
    store_path: PathBuf,
    items_path: PathBuf,
}

impl NotificationRepository {
    fn discover() -> Result<Self, String> {
        let dir = crate::paths::app_config_dir().join("notifications");
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        Ok(Self {
            store_path: dir.join("read-state.json"),
            items_path: dir.join("items.json"),
        })
    }

    fn load_store(&self) -> LocalStore {
        load_store_at(&self.store_path)
    }

    fn save_store(&self, store: &LocalStore) -> Result<(), String> {
        save_store_at(&self.store_path, store)
    }

    fn load_items(&self) -> Vec<NotificationItem> {
        load_local_notifications(&self.items_path)
    }

    fn save_items(&self, items: &[NotificationItem]) -> Result<(), String> {
        save_local_notifications(&self.items_path, items)
    }
}

fn mark_all_items_read(store: &mut LocalStore, items: &[NotificationItem]) {
    store.read_ids = items.iter().map(|item| item.id.clone()).collect();
}

fn prune_read_state(store: &mut LocalStore, items: &[NotificationItem]) -> bool {
    let item_ids = items
        .iter()
        .map(|item| item.id.as_str())
        .collect::<HashSet<_>>();
    let previous_len = store.read_ids.len();
    store.read_ids.retain(|id| item_ids.contains(id.as_str()));
    store.read_ids.len() != previous_len
}

fn repository_gate() -> &'static Mutex<()> {
    static GATE: OnceLock<Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(()))
}

fn persist_notification(item: NotificationItem) -> Result<NotificationItem, String> {
    let _guard = repository_gate()
        .lock()
        .map_err(|_| "Notification repository lock is poisoned".to_string())?;
    let repository = NotificationRepository::discover()?;
    let mut existing = repository.load_items();
    if existing.len() >= 50 {
        existing.drain(0..existing.len() - 49);
    }
    existing.push(item.clone());
    repository.save_items(&existing)?;
    Ok(item)
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

/// Pure helper: write a store to the given path atomically.
fn save_store_at(path: &Path, store: &LocalStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    atomic_write(path, &raw)
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    crate::paths::atomic_write_text(path, content)
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

/// Push a notification from another backend module (e.g. agent_task_pty).
pub fn push_local_notification(level: &str, title: &str, body: &str, url: Option<&str>) {
    let _ = persist_notification(create_notification(level, title, body, url));
}

fn load_local_notifications(path: &Path) -> Vec<NotificationItem> {
    if !path.exists() {
        return Vec::new();
    }
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
        let _guard = repository_gate()
            .lock()
            .map_err(|_| "Notification repository lock is poisoned".to_string())?;
        let repository = NotificationRepository::discover()?;
        let mut all = repository.load_items();
        let mut store = repository.load_store();
        if prune_read_state(&mut store, &all) {
            repository.save_store(&store)?;
        }
        all.reverse();

        // Mark read state
        for item in &mut all {
            item.is_read = store.read_ids.contains(&item.id);
        }

        let unread_count = all.iter().filter(|n| !n.is_read).count();
        Ok(NotificationResult {
            notifications: all,
            unread_count,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn push_notification(
    level: String,
    title: String,
    body: String,
    url: Option<String>,
) -> Result<NotificationItem, String> {
    tokio::task::spawn_blocking(move || {
        if title.trim().is_empty() {
            return Err("Notification title is required".to_string());
        }
        persist_notification(create_notification(&level, &title, &body, url.as_deref()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn mark_notification_read(id: String) -> Result<(), String> {
    let sanitized_id = sanitize_text(&id, 100);
    if sanitized_id.is_empty() {
        return Err("Notification id is required".into());
    }
    tokio::task::spawn_blocking(move || {
        let _guard = repository_gate()
            .lock()
            .map_err(|_| "Notification repository lock is poisoned".to_string())?;
        let repository = NotificationRepository::discover()?;
        let items = repository.load_items();
        if !items.iter().any(|item| item.id == sanitized_id) {
            return Err("Notification does not exist".to_string());
        }
        let mut store = repository.load_store();
        if store.read_ids.insert(sanitized_id) {
            repository.save_store(&store)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mark_all_notifications_read() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        let _guard = repository_gate()
            .lock()
            .map_err(|_| "Notification repository lock is poisoned".to_string())?;
        let repository = NotificationRepository::discover()?;
        let mut store = repository.load_store();
        mark_all_items_read(&mut store, &repository.load_items());
        repository.save_store(&store)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_notifications() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        let _guard = repository_gate()
            .lock()
            .map_err(|_| "Notification repository lock is poisoned".to_string())?;
        let repository = NotificationRepository::discover()?;
        repository.save_items(&[])?;
        repository.save_store(&LocalStore::default())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str) -> NotificationItem {
        NotificationItem {
            id: id.to_string(),
            level: "info".to_string(),
            title: "title".to_string(),
            body: "body".to_string(),
            body_zh: None,
            url: None,
            created_at: "2026-07-14T00:00:00Z".to_string(),
            is_read: false,
        }
    }

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
    fn frontend_notification_payload_is_sanitized_before_persistence() {
        let created =
            create_notification("unexpected", "title\0", "body\x07", Some("/ai-workspace\0"));
        assert_eq!(created.level, "info");
        assert_eq!(created.title, "title");
        assert_eq!(created.body, "body");
        assert_eq!(created.url.as_deref(), Some("/ai-workspace"));
        assert!(!created.is_read);
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
    fn notification_source_contains_no_pinned_demo_items() {
        let source = include_str!("notification.rs");
        let removed_mock = ["mock_", "items"].concat();
        let removed_demo = ["usage-", "mock"].concat();
        assert!(!source.contains(&removed_mock));
        assert!(!source.contains(&removed_demo));
        assert!(source.contains("all.reverse()"));
    }

    #[test]
    fn mark_all_read_records_every_persisted_notification() {
        let mut store = LocalStore::default();
        let items = vec![item("first"), item("second")];

        mark_all_items_read(&mut store, &items);

        assert_eq!(store.read_ids.len(), 2);
        assert!(store.read_ids.contains("first"));
        assert!(store.read_ids.contains("second"));
    }

    #[test]
    fn read_state_drops_ids_for_evicted_notifications() {
        let mut store = LocalStore::default();
        store
            .read_ids
            .extend(["retained".to_string(), "already-evicted".to_string()]);

        assert!(prune_read_state(&mut store, &[item("retained")]));
        assert_eq!(store.read_ids, HashSet::from(["retained".to_string()]));
        assert!(!prune_read_state(&mut store, &[item("retained")]));
    }
}
