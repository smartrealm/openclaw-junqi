//! Provider OAuth browser flow — PKCE + localhost callback + token exchange.
//!
//! //! Stores the resulting tokens via secret_store so they survive app restarts.
//!
//! Flow:
//!   1. Frontend calls start_provider_oauth(provider_id, account_id, label)
//!   2. This function generates PKCE verifier/challenge, opens the system
//!      browser to the provider's authorize URL.
//!   3. A localhost TCP listener captures the authorization code redirect.
//!   4. The code is exchanged for an access_token + refresh_token.
//!   5. Tokens are stored via secret_store with the given account_id.
//!   6. An `oauth:complete` event is emitted with the result.

use crate::commands::secret_store::store_provider_secret;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::SocketAddr;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::time::Duration;

const OAUTH_CALLBACK_PORT: u16 = 1455;
const CALLBACK_PATH: &str = "/auth/callback";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);

// ── Provider config map (same data as providerTemplates.ts) ────────────

struct OAuthConfig {
    authorize_url: &'static str,
    token_url: &'static str,
    client_id: &'static str,
    scope: &'static str,
}

fn oauth_configs() -> HashMap<&'static str, OAuthConfig> {
    let mut m = HashMap::new();
    m.insert("openai", OAuthConfig {
        authorize_url: "https://auth.openai.com/oauth/authorize",
        token_url: "https://auth.openai.com/oauth/token",
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        scope: "openid profile email offline_access",
    });
    m.insert("minimax-portal", OAuthConfig {
        authorize_url: "https://api.minimax.io/oauth/authorize",
        token_url: "https://api.minimax.io/oauth/token",
        client_id: "minimax-app",
        scope: "openid profile offline_access",
    });
    m.insert("minimax-portal-cn", OAuthConfig {
        authorize_url: "https://api.minimaxi.com/oauth/authorize",
        token_url: "https://api.minimaxi.com/oauth/token",
        client_id: "minimax-cn-app",
        scope: "openid profile offline_access",
    });
    m
}

// ── PKCE ────────────────────────────────────────────────────────────────

fn base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

fn pkce_verifier() -> String {
    base64url(&random_bytes(32))
}

fn pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    base64url(&hasher.finalize())
}

// ── Authorize URL builder ───────────────────────────────────────────────

fn build_authorize_url(cfg: &OAuthConfig, state: &str, challenge: &str) -> String {
    let redirect_uri = format!("http://localhost:{}{}", OAUTH_CALLBACK_PORT, CALLBACK_PATH);
    let mut url = url::Url::parse(cfg.authorize_url).expect("static URL must parse");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", cfg.client_id);
        q.append_pair("redirect_uri", &redirect_uri);
        q.append_pair("scope", cfg.scope);
        q.append_pair("state", state);
        q.append_pair("code_challenge", challenge);
        q.append_pair("code_challenge_method", "S256");
    }
    url.to_string()
}

// ── Token exchange ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

async fn exchange_code(cfg: &OAuthConfig, code: &str, verifier: &str) -> Result<TokenResponse, String> {
    let redirect_uri = format!("http://localhost:{}{}", OAUTH_CALLBACK_PORT, CALLBACK_PATH);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("build client: {e}"))?;
    let resp = client
        .post(cfg.token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", cfg.client_id),
            ("code_verifier", verifier),
        ])
        .send()
        .await
        .map_err(|e| format!("token request: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("token endpoint {}: {body}", status.as_u16()));
    }
    serde_json::from_str(&body).map_err(|e| format!("parse token: {e}"))
}

// ── Callback listener ───────────────────────────────────────────────────

async fn wait_for_oauth_callback() -> Result<String, String> {
    let addr: SocketAddr = ([127, 0, 0, 1], OAUTH_CALLBACK_PORT).into();
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("bind callback port: {e}"))?;

    let result = tokio::time::timeout(CALLBACK_TIMEOUT, async {
        loop {
            let (mut socket, _) = listener.accept().await
                .map_err(|e| format!("accept: {e}"))?;
            let mut buf = vec![0u8; 4096];
            let n = tokio::io::AsyncReadExt::read(&mut socket, &mut buf)
                .await
                .map_err(|e| format!("read: {e}"))?;
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let code = req.lines().next()
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|p| url::Url::parse(&format!("http://localhost{p}")).ok())
                .and_then(|u| u.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.into_owned()));
            let html = match &code {
                Some(_) => { let _ = tokio::io::AsyncWriteExt::shutdown(&mut socket).await; return Ok(code.unwrap()); },
                None => "<!doctype html><html><body><h1>Authentication failed</h1><p>No code received.</p></body></html>",
            };
            if code.is_none() {
                let resp = format!("HTTP/1.1 200\r\nContent-Length: {}\r\nContent-Type: text/html\r\n\r\n{}", html.len(), html);
                let _ = tokio::io::AsyncWriteExt::write_all(&mut socket, resp.as_bytes()).await;
                let _ = tokio::io::AsyncWriteExt::shutdown(&mut socket).await;
            }
        }
    }).await;

    match result {
        Ok(Ok(code)) => Ok(code),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(format!("timed out after {:?}", CALLBACK_TIMEOUT)),
    }
}

// ── Outcome event ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
struct OAuthOutcome {
    provider: String,
    account_id: String,
    success: bool,
    error: Option<String>,
}

// ── Tauri command ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_provider_oauth(
    app: AppHandle,
    provider: String,
    account_id: String,
    label: String,
) -> Result<(), String> {
    let configs = oauth_configs();
    let cfg = configs
        .get(provider.as_str())
        .ok_or_else(|| format!("unsupported OAuth provider: {provider}"))?;

    // 1. Generate PKCE.
    let state = base64url(&random_bytes(16));
    let verifier = pkce_verifier();
    let challenge = pkce_challenge(&verifier);

    // 2. Build and open authorize URL.
    let url = build_authorize_url(cfg, &state, &challenge);
    use tauri_plugin_shell::ShellExt;
    app.shell()
        .open(url, None)
        .map_err(|e| format!("open browser: {e}"))?;

    // 3. ALL synchronous from here — no task spawn. The Tauri command
    //    blocks until the callback arrives (up to 180s). This avoids
    //    the State<T> lifetime issues in async Tauri commands.
    let code = wait_for_oauth_callback().await?;
    let tokens = exchange_code(cfg, &code, &verifier).await?;
    let access = tokens.access_token.ok_or("no access_token in response".to_string())?;

    // 4. Persist to secret store.
    store_provider_secret(account_id.clone(), label.clone(), access).await?;

    // 5. Emit success.
    let outcome = OAuthOutcome {
        provider: provider.clone(),
        account_id: account_id.clone(),
        success: true,
        error: None,
    };
    let _ = app.emit("oauth:complete", &outcome);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_verifier_has_no_padding() {
        let v = pkce_verifier();
        assert!(!v.ends_with('='));
        assert!(!v.contains('+'));
        assert!(!v.contains('/'));
    }

    #[test]
    fn pkce_challenge_differs_from_verifier() {
        let v = pkce_verifier();
        let c = pkce_challenge(&v);
        assert_ne!(v, c);
        assert_eq!(c.len(), 43); // 32 bytes sha256 → 43 base64url chars
    }

    #[test]
    fn configs_contains_openai() {
        let m = oauth_configs();
        let openai = m.get("openai").unwrap();
        assert!(openai.authorize_url.starts_with("https://"));
        assert!(openai.token_url.contains("oauth"));
    }

    #[test]
    fn build_url_contains_pkce_params() {
        let configs = oauth_configs();
        let cfg = configs.get("openai").unwrap();
        let url = build_authorize_url(cfg, "mystate", "mychallenge");
        assert!(url.contains("code_challenge=mychallenge"));
        assert!(url.contains("state=mystate"));
        assert!(url.contains("code_challenge_method=S256"));
    }
}