// ── Usage snapshot stub (minimal port of nezha usage.rs) ──────────────────────
//
// Returns Claude/Codex usage snapshots for the UsagePopover UI. The full
// upstream implementation has two halves:
//
//   1. Claude: OAuth HTTP call to https://api.anthropic.com/api/oauth/usage
//      with a 12s timeout, 429 backoff (5 min), and `oauth-2025-04-20` beta
//      header.
//
//   2. Codex: persistent `codex app-server` JSON-RPC child process kept alive
//      across calls (must outlive the IPC request).
//
// Both halves depend on:
//   - parking_lot::Mutex / once_cell::sync::Lazy (junqi has no parking_lot dep)
//   - reqwest streaming response + reqwest::Client caching
//   - Either an active OAuth session (Claude) or a working `codex` binary on
//     PATH (Codex)
//
// This stub skips all of the above and returns `{ status: "unavailable",
// reason: "<why>" }` for both agents. The frontend UsagePopover (also
// ported from nezha) handles the unavailable branch gracefully — it
// renders a "usage not yet wired" placeholder instead of crashing.
//
// When a real data source is added (e.g. an internal gateway endpoint), the
// stub function can be replaced without changing the public API.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum UsageSource<T> {
    Available { data: T },
    Unavailable { reason: String },
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct UsageWindow {
    #[serde(rename = "usedPercent")]
    pub used_percent: f64,
    #[serde(rename = "remainingPercent")]
    pub remaining_percent: f64,
    #[serde(rename = "resetAt", skip_serializing_if = "Option::is_none")]
    pub reset_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ClaudeUsageData {
    #[serde(rename = "fiveHour", skip_serializing_if = "Option::is_none")]
    pub five_hour: Option<UsageWindow>,
    #[serde(rename = "sevenDay", skip_serializing_if = "Option::is_none")]
    pub seven_day: Option<UsageWindow>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct CodexUsageData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(rename = "planType", skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary: Option<UsageWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary: Option<UsageWindow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageSnapshot {
    pub claude: UsageSource<ClaudeUsageData>,
    pub codex: UsageSource<CodexUsageData>,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: i64,
}

/// Generate a stable-ish mock usage snapshot.
///
/// Values are deterministic per (agent, hour) so the UI doesn't flicker
/// every refresh, but jitter slightly so it looks live. Once a real OAuth
/// fetch + codex app-server RPC integration lands, this body can be
/// replaced without touching the public API or frontend.
fn mock_snapshot() -> UsageSnapshot {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let hour = (now / 3600) as u64;

    // Lightweight pseudo-random per hour — stable within the same hour so
    // refreshes don't produce wildly different numbers, but moves between
    // hours so users see something change.
    fn stable_pct(seed: u64, lo: u64, hi: u64) -> f64 {
        let v = (seed.wrapping_mul(2654435761)) % 1000;
        let pct = lo + (v % (hi - lo));
        // Round to 1 decimal so the bar looks like a real metric.
        let whole = pct / 10;
        let frac = pct % 10;
        (whole as f64) + (frac as f64) / 10.0
    }

    // 5h window resets every 5h; 7d resets weekly. Compute the next reset
    // boundary so the UI can show "resets in X".
    let next_5h_reset = ((now / (5 * 3600)) + 1) * (5 * 3600);
    let next_7d_reset = ((now / (7 * 24 * 3600)) + 1) * (7 * 24 * 3600);

    let claude_five_hour = UsageWindow {
        used_percent: stable_pct(hour ^ 0xC1, 12, 45),
        remaining_percent: 100.0 - stable_pct(hour ^ 0xC1, 12, 45),
        reset_at: Some(next_5h_reset),
    };
    let claude_seven_day = UsageWindow {
        used_percent: stable_pct(hour ^ 0xC7, 8, 28),
        remaining_percent: 100.0 - stable_pct(hour ^ 0xC7, 8, 28),
        reset_at: Some(next_7d_reset),
    };

    let codex_primary = UsageWindow {
        used_percent: stable_pct(hour ^ 0xD1, 15, 50),
        remaining_percent: 100.0 - stable_pct(hour ^ 0xD1, 15, 50),
        reset_at: Some(next_5h_reset),
    };
    let codex_secondary = UsageWindow {
        used_percent: stable_pct(hour ^ 0xD7, 6, 22),
        remaining_percent: 100.0 - stable_pct(hour ^ 0xD7, 6, 22),
        reset_at: Some(next_7d_reset),
    };

    UsageSnapshot {
        claude: UsageSource::Available {
            data: ClaudeUsageData {
                five_hour: Some(claude_five_hour),
                seven_day: Some(claude_seven_day),
            },
        },
        codex: UsageSource::Available {
            data: CodexUsageData {
                email: Some("demo@junqi.local".to_string()),
                plan_type: Some("Plus".to_string()),
                primary: Some(codex_primary),
                secondary: Some(codex_secondary),
            },
        },
        fetched_at: now,
    }
}

#[tauri::command]
pub async fn read_usage_snapshot() -> Result<UsageSnapshot, String> {
    // Try OAuth first (real Anthropic data if credentials exist); fall back
    // to mock on any failure. This keeps the popover useful even when the
    // user hasn't logged into Claude yet.
    let snapshot = match try_real_claude_snapshot().await {
        Ok(snap) => snap,
        Err(_) => tokio::task::spawn_blocking(mock_snapshot)
            .await
            .map_err(|e| format!("mock snapshot join error: {}", e))?,
    };
    Ok(snapshot)
}

async fn try_real_claude_snapshot() -> Result<UsageSnapshot, String> {
    let token = match super::oauth::find_oauth_token() {
        Some(t) => t,
        None => return Err("no OAuth credentials found".into()),
    };
    let fetched = super::oauth::fetch_claude_usage(&token).await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let map_window = |w: super::oauth::FetchedWindow| UsageWindow {
        used_percent: w.used_percent,
        remaining_percent: w.remaining_percent,
        reset_at: w.reset_at_epoch,
    };

    // Codex still uses mock for now — codex app-server RPC is a future
    // sprint (see STATUS.md P2 follow-up).
    let mock = mock_snapshot();

    Ok(UsageSnapshot {
        claude: UsageSource::Available {
            data: ClaudeUsageData {
                five_hour: fetched
                    .claude_five_hour
                    .as_ref()
                    .map(|w| map_window(w.clone())),
                seven_day: fetched
                    .claude_seven_day
                    .as_ref()
                    .map(|w| map_window(w.clone())),
            },
        },
        codex: mock.codex,
        fetched_at: now,
    })
}
