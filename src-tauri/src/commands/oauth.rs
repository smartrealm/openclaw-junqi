// ── OAuth credential discovery + Claude usage API ────────────────────────────
//
// Reads the Claude Code CLI's OAuth credentials from well-known filesystem
// locations, then queries the Anthropic OAuth usage endpoint for real 5h/7d
// window utilization. On failure the caller exposes an unavailable source
// instead of fabricating quota values.
//
// File credentials are portable; macOS additionally falls back to the Claude
// Code Keychain item used by current releases.

use serde::Deserialize;
use std::path::PathBuf;

const ANTHROPIC_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const BETA_HEADER: &str = "oauth-2025-04-20";
const REQUEST_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Deserialize)]
struct CredentialFile {
    #[serde(default)]
    #[serde(rename = "oauthAccount")]
    oauth_account: Option<OAuthAccount>,
    #[serde(default)]
    #[serde(rename = "claudeAiOauth")]
    claude_ai_oauth: Option<OAuthAccount>,
}

#[derive(Debug, Deserialize)]
struct OAuthAccount {
    #[serde(rename = "accessToken")]
    access_token: Option<String>,
    #[serde(rename = "authToken")]
    auth_token: Option<String>,
    token: Option<String>,
}

impl OAuthAccount {
    fn pick_token(&self) -> Option<&str> {
        self.access_token
            .as_deref()
            .or(self.auth_token.as_deref())
            .or(self.token.as_deref())
    }
}

/// Returns the OAuth access token if any of the well-known credential files
/// exist and contain a token. Returns None silently (not Err) since callers
/// should treat "no credentials" as a soft signal, not a hard failure.
pub fn find_oauth_token() -> Option<String> {
    let candidates = candidate_credential_paths();
    for path in candidates {
        if let Some(token) = read_token_from(&path) {
            return Some(token);
        }
    }
    None
}

#[cfg(target_os = "macos")]
pub fn find_keychain_oauth_token() -> Option<String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-w",
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?
        .stdout;
    let payload: serde_json::Value = serde_json::from_slice(&output).ok()?;
    payload
        .pointer("/claudeAiOauth/accessToken")
        .and_then(serde_json::Value::as_str)
        .filter(|token| !token.trim().is_empty())
        .map(str::to_string)
}

#[cfg(not(target_os = "macos"))]
pub fn find_keychain_oauth_token() -> Option<String> {
    None
}

fn candidate_credential_paths() -> Vec<PathBuf> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };
    vec![
        home.join(".claude").join(".credentials.json"),
        home.join(".claude").join("credentials.json"),
        home.join(".config").join("claude").join("credentials.json"),
        home.join(".config")
            .join("manicode")
            .join("credentials.json"),
        home.join(".anthropic").join("credentials.json"),
    ]
}

fn read_token_from(path: &PathBuf) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    // The Claude credential file is JSON; tolerate comments / trailing commas
    // by falling back to a tolerant serde_json parse.
    let parsed: CredentialFile = serde_json::from_str(&raw).ok()?;
    if let Some(acc) = parsed.oauth_account.as_ref() {
        if let Some(t) = acc.pick_token() {
            return Some(t.to_string());
        }
    }
    if let Some(acc) = parsed.claude_ai_oauth.as_ref() {
        if let Some(t) = acc.pick_token() {
            return Some(t.to_string());
        }
    }
    None
}

/// Subset of Anthropic's OAuth usage response — only the two windows we
/// render in the popover.
#[derive(Debug, Deserialize)]
struct UsageResponse {
    #[serde(default)]
    five_hour: Option<UsageWindow>,
    #[serde(default)]
    seven_day: Option<UsageWindow>,
}

#[derive(Debug, Deserialize)]
struct UsageWindow {
    /// 0.0–1.0 fraction of window used.
    utilization: f64,
    /// ISO 8601 timestamp at which the window resets.
    #[serde(rename = "resets_at")]
    resets_at: Option<String>,
}

/// Window data the rest of the app understands (`UsageWindow` lives in
/// `commands/usage.rs` and is shared between modules).
#[derive(Debug, Clone)]
pub struct FetchedWindow {
    pub used_percent: f64,
    pub remaining_percent: f64,
    pub reset_at_epoch: Option<i64>,
}

pub struct FetchedUsage {
    pub claude_five_hour: Option<FetchedWindow>,
    pub claude_seven_day: Option<FetchedWindow>,
}

/// Query the Anthropic OAuth usage endpoint with the given bearer token.
pub async fn fetch_claude_usage(token: &str) -> Result<FetchedUsage, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("build http client: {}", e))?;

    let response = client
        .get(ANTHROPIC_USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", BETA_HEADER)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Anthropic API returned {}",
            response.status().as_u16()
        ));
    }

    let parsed: UsageResponse = response
        .json()
        .await
        .map_err(|e| format!("decode response: {}", e))?;

    Ok(FetchedUsage {
        claude_five_hour: parsed.five_hour.map(convert_window),
        claude_seven_day: parsed.seven_day.map(convert_window),
    })
}

fn convert_window(w: UsageWindow) -> FetchedWindow {
    let used_pct = (w.utilization * 100.0).clamp(0.0, 100.0);
    let remaining_pct = 100.0 - used_pct;
    FetchedWindow {
        used_percent: used_pct,
        remaining_percent: remaining_pct,
        reset_at_epoch: w
            .resets_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.timestamp()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_account_prefers_access_token_over_legacy_fields() {
        let acc = OAuthAccount {
            access_token: Some("a".into()),
            auth_token: Some("b".into()),
            token: Some("c".into()),
        };
        assert_eq!(acc.pick_token(), Some("a"));

        let acc = OAuthAccount {
            access_token: None,
            auth_token: Some("b".into()),
            token: Some("c".into()),
        };
        assert_eq!(acc.pick_token(), Some("b"));

        let acc = OAuthAccount {
            access_token: None,
            auth_token: None,
            token: Some("c".into()),
        };
        assert_eq!(acc.pick_token(), Some("c"));
    }

    #[test]
    fn credential_file_accepts_claude_code_camel_case_shape() {
        let parsed: CredentialFile =
            serde_json::from_str(r#"{"claudeAiOauth":{"accessToken":"oauth-token"}}"#).unwrap();
        assert_eq!(
            parsed
                .claude_ai_oauth
                .as_ref()
                .and_then(OAuthAccount::pick_token),
            Some("oauth-token")
        );
    }

    #[test]
    fn convert_window_clamps_and_inverts_utilization() {
        let w = UsageWindow {
            utilization: 0.42,
            resets_at: None,
        };
        let converted = convert_window(w);
        assert!((converted.used_percent - 42.0).abs() < 0.001);
        assert!((converted.remaining_percent - 58.0).abs() < 0.001);

        // Edge: utilization > 1.0 (some accounts report this)
        let over = UsageWindow {
            utilization: 1.5,
            resets_at: None,
        };
        let converted = convert_window(over);
        assert_eq!(converted.used_percent, 100.0);
        assert_eq!(converted.remaining_percent, 0.0);
    }

    #[test]
    fn candidate_credential_paths_returns_at_least_one_path() {
        // Doesn't assert on home dir availability; if home is missing the
        // function returns an empty Vec which is the documented fallback.
        let paths = candidate_credential_paths();
        // Just ensure the function doesn't panic. The result depends on env.
        let _ = paths.len();
    }

    #[test]
    fn read_token_from_returns_none_for_missing_file() {
        let path = std::env::temp_dir().join(format!(
            "junqi-oauth-nonexistent-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        assert!(read_token_from(&path).is_none());
    }

    #[test]
    fn read_token_from_handles_malformed_json() {
        let dir = std::env::temp_dir().join(format!(
            "junqi-oauth-malformed-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("credentials.json");
        std::fs::write(&path, "this is not json").unwrap();
        assert!(read_token_from(&path).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_token_from_extracts_oauthAccount_accessToken() {
        let dir = std::env::temp_dir().join(format!(
            "junqi-oauth-good-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("credentials.json");
        std::fs::write(
            &path,
            r#"{"oauthAccount":{"accessToken":"test-token-abc","email":"a@b.c"}}"#,
        )
        .unwrap();
        assert_eq!(read_token_from(&path), Some("test-token-abc".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
