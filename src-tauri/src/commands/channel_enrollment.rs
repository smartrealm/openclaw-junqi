use crate::paths;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use parking_lot::Mutex;
use qrcode::{Color, QrCode};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    pin::Pin,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;
use url::Url;
use uuid::Uuid;

const REGISTRATION_PATH: &str = "/oauth/v1/app/registration";
const FEISHU_ACCOUNTS_URL: &str = "https://accounts.feishu.cn";
const LARK_ACCOUNTS_URL: &str = "https://accounts.larksuite.com";
const FEISHU_REGISTRATION_HOSTS: &[&str] = &[
    "accounts.feishu.cn",
    "accounts.larksuite.com",
    "open.feishu.cn",
    "open.larksuite.com",
];
const REGISTRATION_TIMEOUT: Duration = Duration::from_secs(15);
const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(5);
const DEFAULT_EXPIRY: Duration = Duration::from_secs(600);
const MAX_POLL_INTERVAL: Duration = Duration::from_secs(60);
const MAX_ACTIVE_SESSIONS: usize = 16;

/// Process-local registry for channel enrollment transactions. The registry
/// deliberately owns device codes and generated credentials so neither is
/// persisted to a temporary file or included in renderer logs.
pub struct ChannelEnrollmentRegistry {
    client: Client,
    sessions: Mutex<HashMap<String, EnrollmentSession>>,
}

impl Default for ChannelEnrollmentRegistry {
    fn default() -> Self {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(REGISTRATION_TIMEOUT)
            .user_agent("JunQi Desktop channel enrollment")
            .build()
            .expect("channel enrollment HTTP client configuration must be valid");
        Self {
            client,
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EnrollmentChannel {
    Feishu,
}

impl EnrollmentChannel {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "feishu" => Ok(Self::Feishu),
            _ => Err("This channel does not provide desktop QR enrollment yet.".into()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Feishu => "feishu",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FeishuDomain {
    Feishu,
    Lark,
}

impl FeishuDomain {
    fn parse(value: Option<&str>) -> Result<Self, EnrollmentError> {
        match value.map(str::trim).filter(|value| !value.is_empty()) {
            None | Some("feishu") => Ok(Self::Feishu),
            Some("lark") => Ok(Self::Lark),
            Some(_) => Err(EnrollmentError::permanent()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Feishu => "feishu",
            Self::Lark => "lark",
        }
    }

    fn accounts_url(self) -> &'static str {
        match self {
            Self::Feishu => FEISHU_ACCOUNTS_URL,
            Self::Lark => LARK_ACCOUNTS_URL,
        }
    }
}

#[derive(Clone)]
struct FeishuRegistration {
    device_code: String,
    domain: FeishuDomain,
}

#[derive(Clone)]
enum ProviderRegistration {
    Feishu(FeishuRegistration),
}

#[derive(Clone)]
struct EnrollmentCredentials {
    app_id: String,
    app_secret: String,
    domain: FeishuDomain,
}

enum EnrollmentState {
    Waiting,
    Polling,
    Completed(EnrollmentCredentials),
    Denied,
    Expired,
    Failed,
}

struct EnrollmentSession {
    channel: EnrollmentChannel,
    registration: ProviderRegistration,
    state: EnrollmentState,
    qr_data_url: String,
    qr_content: String,
    poll_after: Duration,
    expires_at: Instant,
    expires_at_ms: u64,
    config_path: PathBuf,
}

impl EnrollmentSession {
    fn is_expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }

    fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            EnrollmentState::Completed(_)
                | EnrollmentState::Denied
                | EnrollmentState::Expired
                | EnrollmentState::Failed
        )
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum EnrollmentPhase {
    Waiting,
    Connected,
    Denied,
    Expired,
    Error,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelEnrollmentSnapshot {
    session_id: String,
    channel: &'static str,
    phase: EnrollmentPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    qr_data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    qr_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    poll_after_ms: Option<u64>,
    expires_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    domain: Option<&'static str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChannelEnrollmentCredential {
    AppId,
    AppSecret,
}

#[derive(Clone)]
struct ProviderStart {
    registration: ProviderRegistration,
    qr_url: String,
    poll_after: Duration,
    expires_in: Duration,
}

enum ProviderPoll {
    Waiting {
        registration: ProviderRegistration,
        poll_after: Duration,
    },
    Completed(EnrollmentCredentials),
    Denied,
    Expired,
    Failed,
}

#[derive(Clone, Copy)]
enum EnrollmentErrorKind {
    Transient,
    Permanent,
}

struct EnrollmentError {
    kind: EnrollmentErrorKind,
    public_message: Option<&'static str>,
}

impl EnrollmentError {
    fn transient() -> Self {
        Self {
            kind: EnrollmentErrorKind::Transient,
            public_message: None,
        }
    }

    fn permanent() -> Self {
        Self {
            kind: EnrollmentErrorKind::Permanent,
            public_message: None,
        }
    }

    fn is_transient(&self) -> bool {
        matches!(self.kind, EnrollmentErrorKind::Transient)
    }

    fn unsupported_verification_host() -> Self {
        Self {
            kind: EnrollmentErrorKind::Permanent,
            public_message: Some("Feishu returned an unrecognized QR entry host. Update JunQi and try again."),
        }
    }

    fn public_message(&self) -> Option<&'static str> {
        self.public_message
    }
}

type ProviderFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, EnrollmentError>> + Send + 'a>>;

/// Provider strategy. Each provider owns its external protocol while the
/// session registry owns polling, expiry, and renderer-facing state.
trait ChannelEnrollmentProvider: Send + Sync {
    fn start<'a>(
        &'a self,
        client: &'a Client,
        domain: Option<&'a str>,
    ) -> ProviderFuture<'a, ProviderStart>;

    fn poll<'a>(
        &'a self,
        client: &'a Client,
        registration: &'a ProviderRegistration,
        poll_after: Duration,
    ) -> ProviderFuture<'a, ProviderPoll>;
}

struct FeishuEnrollmentProvider;

impl ChannelEnrollmentProvider for FeishuEnrollmentProvider {
    fn start<'a>(
        &'a self,
        client: &'a Client,
        domain: Option<&'a str>,
    ) -> ProviderFuture<'a, ProviderStart> {
        Box::pin(async move {
            let domain = FeishuDomain::parse(domain)?;
            let init = post_registration(client, domain, [("action", "init".to_string())]).await?;
            let supports_client_secret = init
                .get("supported_auth_methods")
                .and_then(Value::as_array)
                .is_some_and(|methods| {
                    methods
                        .iter()
                        .any(|method| method.as_str() == Some("client_secret"))
                });
            if !supports_client_secret {
                return Err(EnrollmentError::permanent());
            }

            let begin = post_registration(
                client,
                domain,
                [
                    ("action", "begin".to_string()),
                    ("archetype", "PersonalAgent".to_string()),
                    ("auth_method", "client_secret".to_string()),
                    ("request_user_info", "open_id".to_string()),
                ],
            )
            .await?;
            let device_code = required_string(&begin, "device_code")?;
            let verification_uri = required_string(&begin, "verification_uri_complete")?;
            let mut qr_url =
                Url::parse(&verification_uri).map_err(|_| EnrollmentError::permanent())?;
            if qr_url.scheme() != "https" || !is_feishu_registration_host(qr_url.host_str()) {
                return Err(EnrollmentError::unsupported_verification_host());
            }
            qr_url
                .query_pairs_mut()
                .append_pair("from", "oc_onboard")
                .append_pair("tp", "ob_cli_app");

            Ok(ProviderStart {
                registration: ProviderRegistration::Feishu(FeishuRegistration {
                    device_code,
                    domain,
                }),
                qr_url: qr_url.to_string(),
                poll_after: poll_interval(&begin),
                expires_in: expiry(&begin),
            })
        })
    }

    fn poll<'a>(
        &'a self,
        client: &'a Client,
        registration: &'a ProviderRegistration,
        poll_after: Duration,
    ) -> ProviderFuture<'a, ProviderPoll> {
        Box::pin(async move {
            let ProviderRegistration::Feishu(registration) = registration;
            let response = post_registration(
                client,
                registration.domain,
                [
                    ("action", "poll".to_string()),
                    ("device_code", registration.device_code.clone()),
                    ("tp", "ob_cli_app".to_string()),
                ],
            )
            .await?;

            let mut domain = registration.domain;
            if response
                .get("user_info")
                .and_then(Value::as_object)
                .and_then(|user_info| user_info.get("tenant_brand"))
                .and_then(Value::as_str)
                == Some("lark")
                && domain != FeishuDomain::Lark
            {
                domain = FeishuDomain::Lark;
                return Ok(ProviderPoll::Waiting {
                    registration: ProviderRegistration::Feishu(FeishuRegistration {
                        device_code: registration.device_code.clone(),
                        domain,
                    }),
                    poll_after,
                });
            }

            if let (Some(app_id), Some(app_secret)) = (
                optional_string(&response, "client_id"),
                optional_string(&response, "client_secret"),
            ) {
                return Ok(ProviderPoll::Completed(EnrollmentCredentials {
                    app_id,
                    app_secret,
                    domain,
                }));
            }

            match response.get("error").and_then(Value::as_str) {
                None | Some("authorization_pending") => Ok(ProviderPoll::Waiting {
                    registration: ProviderRegistration::Feishu(FeishuRegistration {
                        device_code: registration.device_code.clone(),
                        domain,
                    }),
                    poll_after,
                }),
                Some("slow_down") => Ok(ProviderPoll::Waiting {
                    registration: ProviderRegistration::Feishu(FeishuRegistration {
                        device_code: registration.device_code.clone(),
                        domain,
                    }),
                    poll_after: (poll_after + Duration::from_secs(5)).min(MAX_POLL_INTERVAL),
                }),
                Some("access_denied") => Ok(ProviderPoll::Denied),
                Some("expired_token") => Ok(ProviderPoll::Expired),
                Some(_) => Ok(ProviderPoll::Failed),
            }
        })
    }
}

fn provider_for(channel: EnrollmentChannel) -> &'static dyn ChannelEnrollmentProvider {
    static FEISHU: FeishuEnrollmentProvider = FeishuEnrollmentProvider;
    match channel {
        EnrollmentChannel::Feishu => &FEISHU,
    }
}

#[tauri::command]
pub async fn start_channel_enrollment(
    registry: State<'_, ChannelEnrollmentRegistry>,
    channel: String,
    domain: Option<String>,
) -> Result<ChannelEnrollmentSnapshot, String> {
    let channel = EnrollmentChannel::parse(&channel)?;
    let provider = provider_for(channel);
    let started = provider
        .start(&registry.client, domain.as_deref())
        .await
        .map_err(|error| {
            if let Some(message) = error.public_message() {
                message.to_string()
            } else if error.is_transient() {
                "Could not connect to the Feishu enrollment service. Please check your network and try again."
                    .to_string()
            } else {
                "The Feishu enrollment service rejected this request. Please try again later."
                    .to_string()
            }
        })?;
    let qr_data_url = qr_svg_data_url(&started.qr_url)
        .map_err(|_| "Could not render the channel QR code. Please try again.".to_string())?;
    let session_id = Uuid::new_v4().to_string();
    let expires_at = Instant::now() + started.expires_in;
    let session = EnrollmentSession {
        channel,
        registration: started.registration,
        state: EnrollmentState::Waiting,
        qr_data_url,
        qr_content: started.qr_url,
        poll_after: started.poll_after,
        expires_at,
        expires_at_ms: unix_millis_after(started.expires_in),
        config_path: paths::active_config_path(),
    };

    let mut sessions = registry.sessions.lock();
    sessions.retain(|_, current| !current.is_expired() && !current.is_terminal());
    if sessions.len() >= MAX_ACTIVE_SESSIONS {
        return Err(
            "Too many pending channel enrollments. Close an existing QR setup and try again."
                .into(),
        );
    }
    let snapshot = snapshot(&session_id, &session);
    sessions.insert(session_id, session);
    Ok(snapshot)
}

#[tauri::command]
pub async fn poll_channel_enrollment(
    registry: State<'_, ChannelEnrollmentRegistry>,
    session_id: String,
) -> Result<ChannelEnrollmentSnapshot, String> {
    let pending = {
        let mut sessions = registry.sessions.lock();
        let session = session_for_current_runtime(&mut sessions, &session_id)?;
        if session.is_expired() && !session.is_terminal() {
            session.state = EnrollmentState::Expired;
            return Ok(snapshot(&session_id, session));
        }
        match session.state {
            EnrollmentState::Waiting => {
                session.state = EnrollmentState::Polling;
                (
                    session.channel,
                    session.registration.clone(),
                    session.poll_after,
                )
            }
            _ => return Ok(snapshot(&session_id, session)),
        }
    };

    let (channel, registration, poll_after) = pending;
    let result = provider_for(channel)
        .poll(&registry.client, &registration, poll_after)
        .await;

    let mut sessions = registry.sessions.lock();
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "This QR enrollment session was closed.".to_string())?;
    if !matches!(session.state, EnrollmentState::Polling) {
        return Ok(snapshot(&session_id, session));
    }
    if session.is_expired() {
        session.state = EnrollmentState::Expired;
        return Ok(snapshot(&session_id, session));
    }
    match result {
        Ok(ProviderPoll::Waiting {
            registration,
            poll_after,
        }) => {
            session.registration = registration;
            session.poll_after = poll_after;
            session.state = EnrollmentState::Waiting;
        }
        Ok(ProviderPoll::Completed(credentials)) => {
            session.state = EnrollmentState::Completed(credentials);
        }
        Ok(ProviderPoll::Denied) => session.state = EnrollmentState::Denied,
        Ok(ProviderPoll::Expired) => session.state = EnrollmentState::Expired,
        Ok(ProviderPoll::Failed) => session.state = EnrollmentState::Failed,
        Err(error) if error.is_transient() => session.state = EnrollmentState::Waiting,
        Err(_) => session.state = EnrollmentState::Failed,
    }
    Ok(snapshot(&session_id, session))
}

/// Returns one official-wizard credential only after the provider has verified
/// the QR enrollment. The renderer immediately forwards it to the existing
/// OpenClaw wizard step and never persists it itself.
#[tauri::command]
pub async fn read_channel_enrollment_credential(
    registry: State<'_, ChannelEnrollmentRegistry>,
    session_id: String,
    credential: ChannelEnrollmentCredential,
) -> Result<String, String> {
    let mut sessions = registry.sessions.lock();
    let session = session_for_current_runtime(&mut sessions, &session_id)?;
    let EnrollmentState::Completed(credentials) = &session.state else {
        return Err("The QR enrollment has not completed yet.".into());
    };
    Ok(match credential {
        ChannelEnrollmentCredential::AppId => credentials.app_id.clone(),
        ChannelEnrollmentCredential::AppSecret => credentials.app_secret.clone(),
    })
}

#[tauri::command]
pub async fn complete_channel_enrollment(
    registry: State<'_, ChannelEnrollmentRegistry>,
    session_id: String,
) -> Result<(), String> {
    registry.sessions.lock().remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn cancel_channel_enrollment(
    registry: State<'_, ChannelEnrollmentRegistry>,
    session_id: String,
) -> Result<(), String> {
    registry.sessions.lock().remove(&session_id);
    Ok(())
}

/// Render an authorization URL supplied by an official Gateway wizard note.
/// The URL remains Gateway-owned; this command only turns it into a local
/// image when terminal QR rendering is unavailable.
#[tauri::command]
pub fn render_qr_code_data_url(content: String) -> Result<String, String> {
    let content = content.trim();
    let url = Url::parse(content).map_err(|_| "QR content must be a valid URL.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("QR content must use HTTP or HTTPS.".into());
    }
    qr_svg_data_url(content).map_err(|_| {
        "Could not render the authorization QR code. Please use the URL instead.".into()
    })
}

/// Render a QR payload returned by a locally installed OpenClaw channel
/// adapter. The payload is never fetched; it is only encoded as SVG locally.
#[tauri::command]
pub fn render_local_qr_data_url(content: String) -> Result<String, String> {
    let content = content.trim();
    let url = Url::parse(content).map_err(|_| "QR content must be a valid URL.".to_string())?;
    if !matches!(url.scheme(), "https" | "sgnl") {
        return Err("QR content must use HTTPS or the Signal link scheme.".into());
    }
    qr_svg_data_url(content).map_err(|_| {
        "Could not render the channel QR code. Please refresh the login session.".into()
    })
}

fn session_for_current_runtime<'a>(
    sessions: &'a mut HashMap<String, EnrollmentSession>,
    session_id: &str,
) -> Result<&'a mut EnrollmentSession, String> {
    let active_config_path = paths::active_config_path();
    let location_changed = sessions
        .get(session_id)
        .is_some_and(|session| session.config_path != active_config_path);
    if location_changed {
        sessions.remove(session_id);
        return Err("The OpenClaw data location changed. Start QR enrollment again for the selected location.".into());
    }
    sessions
        .get_mut(session_id)
        .ok_or_else(|| "This QR enrollment session is no longer available.".to_string())
}

fn snapshot(session_id: &str, session: &EnrollmentSession) -> ChannelEnrollmentSnapshot {
    let (phase, qr_data_url, qr_content, poll_after_ms, domain) = match &session.state {
        EnrollmentState::Waiting | EnrollmentState::Polling => (
            EnrollmentPhase::Waiting,
            Some(session.qr_data_url.clone()),
            Some(session.qr_content.clone()),
            Some(session.poll_after.as_millis().min(u128::from(u64::MAX)) as u64),
            None,
        ),
        EnrollmentState::Completed(credentials) => (
            EnrollmentPhase::Connected,
            None,
            None,
            None,
            Some(credentials.domain.as_str()),
        ),
        EnrollmentState::Denied => (EnrollmentPhase::Denied, None, None, None, None),
        EnrollmentState::Expired => (EnrollmentPhase::Expired, None, None, None, None),
        EnrollmentState::Failed => (EnrollmentPhase::Error, None, None, None, None),
    };
    ChannelEnrollmentSnapshot {
        session_id: session_id.to_string(),
        channel: session.channel.as_str(),
        phase,
        qr_data_url,
        qr_content,
        poll_after_ms,
        expires_at: session.expires_at_ms,
        domain,
    }
}

async fn post_registration<const N: usize>(
    client: &Client,
    domain: FeishuDomain,
    fields: [(&str, String); N],
) -> Result<Value, EnrollmentError> {
    let url = format!("{}{}", domain.accounts_url(), REGISTRATION_PATH);
    let response = client
        .post(url)
        .form(fields.as_slice())
        .send()
        .await
        .map_err(|_| EnrollmentError::transient())?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| EnrollmentError::transient())?;
    if !status.is_success() && value.get("error").is_none() {
        return Err(EnrollmentError::permanent());
    }
    Ok(value)
}

fn required_string(value: &Value, field: &str) -> Result<String, EnrollmentError> {
    optional_string(value, field).ok_or_else(EnrollmentError::permanent)
}

fn optional_string(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn poll_interval(value: &Value) -> Duration {
    value
        .get("interval")
        .and_then(Value::as_u64)
        .filter(|seconds| (2..=MAX_POLL_INTERVAL.as_secs()).contains(seconds))
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_POLL_INTERVAL)
}

fn expiry(value: &Value) -> Duration {
    value
        .get("expire_in")
        .and_then(Value::as_u64)
        .filter(|seconds| (30..=900).contains(seconds))
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_EXPIRY)
}

fn is_feishu_registration_host(host: Option<&str>) -> bool {
    host.is_some_and(|host| FEISHU_REGISTRATION_HOSTS.contains(&host))
}

fn unix_millis_after(duration: Duration) -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .saturating_add(duration)
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn qr_svg_data_url(content: &str) -> Result<String, EnrollmentError> {
    let code = QrCode::new(content.as_bytes()).map_err(|_| EnrollmentError::permanent())?;
    let quiet_zone = 4usize;
    let width = code.width();
    let canvas = width + quiet_zone * 2;
    let mut path = String::with_capacity(width * width * 12);
    for y in 0..width {
        for x in 0..width {
            if code[(x, y)] == Color::Dark {
                let x = x + quiet_zone;
                let y = y + quiet_zone;
                path.push_str(&format!("M{x} {y}h1v1H{x}z"));
            }
        }
    }
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas} {canvas}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h{canvas}v{canvas}H0z"/><path d="{path}"/></svg>"##
    );
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        STANDARD.encode(svg)
    ))
}

#[cfg(test)]
mod tests {
    use super::{qr_svg_data_url, render_local_qr_data_url, render_qr_code_data_url};
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    #[test]
    fn qr_renderer_returns_an_inline_svg_data_url() {
        let data_url = qr_svg_data_url("https://example.com/verify?code=test")
            .ok()
            .expect("QR content should be renderable");
        assert!(data_url.starts_with("data:image/svg+xml;base64,"));
        let encoded = data_url.trim_start_matches("data:image/svg+xml;base64,");
        let svg = String::from_utf8(STANDARD.decode(encoded).unwrap()).unwrap();
        assert!(svg.contains("shape-rendering=\"crispEdges\""));
        assert!(svg.contains("<path"));
    }

    #[test]
    fn generic_qr_renderer_accepts_authorization_urls_only() {
        assert!(
            render_qr_code_data_url("https://example.com/authorization?code=test".into()).is_ok()
        );
        assert!(render_qr_code_data_url("not a URL".into()).is_err());
        assert!(render_qr_code_data_url("file:///tmp/secret".into()).is_err());
    }

    #[test]
    fn local_channel_qr_renderer_accepts_only_safe_link_schemes() {
        assert!(render_local_qr_data_url("https://example.com/link".into()).is_ok());
        assert!(render_local_qr_data_url("sgnl://linkdevice?uuid=test".into()).is_ok());
        assert!(render_local_qr_data_url("file:///tmp/secret".into()).is_err());
        assert!(render_local_qr_data_url("javascript:alert(1)".into()).is_err());
    }
}
