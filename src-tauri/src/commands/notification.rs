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
//   - read/clear commands — mutate either all records or an explicit record set

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
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(rename = "dedupeKey", default)]
    pub dedupe_key: Option<String>,
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

#[derive(Debug, Clone, Serialize)]
pub struct NotificationPushResult {
    pub item: NotificationItem,
    pub inserted: bool,
}

fn create_notification(
    level: &str,
    title: &str,
    body: &str,
    url: Option<&str>,
) -> NotificationItem {
    let level = match level {
        "warning" | "error" | "attention" | "completed" => level,
        _ => "info",
    };
    NotificationItem {
        id: format!("local-{}", uuid::Uuid::new_v4()),
        level: level.to_string(),
        title: sanitize_text(title, 200),
        body: sanitize_text(body, 4_000),
        body_zh: None,
        agent: None,
        dedupe_key: None,
        url: url.map(|value| sanitize_text(value, 2_000)),
        created_at: chrono::Utc::now().to_rfc3339(),
        is_read: false,
    }
}

fn create_frontend_notification(
    level: &str,
    title: &str,
    body: &str,
    url: Option<&str>,
    agent: Option<&str>,
    dedupe_key: Option<&str>,
) -> NotificationItem {
    let mut item = create_notification(level, title, body, url);
    item.agent = agent
        .map(|value| sanitize_text(value.trim(), 64))
        .filter(|value| !value.is_empty());
    item.dedupe_key = dedupe_key
        .map(|value| sanitize_text(value.trim(), 512))
        .filter(|value| !value.is_empty());
    item
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

const MAX_NOTIFICATION_MUTATION_IDS: usize = 50;

fn normalized_notification_ids(ids: Vec<String>) -> HashSet<String> {
    ids.into_iter()
        .take(MAX_NOTIFICATION_MUTATION_IDS)
        .map(|id| sanitize_text(id.trim(), 100))
        .filter(|id| !id.is_empty())
        .collect()
}

fn mark_selected_items_read(
    store: &mut LocalStore,
    items: &[NotificationItem],
    selected_ids: &HashSet<String>,
) {
    store.read_ids.extend(
        items
            .iter()
            .filter(|item| selected_ids.contains(&item.id))
            .map(|item| item.id.clone()),
    );
}

fn remove_selected_items(
    items: &mut Vec<NotificationItem>,
    store: &mut LocalStore,
    selected_ids: &HashSet<String>,
) -> bool {
    let previous_len = items.len();
    items.retain(|item| !selected_ids.contains(&item.id));
    if items.len() == previous_len {
        return false;
    }
    let _ = prune_read_state(store, items);
    true
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

fn persist_notification(item: NotificationItem) -> Result<NotificationPushResult, String> {
    let _guard = repository_gate()
        .lock()
        .map_err(|_| "Notification repository lock is poisoned".to_string())?;
    let repository = NotificationRepository::discover()?;
    let mut existing = repository.load_items();
    let (stored, inserted) = append_notification(&mut existing, item);
    if inserted {
        repository.save_items(&existing)?;
    }
    Ok(NotificationPushResult {
        item: stored,
        inserted,
    })
}

fn append_notification(
    existing: &mut Vec<NotificationItem>,
    item: NotificationItem,
) -> (NotificationItem, bool) {
    if let Some(dedupe_key) = item.dedupe_key.as_deref() {
        if let Some(previous) = existing
            .iter()
            .find(|candidate| candidate.dedupe_key.as_deref() == Some(dedupe_key))
        {
            return (previous.clone(), false);
        }
    }
    if let Some(previous) = existing
        .iter()
        .rev()
        .find(|candidate| is_recent_chat_transport_duplicate(candidate, &item))
    {
        return (previous.clone(), false);
    }
    if existing.len() >= 50 {
        existing.drain(0..existing.len() - 49);
    }
    existing.push(item.clone());
    (item, true)
}

/// Repairs only historical records with the exact same upstream identity.
/// Records without an identity deliberately remain distinct: matching their
/// display text would hide real independent events.
// Match the Gateway terminal/transcript mirror fence. Historical records do
// not carry the upstream run identity, so this is intentionally the only
// text-based repair we perform and only for immediately adjacent records.
const LEGACY_UNIDENTIFIED_DUPLICATE_WINDOW_MS: i64 = 120_000;

fn chat_notification_scope(item: &NotificationItem) -> Option<(&str, &str)> {
    let key = item.dedupe_key.as_deref()?;
    let (role, remainder) = key.strip_prefix("chat:")?.split_once(':')?;
    if !matches!(role, "assistant" | "user") {
        return None;
    }
    let (session_key, identity) = remainder.rsplit_once(':')?;
    if session_key.trim().is_empty() || identity.trim().is_empty() {
        return None;
    }
    Some((role, session_key))
}

fn notification_elapsed_millis(
    previous: &NotificationItem,
    candidate: &NotificationItem,
) -> Option<i64> {
    let previous_at = chrono::DateTime::parse_from_rfc3339(&previous.created_at).ok()?;
    let candidate_at = chrono::DateTime::parse_from_rfc3339(&candidate.created_at).ok()?;
    Some(
        candidate_at
            .signed_duration_since(previous_at)
            .num_milliseconds(),
    )
}

/// Handles a narrow Gateway compatibility gap: older event transports can
/// describe one reply with different native and client message identifiers.
/// Identity remains the normal contract; this only rejects an immediate,
/// semantically identical chat mirror in the same session and role.
fn is_recent_chat_transport_duplicate(
    previous: &NotificationItem,
    candidate: &NotificationItem,
) -> bool {
    let (previous_role, previous_session) = match chat_notification_scope(previous) {
        Some(scope) => scope,
        None => return false,
    };
    let (candidate_role, candidate_session) = match chat_notification_scope(candidate) {
        Some(scope) => scope,
        None => return false,
    };
    previous_role == candidate_role
        && previous_session == candidate_session
        && previous.title == candidate.title
        && previous.body == candidate.body
        && previous.body_zh == candidate.body_zh
        && notification_elapsed_millis(previous, candidate)
            .is_some_and(|elapsed| (0..=LEGACY_UNIDENTIFIED_DUPLICATE_WINDOW_MS).contains(&elapsed))
}

fn is_legacy_unidentified_duplicate(
    previous: &NotificationItem,
    candidate: &NotificationItem,
) -> bool {
    if previous.dedupe_key.is_some()
        || candidate.dedupe_key.is_some()
        || previous.level != candidate.level
        || previous.title != candidate.title
        || previous.body != candidate.body
        || previous.body_zh != candidate.body_zh
        || previous.agent != candidate.agent
        || previous.url != candidate.url
    {
        return false;
    }

    notification_elapsed_millis(previous, candidate)
        .is_some_and(|elapsed| (0..=LEGACY_UNIDENTIFIED_DUPLICATE_WINDOW_MS).contains(&elapsed))
}

/// Repairs persisted records written before chat notification identity existed.
///
/// This migration is deliberately narrower than normal notification delivery:
/// only adjacent, fully identical records created within the same immediate
/// delivery window can be replaced. All current and future delivery continues
/// to rely on the authoritative upstream identity in `dedupe_key`.
fn deduplicate_persisted_notifications(items: &mut Vec<NotificationItem>) -> bool {
    let previous_len = items.len();
    let mut seen_keys = HashSet::new();
    let mut retained = Vec::with_capacity(items.len());

    // Storage is chronological. Keep the newest version of an identity when
    // cleaning records produced by an older client implementation.
    for item in items.drain(..).rev() {
        let is_duplicate = item
            .dedupe_key
            .as_deref()
            .is_some_and(|key| !seen_keys.insert(key.to_string()));
        if !is_duplicate {
            retained.push(item);
        }
    }
    retained.reverse();
    *items = retained;

    let mut chat_retained = Vec::with_capacity(items.len());
    for item in items.drain(..) {
        if let Some(index) = chat_retained
            .iter()
            .rposition(|previous| is_recent_chat_transport_duplicate(previous, &item))
        {
            // The more recent item owns both the display content and its
            // chronological position, even when an unrelated notification
            // arrived between the two Gateway transport projections.
            chat_retained.remove(index);
        }
        chat_retained.push(item);
    }
    *items = chat_retained;

    let mut legacy_retained = Vec::with_capacity(items.len());
    for item in items.drain(..) {
        if legacy_retained
            .last()
            .is_some_and(|previous| is_legacy_unidentified_duplicate(previous, &item))
        {
            // The repository is chronological. Preserve the newer historical
            // record so read state and order agree with normal keyed cleanup.
            if let Some(previous) = legacy_retained.last_mut() {
                *previous = item;
            } else {
                legacy_retained.push(item);
            }
        } else {
            legacy_retained.push(item);
        }
    }
    *items = legacy_retained;
    items.len() != previous_len
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
        let items_changed = deduplicate_persisted_notifications(&mut all);
        if items_changed {
            repository.save_items(&all)?;
        }
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
    agent: Option<String>,
    dedupe_key: Option<String>,
) -> Result<NotificationPushResult, String> {
    tokio::task::spawn_blocking(move || {
        if title.trim().is_empty() {
            return Err("Notification title is required".to_string());
        }
        persist_notification(create_frontend_notification(
            &level,
            &title,
            &body,
            url.as_deref(),
            agent.as_deref(),
            dedupe_key.as_deref(),
        ))
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
pub async fn mark_all_notifications_read(ids: Option<Vec<String>>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let _guard = repository_gate()
            .lock()
            .map_err(|_| "Notification repository lock is poisoned".to_string())?;
        let repository = NotificationRepository::discover()?;
        let mut store = repository.load_store();
        let items = repository.load_items();
        if let Some(ids) = ids {
            let selected_ids = normalized_notification_ids(ids);
            mark_selected_items_read(&mut store, &items, &selected_ids);
        } else {
            mark_all_items_read(&mut store, &items);
        }
        repository.save_store(&store)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_notifications(ids: Option<Vec<String>>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let _guard = repository_gate()
            .lock()
            .map_err(|_| "Notification repository lock is poisoned".to_string())?;
        let repository = NotificationRepository::discover()?;
        if let Some(ids) = ids {
            let selected_ids = normalized_notification_ids(ids);
            let mut items = repository.load_items();
            let mut store = repository.load_store();
            if remove_selected_items(&mut items, &mut store, &selected_ids) {
                repository.save_items(&items)?;
                repository.save_store(&store)?;
            }
            Ok(())
        } else {
            repository.save_items(&[])?;
            repository.save_store(&LocalStore::default())
        }
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
            agent: None,
            dedupe_key: None,
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
    fn terminal_attention_and_completion_levels_survive_persistence() {
        assert_eq!(
            create_notification("attention", "needs input", "tab", None).level,
            "attention"
        );
        assert_eq!(
            create_notification("completed", "finished", "tab", None).level,
            "completed"
        );
    }

    #[test]
    fn frontend_agent_metadata_is_optional_and_sanitized() {
        let item = create_frontend_notification(
            "attention",
            "needs input",
            "tab",
            None,
            Some("claude\0"),
            Some(" event\0 "),
        );
        assert_eq!(item.agent.as_deref(), Some("claude"));
        assert_eq!(item.dedupe_key.as_deref(), Some("event"));

        let without_agent = create_frontend_notification(
            "attention",
            "needs input",
            "tab",
            None,
            Some("  "),
            Some("  "),
        );
        assert_eq!(without_agent.agent, None);
        assert_eq!(without_agent.dedupe_key, None);
    }

    #[test]
    fn notification_identity_prevents_duplicate_persistence() {
        let mut items = vec![item("first")];
        items[0].dedupe_key = Some("chat:assistant:agent:main:main:run-42".to_string());

        let mut duplicate = item("second");
        duplicate.dedupe_key = Some("chat:assistant:agent:main:main:run-42".to_string());
        let (stored, inserted) = append_notification(&mut items, duplicate);

        assert!(!inserted);
        assert_eq!(stored.id, "first");
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn immediate_chat_transport_mirrors_with_different_ids_are_not_persisted_twice() {
        let mut first = item("first");
        first.created_at = "2026-08-02T08:00:00Z".to_string();
        first.dedupe_key = Some("chat:assistant:agent:main:main:live-message".to_string());

        let mut mirror = item("durable");
        mirror.created_at = "2026-08-02T08:01:00Z".to_string();
        mirror.dedupe_key = Some("chat:assistant:agent:main:main:durable-message".to_string());

        let mut items = vec![first];
        let (stored, inserted) = append_notification(&mut items, mirror);

        assert!(!inserted);
        assert_eq!(stored.id, "first");
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn chat_transport_fallback_does_not_merge_another_session_or_later_reply() {
        let mut first = item("first");
        first.created_at = "2026-08-02T08:00:00Z".to_string();
        first.dedupe_key = Some("chat:assistant:agent:main:first:live-message".to_string());

        let mut another_session = item("second");
        another_session.created_at = "2026-08-02T08:01:00Z".to_string();
        another_session.dedupe_key =
            Some("chat:assistant:agent:main:second:durable-message".to_string());
        let mut items = vec![first.clone()];
        assert!(append_notification(&mut items, another_session).1);

        let mut later = item("later");
        later.created_at = "2026-08-02T08:02:01Z".to_string();
        later.dedupe_key = Some("chat:assistant:agent:main:first:later-message".to_string());
        let mut items = vec![first];
        assert!(append_notification(&mut items, later).1);
    }

    #[test]
    fn persisted_notification_cleanup_keeps_the_newest_duplicate_identity() {
        let mut first = item("first");
        first.dedupe_key = Some("chat:assistant:agent:main:main:run-42".to_string());
        let mut latest = item("latest");
        latest.dedupe_key = Some("chat:assistant:agent:main:main:run-42".to_string());
        let without_identity = item("independent");
        let mut items = vec![first, without_identity, latest];

        assert!(deduplicate_persisted_notifications(&mut items));
        assert_eq!(
            items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["independent", "latest"]
        );
        assert!(!deduplicate_persisted_notifications(&mut items));
    }

    #[test]
    fn persisted_cleanup_repairs_recent_chat_transport_mirrors_with_different_ids() {
        let mut live = item("live");
        live.created_at = "2026-08-02T08:00:00Z".to_string();
        live.dedupe_key = Some("chat:assistant:agent:main:main:live-message".to_string());
        let mut durable = item("durable");
        durable.created_at = "2026-08-02T08:01:00Z".to_string();
        durable.dedupe_key = Some("chat:assistant:agent:main:main:durable-message".to_string());
        let mut items = vec![live, durable];

        assert!(deduplicate_persisted_notifications(&mut items));
        assert_eq!(
            items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["durable"]
        );
    }

    #[test]
    fn persisted_cleanup_repairs_chat_transport_mirrors_separated_by_another_notification() {
        let mut live = item("live");
        live.created_at = "2026-08-02T08:00:00Z".to_string();
        live.dedupe_key = Some("chat:assistant:agent:main:main:live-message".to_string());
        let mut unrelated = item("unrelated");
        unrelated.created_at = "2026-08-02T08:00:30Z".to_string();
        unrelated.dedupe_key = Some("task:agent:main:run-1".to_string());
        let mut durable = item("durable");
        durable.created_at = "2026-08-02T08:01:00Z".to_string();
        durable.dedupe_key = Some("chat:assistant:agent:main:main:durable-message".to_string());
        let mut items = vec![live, unrelated, durable];

        assert!(deduplicate_persisted_notifications(&mut items));
        assert_eq!(
            items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["unrelated", "durable"],
        );
    }

    #[test]
    fn notifications_without_identity_are_kept_as_distinct_events() {
        let mut items = vec![item("first")];
        let (stored, inserted) = append_notification(&mut items, item("second"));

        assert!(inserted);
        assert_eq!(stored.id, "second");
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn cleanup_repairs_legacy_terminal_transcript_mirror_notifications() {
        let mut first = item("first");
        first.created_at = "2026-08-01T15:37:01.967983+00:00".to_string();
        let mut duplicate = item("duplicate");
        duplicate.created_at = "2026-08-01T15:39:01.084481+00:00".to_string();
        let mut independent = item("independent");
        independent.created_at = "2026-08-01T15:41:02.000000+00:00".to_string();
        let mut items = vec![first, duplicate, independent];

        assert!(deduplicate_persisted_notifications(&mut items));
        assert_eq!(
            items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["duplicate", "independent"]
        );
    }

    #[test]
    fn cleanup_keeps_legacy_notifications_with_distinct_delivery_times() {
        let mut first = item("first");
        first.created_at = "2026-08-01T15:37:01+00:00".to_string();
        let mut later = item("later");
        later.created_at = "2026-08-01T15:39:02+00:00".to_string();
        let mut items = vec![first, later];

        assert!(!deduplicate_persisted_notifications(&mut items));
        assert_eq!(items.len(), 2);
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
    fn selected_read_and_clear_operations_leave_other_notifications_unchanged() {
        let mut store = LocalStore::default();
        let mut items = vec![item("agent"), item("workflow")];
        let selected =
            normalized_notification_ids(vec!["agent".to_string(), "missing".to_string()]);

        mark_selected_items_read(&mut store, &items, &selected);
        assert_eq!(store.read_ids, HashSet::from(["agent".to_string()]));

        assert!(remove_selected_items(&mut items, &mut store, &selected));
        assert_eq!(
            items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["workflow"]
        );
        assert!(store.read_ids.is_empty());
    }

    #[test]
    fn selected_notification_ids_are_bounded_and_sanitized() {
        let ids = normalized_notification_ids(
            std::iter::once("valid".to_string())
                .chain(std::iter::once("bad\0id".to_string()))
                .chain((0..MAX_NOTIFICATION_MUTATION_IDS).map(|index| format!("item-{index}")))
                .collect(),
        );

        assert!(ids.contains("valid"));
        assert!(ids.contains("badid"));
        assert!(ids.len() <= MAX_NOTIFICATION_MUTATION_IDS);
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
