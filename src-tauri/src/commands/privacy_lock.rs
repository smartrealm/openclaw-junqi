use std::sync::Mutex;
use std::time::{Duration, Instant};

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

use crate::commands::app_settings::{
    privacy_lock_session_armed, privacy_lock_settings, save_privacy_lock_settings,
    set_privacy_lock_session_armed, PrivacyLockSettings,
};
use crate::commands::secret_store::{
    delete_system_credential, get_system_credential, store_system_credential,
};

const EVENT_NAME: &str = "junqi://privacy-lock-changed";
const CREDENTIAL_SERVICE: &str = "junqi-desktop-privacy-lock";
const CREDENTIAL_ACCOUNT: &str = "primary-pin-v1";
const CREDENTIAL_LABEL: &str = "JunQi privacy lock PIN";

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyLockReason {
    Manual,
    Shortcut,
    Idle,
    SystemLock,
    Suspend,
    Startup,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SystemAuthenticationAvailability {
    Available,
    DeviceNotPresent,
    NotConfigured,
    DisabledByPolicy,
    Busy,
    Unsupported,
    Unavailable,
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyLockSnapshot {
    pub enabled: bool,
    pub locked: bool,
    pub revision: u64,
    pub reason: Option<PrivacyLockReason>,
    pub retry_after_ms: u64,
    pub failed_attempts: u32,
    pub settings: PrivacyLockSettings,
    pub system_authentication: SystemAuthenticationAvailability,
    pub idle_detection_supported: bool,
    pub shortcut_registered: bool,
    pub shortcut_error: bool,
}

#[derive(Debug)]
struct PrivacyLockInner {
    settings: PrivacyLockSettings,
    locked: bool,
    revision: u64,
    reason: Option<PrivacyLockReason>,
    failed_attempts: u32,
    retry_after: Option<Instant>,
    system_authentication: SystemAuthenticationAvailability,
    shortcut_registered: bool,
    shortcut_error: bool,
}

pub struct PrivacyLockState {
    inner: Mutex<PrivacyLockInner>,
}

impl PrivacyLockState {
    pub fn new() -> Self {
        let settings = privacy_lock_settings();
        let locked = settings.enabled && settings.lock_on_startup && privacy_lock_session_armed();
        Self {
            inner: Mutex::new(PrivacyLockInner {
                settings,
                locked,
                revision: if locked { 1 } else { 0 },
                reason: locked.then_some(PrivacyLockReason::Startup),
                failed_attempts: 0,
                retry_after: None,
                system_authentication: SystemAuthenticationAvailability::Unavailable,
                shortcut_registered: false,
                shortcut_error: false,
            }),
        }
    }

    pub fn is_locked(&self) -> bool {
        self.inner.lock().map(|inner| inner.locked).unwrap_or(true)
    }

    pub fn settings(&self) -> PrivacyLockSettings {
        self.inner
            .lock()
            .map(|inner| inner.settings.clone())
            .unwrap_or_else(|_| PrivacyLockSettings {
                enabled: true,
                ..PrivacyLockSettings::default()
            })
    }

    pub fn snapshot(&self) -> PrivacyLockSnapshot {
        let inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        snapshot_from_inner(&inner)
    }

    pub fn lock(&self, reason: PrivacyLockReason) -> PrivacyLockSnapshot {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if inner.settings.enabled {
            inner.locked = true;
            inner.reason = Some(reason);
            inner.revision = inner.revision.saturating_add(1);
        }
        snapshot_from_inner(&inner)
    }

    fn record_failed_authentication(&self) -> PrivacyLockSnapshot {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.failed_attempts = inner.failed_attempts.saturating_add(1);
        if let Some(delay) = retry_delay(inner.failed_attempts) {
            inner.retry_after = Some(Instant::now() + delay);
        }
        inner.revision = inner.revision.saturating_add(1);
        snapshot_from_inner(&inner)
    }

    fn unlock(&self, observed_revision: u64) -> Result<PrivacyLockSnapshot, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "lock_state_unavailable".to_string())?;
        if inner.revision != observed_revision {
            return Err("lock_state_changed".to_string());
        }
        if retry_after_ms(inner.retry_after) > 0 {
            return Err("retry_later".to_string());
        }
        inner.locked = false;
        inner.reason = None;
        inner.failed_attempts = 0;
        inner.retry_after = None;
        inner.revision = inner.revision.saturating_add(1);
        Ok(snapshot_from_inner(&inner))
    }

    pub(crate) fn replace_settings(&self, settings: PrivacyLockSettings) -> PrivacyLockSnapshot {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.settings = settings;
        inner.revision = inner.revision.saturating_add(1);
        snapshot_from_inner(&inner)
    }

    fn enable(&self, settings: PrivacyLockSettings) -> PrivacyLockSnapshot {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.settings = settings;
        inner.locked = true;
        inner.reason = Some(PrivacyLockReason::Manual);
        inner.failed_attempts = 0;
        inner.retry_after = None;
        inner.revision = inner.revision.saturating_add(1);
        snapshot_from_inner(&inner)
    }

    fn disable(&self, settings: PrivacyLockSettings) -> PrivacyLockSnapshot {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.settings = settings;
        inner.locked = false;
        inner.reason = None;
        inner.failed_attempts = 0;
        inner.retry_after = None;
        inner.revision = inner.revision.saturating_add(1);
        snapshot_from_inner(&inner)
    }

    pub fn set_system_authentication(
        &self,
        availability: SystemAuthenticationAvailability,
    ) -> PrivacyLockSnapshot {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.system_authentication = availability;
        snapshot_from_inner(&inner)
    }

    pub fn set_shortcut_status(&self, registered: bool, error: bool) -> PrivacyLockSnapshot {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.shortcut_registered = registered;
        inner.shortcut_error = error;
        snapshot_from_inner(&inner)
    }
}

fn snapshot_from_inner(inner: &PrivacyLockInner) -> PrivacyLockSnapshot {
    PrivacyLockSnapshot {
        enabled: inner.settings.enabled,
        locked: inner.locked,
        revision: inner.revision,
        reason: inner.reason,
        retry_after_ms: retry_after_ms(inner.retry_after),
        failed_attempts: inner.failed_attempts,
        settings: inner.settings.clone(),
        system_authentication: inner.system_authentication,
        idle_detection_supported: idle_detection_supported(),
        shortcut_registered: inner.shortcut_registered,
        shortcut_error: inner.shortcut_error,
    }
}

fn retry_after_ms(retry_after: Option<Instant>) -> u64 {
    retry_after
        .and_then(|deadline| deadline.checked_duration_since(Instant::now()))
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn should_lock_for_idle(idle_lock_armed: &mut bool, idle: Duration, threshold: Duration) -> bool {
    if idle < threshold {
        *idle_lock_armed = true;
        return false;
    }
    if !*idle_lock_armed {
        return false;
    }
    *idle_lock_armed = false;
    true
}

fn retry_delay(failed_attempts: u32) -> Option<Duration> {
    match failed_attempts {
        0..=4 => None,
        5 => Some(Duration::from_secs(30)),
        6 => Some(Duration::from_secs(60)),
        7 => Some(Duration::from_secs(5 * 60)),
        _ => Some(Duration::from_secs(15 * 60)),
    }
}

fn validate_pin(pin: &str) -> Result<(), String> {
    let length = pin.chars().count();
    let numeric = pin.chars().all(|character| character.is_ascii_digit());
    if numeric && (4..=6).contains(&length) {
        Ok(())
    } else {
        Err("pin_policy".to_string())
    }
}

fn hash_pin(pin: &str) -> Result<String, String> {
    validate_pin(pin)?;
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "pin_hash_failed".to_string())
}

fn verify_pin(pin: &str, encoded: &str) -> bool {
    let Ok(hash) = PasswordHash::new(encoded) else {
        return false;
    };
    Argon2::default()
        .verify_password(pin.as_bytes(), &hash)
        .is_ok()
}

fn emit_snapshot(app: &AppHandle, snapshot: &PrivacyLockSnapshot) {
    let _ = app.emit(EVENT_NAME, snapshot);
}

pub fn lock_from_native(app: &AppHandle, reason: PrivacyLockReason) -> PrivacyLockSnapshot {
    let state = app.state::<PrivacyLockState>();
    let snapshot = state.lock(reason);
    if snapshot.locked {
        let _ = set_privacy_lock_session_armed(true);
    }
    if snapshot.locked {
        let _ = crate::commands::voice_capture::stop_active_capture_for_privacy_lock(app);
        let _ = crate::commands::voice::stop_recording_for_privacy_lock();
        let _ = crate::commands::voice_talk_playback::stop_playback_for_privacy_lock();
    }
    emit_snapshot(app, &snapshot);
    snapshot
}

pub fn command_allowed_while_locked(command: &str) -> bool {
    let command = command.rsplit([':', '|']).next().unwrap_or(command);
    matches!(
        command,
        "get_privacy_lock_status"
            | "focus_privacy_unlock"
            | "unlock_privacy_lock"
            | "refresh_privacy_system_authentication"
            | "unlock_privacy_with_system_authentication"
    )
}

pub fn ensure_unlocked(app: &AppHandle) -> Result<(), String> {
    if app.state::<PrivacyLockState>().is_locked() {
        Err("privacy_locked".to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn get_privacy_lock_status(state: State<'_, PrivacyLockState>) -> PrivacyLockSnapshot {
    state.snapshot()
}

#[tauri::command]
pub fn focus_privacy_unlock(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main_window_unavailable".to_string())?;
    window
        .show()
        .map_err(|_| "main_window_unavailable".to_string())?;
    let _ = window.unminimize();
    window
        .set_focus()
        .map_err(|_| "main_window_unavailable".to_string())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnablePrivacyLockRequest {
    pub pin: String,
    pub settings: PrivacyLockSettings,
}

#[tauri::command]
pub async fn enable_privacy_lock(
    app: AppHandle,
    state: State<'_, PrivacyLockState>,
    request: EnablePrivacyLockRequest,
) -> Result<PrivacyLockSnapshot, String> {
    let pin = Zeroizing::new(request.pin);
    let hash = Zeroizing::new(hash_pin(&pin)?);
    let mut settings = request.settings;
    settings.enabled = true;
    store_system_credential(
        CREDENTIAL_SERVICE,
        CREDENTIAL_ACCOUNT,
        CREDENTIAL_LABEL,
        &hash,
    )
    .await
    .map_err(|_| "credential_store_unavailable".to_string())?;
    if let Err(error) =
        crate::commands::privacy_shortcut::replace_registration(&app, &state.settings(), &settings)
    {
        let _ = delete_system_credential(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT).await;
        return Err(error);
    }
    let settings = match save_privacy_lock_settings(settings.clone()) {
        Ok(settings) => settings,
        Err(_) => {
            let _ = crate::commands::privacy_shortcut::replace_registration(
                &app,
                &settings,
                &state.settings(),
            );
            let _ = delete_system_credential(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT).await;
            return Err("settings_persist_failed".to_string());
        }
    };
    if set_privacy_lock_session_armed(true).is_err() {
        let mut disabled = settings.clone();
        disabled.enabled = false;
        let _ = save_privacy_lock_settings(disabled);
        let _ = delete_system_credential(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT).await;
        let _ = crate::commands::privacy_shortcut::replace_registration(
            &app,
            &settings,
            &state.settings(),
        );
        return Err("settings_persist_failed".to_string());
    }
    let snapshot = state.enable(settings);
    let _ = crate::commands::voice_capture::stop_active_capture_for_privacy_lock(&app);
    let _ = crate::commands::voice::stop_recording_for_privacy_lock();
    let _ = crate::commands::voice_talk_playback::stop_playback_for_privacy_lock();
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn update_privacy_lock_settings(
    app: AppHandle,
    state: State<'_, PrivacyLockState>,
    mut settings: PrivacyLockSettings,
) -> Result<PrivacyLockSnapshot, String> {
    let current = state.settings();
    settings.enabled = current.enabled;
    crate::commands::privacy_shortcut::replace_registration(&app, &current, &settings)?;
    let settings = match save_privacy_lock_settings(settings.clone()) {
        Ok(settings) => settings,
        Err(_) => {
            let _ =
                crate::commands::privacy_shortcut::replace_registration(&app, &settings, &current);
            return Err("settings_persist_failed".to_string());
        }
    };
    let snapshot = state.replace_settings(settings);
    let shortcut_registered =
        if snapshot.settings.enabled && snapshot.settings.global_shortcut_enabled {
            true
        } else {
            false
        };
    let snapshot = state.set_shortcut_status(shortcut_registered, false);
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinChangeRequest {
    pub current_pin: String,
    pub new_pin: String,
}

#[tauri::command]
pub async fn change_privacy_lock_pin(request: PinChangeRequest) -> Result<(), String> {
    let current_pin = Zeroizing::new(request.current_pin);
    let new_pin = Zeroizing::new(request.new_pin);
    let encoded = get_system_credential(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .await
        .map_err(|_| "credential_store_unavailable".to_string())?
        .ok_or_else(|| "credential_missing".to_string())?;
    if !verify_pin(&current_pin, &encoded) {
        return Err("authentication_failed".to_string());
    }
    let hash = Zeroizing::new(hash_pin(&new_pin)?);
    store_system_credential(
        CREDENTIAL_SERVICE,
        CREDENTIAL_ACCOUNT,
        CREDENTIAL_LABEL,
        &hash,
    )
    .await
    .map_err(|_| "credential_store_unavailable".to_string())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisablePrivacyLockRequest {
    pub pin: String,
}

#[tauri::command]
pub async fn disable_privacy_lock(
    app: AppHandle,
    state: State<'_, PrivacyLockState>,
    request: DisablePrivacyLockRequest,
) -> Result<PrivacyLockSnapshot, String> {
    let pin = Zeroizing::new(request.pin);
    let encoded = get_system_credential(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .await
        .map_err(|_| "credential_store_unavailable".to_string())?
        .ok_or_else(|| "credential_missing".to_string())?;
    if !verify_pin(&pin, &encoded) {
        return Err("authentication_failed".to_string());
    }
    let current = state.settings();
    let mut settings = current.clone();
    settings.enabled = false;
    crate::commands::privacy_shortcut::replace_registration(&app, &current, &settings)?;
    delete_system_credential(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .await
        .map_err(|_| "credential_store_unavailable".to_string())?;
    let settings = match save_privacy_lock_settings(settings.clone()) {
        Ok(settings) => settings,
        Err(_) => {
            let _ = store_system_credential(
                CREDENTIAL_SERVICE,
                CREDENTIAL_ACCOUNT,
                CREDENTIAL_LABEL,
                &encoded,
            )
            .await;
            let _ =
                crate::commands::privacy_shortcut::replace_registration(&app, &settings, &current);
            return Err("settings_persist_failed".to_string());
        }
    };
    let snapshot = state.disable(settings);
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockPrivacyRequest {
    pub reason: Option<PrivacyLockReason>,
}

#[tauri::command]
pub fn lock_privacy_now(
    app: AppHandle,
    request: Option<LockPrivacyRequest>,
) -> PrivacyLockSnapshot {
    let reason = request
        .and_then(|request| request.reason)
        .unwrap_or(PrivacyLockReason::Manual);
    lock_from_native(&app, reason)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockPrivacyLockRequest {
    pub revision: u64,
    pub pin: String,
}

#[tauri::command]
pub async fn unlock_privacy_lock(
    app: AppHandle,
    state: State<'_, PrivacyLockState>,
    request: UnlockPrivacyLockRequest,
) -> Result<PrivacyLockSnapshot, String> {
    let current = state.snapshot();
    if !current.locked {
        return Ok(current);
    }
    if current.revision != request.revision {
        return Err("lock_state_changed".to_string());
    }
    if current.retry_after_ms > 0 {
        return Err("retry_later".to_string());
    }
    let pin = Zeroizing::new(request.pin);
    let encoded = get_system_credential(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .await
        .map_err(|_| "credential_store_unavailable".to_string())?
        .ok_or_else(|| "credential_missing".to_string())?;
    if !verify_pin(&pin, &encoded) {
        let snapshot = state.record_failed_authentication();
        emit_snapshot(&app, &snapshot);
        return Err("authentication_failed".to_string());
    }
    let snapshot = state.unlock(request.revision)?;
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn refresh_privacy_system_authentication(
    app: AppHandle,
) -> Result<PrivacyLockSnapshot, String> {
    let availability = platform_authentication::availability().await;
    let state = app.state::<PrivacyLockState>();
    let snapshot = state.set_system_authentication(availability);
    emit_snapshot(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn verify_privacy_system_authentication(reason: String) -> Result<(), String> {
    platform_authentication::authenticate(&reason).await
}

#[tauri::command]
pub async fn unlock_privacy_with_system_authentication(
    app: AppHandle,
    state: State<'_, PrivacyLockState>,
    revision: u64,
    reason: String,
) -> Result<PrivacyLockSnapshot, String> {
    let current = state.snapshot();
    if !current.locked {
        return Ok(current);
    }
    if current.revision != revision {
        return Err("lock_state_changed".to_string());
    }
    if current.retry_after_ms > 0 {
        return Err("retry_later".to_string());
    }
    let result = platform_authentication::authenticate(&reason).await;
    match result {
        Ok(()) => {
            let snapshot = state.unlock(revision)?;
            emit_snapshot(&app, &snapshot);
            Ok(snapshot)
        }
        Err(error) => {
            if error == "authentication_failed" {
                let snapshot = state.record_failed_authentication();
                emit_snapshot(&app, &snapshot);
            }
            Err(error)
        }
    }
}

#[cfg(any(target_os = "macos", windows))]
fn idle_detection_supported() -> bool {
    true
}

#[cfg(not(any(target_os = "macos", windows)))]
fn idle_detection_supported() -> bool {
    false
}

#[cfg(windows)]
fn system_idle_duration() -> Option<Duration> {
    use windows_sys::Win32::System::SystemInformation::GetTickCount64;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    let mut input = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut input) } == 0 {
        return None;
    }
    let now = unsafe { GetTickCount64() };
    let last = input.dwTime as u64;
    Some(Duration::from_millis(now.saturating_sub(last)))
}

#[cfg(target_os = "macos")]
fn system_idle_duration() -> Option<Duration> {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }
    const HID_SYSTEM_STATE: i32 = 1;
    const ANY_INPUT_EVENT_TYPE: u32 = !0_u32;
    let seconds =
        unsafe { CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, ANY_INPUT_EVENT_TYPE) };
    seconds
        .is_finite()
        .then(|| Duration::from_secs_f64(seconds.max(0.0)))
}

#[cfg(not(any(target_os = "macos", windows)))]
fn system_idle_duration() -> Option<Duration> {
    None
}

pub fn start_idle_monitor(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // System idle time is not reset by a successful JunQi unlock. Do not
        // immediately re-lock after unlocking from an already-idle desktop;
        // require a fresh period of observed system activity first.
        let mut idle_lock_armed = true;
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let state = app.state::<PrivacyLockState>();
            let settings = state.settings();
            if !settings.enabled || settings.auto_lock_seconds == 0 {
                idle_lock_armed = true;
                continue;
            }
            if state.is_locked() {
                idle_lock_armed = false;
                continue;
            }
            let Some(idle) = system_idle_duration() else {
                continue;
            };
            if should_lock_for_idle(
                &mut idle_lock_armed,
                idle,
                Duration::from_secs(settings.auto_lock_seconds),
            ) {
                lock_from_native(&app, PrivacyLockReason::Idle);
            }
        }
    });
}

mod platform_authentication {
    use super::SystemAuthenticationAvailability;

    #[cfg(target_os = "macos")]
    pub async fn availability() -> SystemAuthenticationAvailability {
        tokio::task::spawn_blocking(|| unsafe {
            use objc2_local_authentication::{LAContext, LAPolicy};
            let context = LAContext::new();
            match context.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication) {
                Ok(()) => SystemAuthenticationAvailability::Available,
                Err(_) => SystemAuthenticationAvailability::NotConfigured,
            }
        })
        .await
        .unwrap_or(SystemAuthenticationAvailability::Unavailable)
    }

    #[cfg(target_os = "macos")]
    pub async fn authenticate(reason: &str) -> Result<(), String> {
        use block2::RcBlock;
        use objc2_foundation::NSString;
        use objc2_local_authentication::{LAContext, LAPolicy};
        use std::sync::mpsc;
        use std::time::Duration;

        let reason = reason.to_string();
        tokio::task::spawn_blocking(move || unsafe {
            let context = LAContext::new();
            context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthentication)
                .map_err(|_| "system_authentication_unavailable".to_string())?;
            let localized_reason = NSString::from_str(&reason);
            let (sender, receiver) = mpsc::sync_channel(1);
            let reply = RcBlock::new(move |success, _error| {
                let _ = sender.send(bool::from(success));
            });
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthentication,
                &localized_reason,
                &reply,
            );
            match receiver.recv_timeout(Duration::from_secs(90)) {
                Ok(true) => Ok(()),
                Ok(false) => Err("authentication_cancelled_or_failed".to_string()),
                Err(_) => {
                    context.invalidate();
                    Err("authentication_timeout".to_string())
                }
            }
        })
        .await
        .map_err(|_| "system_authentication_unavailable".to_string())?
    }

    #[cfg(windows)]
    pub async fn availability() -> SystemAuthenticationAvailability {
        use windows::Security::Credentials::UI::{
            UserConsentVerifier, UserConsentVerifierAvailability as Availability,
        };
        let Ok(operation) = UserConsentVerifier::CheckAvailabilityAsync() else {
            return SystemAuthenticationAvailability::Unavailable;
        };
        match operation.await {
            Ok(value) if value == Availability::Available => {
                SystemAuthenticationAvailability::Available
            }
            Ok(value) if value == Availability::DeviceNotPresent => {
                SystemAuthenticationAvailability::DeviceNotPresent
            }
            Ok(value) if value == Availability::NotConfiguredForUser => {
                SystemAuthenticationAvailability::NotConfigured
            }
            Ok(value) if value == Availability::DisabledByPolicy => {
                SystemAuthenticationAvailability::DisabledByPolicy
            }
            Ok(value) if value == Availability::DeviceBusy => {
                SystemAuthenticationAvailability::Busy
            }
            _ => SystemAuthenticationAvailability::Unavailable,
        }
    }

    #[cfg(windows)]
    pub async fn authenticate(reason: &str) -> Result<(), String> {
        use windows::core::HSTRING;
        use windows::Security::Credentials::UI::{
            UserConsentVerificationResult as ResultCode, UserConsentVerifier,
        };
        let operation = UserConsentVerifier::RequestVerificationAsync(&HSTRING::from(reason))
            .map_err(|_| "system_authentication_unavailable".to_string())?;
        match operation.await {
            Ok(value) if value == ResultCode::Verified => Ok(()),
            Ok(value) if value == ResultCode::Canceled => {
                Err("authentication_cancelled".to_string())
            }
            Ok(value) if value == ResultCode::DeviceBusy => {
                Err("system_authentication_busy".to_string())
            }
            Ok(value) if value == ResultCode::DisabledByPolicy => {
                Err("system_authentication_disabled".to_string())
            }
            Ok(value)
                if value == ResultCode::DeviceNotPresent
                    || value == ResultCode::NotConfiguredForUser =>
            {
                Err("system_authentication_unavailable".to_string())
            }
            Ok(_) => Err("authentication_failed".to_string()),
            Err(_) => Err("system_authentication_unavailable".to_string()),
        }
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    pub async fn availability() -> SystemAuthenticationAvailability {
        SystemAuthenticationAvailability::Unsupported
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    pub async fn authenticate(_reason: &str) -> Result<(), String> {
        Err("system_authentication_unsupported".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled_settings() -> PrivacyLockSettings {
        PrivacyLockSettings {
            enabled: true,
            ..PrivacyLockSettings::default()
        }
    }

    #[test]
    fn pin_policy_accepts_four_to_six_digit_pin_only() {
        assert!(validate_pin("1234").is_ok());
        assert!(validate_pin("123456").is_ok());
        assert!(validate_pin("123").is_err());
        assert!(validate_pin("1234567").is_err());
        assert!(validate_pin("correct horse").is_err());
    }

    #[test]
    fn argon2_hash_verifies_without_containing_plaintext() {
        let encoded = hash_pin("123456").expect("hash");
        assert!(verify_pin("123456", &encoded));
        assert!(!verify_pin("654321", &encoded));
        assert!(!encoded.contains("123456"));
    }

    #[test]
    fn stale_revision_cannot_unlock_a_newer_lock() {
        let state = PrivacyLockState {
            inner: Mutex::new(PrivacyLockInner {
                settings: enabled_settings(),
                locked: true,
                revision: 10,
                reason: Some(PrivacyLockReason::Manual),
                failed_attempts: 0,
                retry_after: None,
                system_authentication: SystemAuthenticationAvailability::Unsupported,
                shortcut_registered: false,
                shortcut_error: false,
            }),
        };
        state.lock(PrivacyLockReason::Suspend);
        assert_eq!(state.unlock(10), Err("lock_state_changed".to_string()));
        assert!(state.snapshot().locked);
    }

    #[test]
    fn locked_command_allowlist_contains_only_unlock_surface() {
        assert!(command_allowed_while_locked("get_privacy_lock_status"));
        assert!(command_allowed_while_locked(
            "privacy|get_privacy_lock_status"
        ));
        assert!(command_allowed_while_locked("unlock_privacy_lock"));
        assert!(command_allowed_while_locked(
            "unlock_privacy_with_system_authentication"
        ));
        assert!(!command_allowed_while_locked("start_gateway"));
        assert!(!command_allowed_while_locked("store_provider_secret"));
        assert!(!command_allowed_while_locked("open_terminal_window"));
    }

    #[test]
    fn idle_lock_requires_fresh_activity_after_unlock() {
        let threshold = Duration::from_secs(300);
        let mut armed = false;
        assert!(!should_lock_for_idle(
            &mut armed,
            Duration::from_secs(900),
            threshold
        ));
        assert!(!armed);
        assert!(!should_lock_for_idle(
            &mut armed,
            Duration::from_secs(20),
            threshold
        ));
        assert!(armed);
        assert!(should_lock_for_idle(&mut armed, threshold, threshold));
        assert!(!armed);
    }

    #[test]
    fn idle_lock_can_be_rearmed_when_automatic_lock_is_disabled() {
        let mut armed = false;
        assert!(!should_lock_for_idle(
            &mut armed,
            Duration::from_secs(900),
            Duration::from_secs(300)
        ));
        // The monitor resets this latch whenever the setting is disabled.
        armed = true;
        assert!(should_lock_for_idle(
            &mut armed,
            Duration::from_secs(300),
            Duration::from_secs(300)
        ));
    }

    #[test]
    fn fifth_failure_starts_native_retry_delay() {
        assert_eq!(retry_delay(4), None);
        assert_eq!(retry_delay(5), Some(Duration::from_secs(30)));
        assert_eq!(retry_delay(7), Some(Duration::from_secs(300)));
        assert_eq!(retry_delay(20), Some(Duration::from_secs(900)));
    }

    #[test]
    fn failed_attempts_cannot_bypass_an_active_retry_deadline() {
        let state = PrivacyLockState {
            inner: Mutex::new(PrivacyLockInner {
                settings: enabled_settings(),
                locked: true,
                revision: 20,
                reason: Some(PrivacyLockReason::Manual),
                failed_attempts: 4,
                retry_after: None,
                system_authentication: SystemAuthenticationAvailability::Unsupported,
                shortcut_registered: false,
                shortcut_error: false,
            }),
        };
        let fifth = state.record_failed_authentication();
        assert_eq!(fifth.failed_attempts, 5);
        assert!(fifth.retry_after_ms > 0);
        assert_eq!(state.unlock(fifth.revision), Err("retry_later".to_string()));
    }
}
