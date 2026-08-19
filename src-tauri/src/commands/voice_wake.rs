use serde::Serialize;
use std::collections::HashSet;
#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(any(windows, test))]
use std::sync::mpsc;
#[cfg(windows)]
use std::sync::Mutex;
#[cfg(any(windows, test))]
use std::thread::JoinHandle;
#[cfg(windows)]
use std::time::Duration;
use tauri::AppHandle;
#[cfg(windows)]
use tauri::Emitter;

const MAX_OWNER_ID_LENGTH: usize = 128;
const MAX_TRIGGER_COUNT: usize = 32;
const MAX_TRIGGER_UTF16_LENGTH: usize = 64;
#[cfg(windows)]
const WAKE_START_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(windows)]
const WAKE_STOP_TIMEOUT: Duration = Duration::from_secs(2);

#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
enum WakeCommand {
    Stop,
}

#[cfg(any(windows, test))]
#[cfg_attr(not(windows), allow(dead_code))]
struct WakeWorker {
    worker_id: u64,
    owner_id: String,
    triggers: Vec<String>,
    command_tx: Option<mpsc::Sender<WakeCommand>>,
    done_rx: Option<mpsc::Receiver<()>>,
    worker: Option<JoinHandle<()>>,
    running: bool,
}

#[cfg(windows)]
static ACTIVE_WAKE: Mutex<Option<WakeWorker>> = Mutex::new(None);
// 启停等待必须发生在状态锁外，独立控制锁用于串行化所有权切换。
#[cfg(windows)]
static WAKE_CONTROL: Mutex<()> = Mutex::new(());
#[cfg(windows)]
static NEXT_WORKER_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceWakeCapability {
    supported: bool,
    engine: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceWakeCommandResult {
    owner_id: String,
    supported: bool,
    listening: bool,
    reused: bool,
    stopped: bool,
}

fn validate_owner_id(owner_id: &str) -> Result<String, String> {
    let normalized = owner_id.trim();
    if normalized.is_empty() || normalized.len() > MAX_OWNER_ID_LENGTH {
        return Err("语音唤醒所有者标识无效".to_string());
    }
    Ok(normalized.to_string())
}

fn trigger_key(trigger: &str) -> String {
    trigger.to_lowercase()
}

fn speech_match_key(trigger: &str) -> String {
    trigger
        .split_whitespace()
        .map(|token| token.trim_matches(|character: char| !character.is_alphanumeric()))
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn normalize_triggers(triggers: Vec<String>) -> Result<Vec<String>, String> {
    if triggers.is_empty() || triggers.len() > MAX_TRIGGER_COUNT {
        return Err(format!(
            "语音唤醒词数量必须在 1 到 {MAX_TRIGGER_COUNT} 之间"
        ));
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(triggers.len());
    for trigger in triggers {
        let value = trigger.trim();
        if value.is_empty() {
            return Err("语音唤醒词不能为空".to_string());
        }
        if value.encode_utf16().count() > MAX_TRIGGER_UTF16_LENGTH {
            return Err(format!(
                "单个语音唤醒词不能超过 {MAX_TRIGGER_UTF16_LENGTH} 个 UTF-16 代码单元"
            ));
        }
        if speech_match_key(value).is_empty() {
            return Err("语音唤醒词不包含可识别字符".to_string());
        }
        if seen.insert(trigger_key(value)) {
            normalized.push(value.to_string());
        }
    }
    if normalized.is_empty() {
        return Err("语音唤醒词不能为空".to_string());
    }
    Ok(normalized)
}

#[cfg(any(windows, test))]
fn can_reuse_worker(worker: &WakeWorker, owner_id: &str, triggers: &[String]) -> bool {
    worker.running && worker.owner_id == owner_id && worker.triggers == triggers
}

#[cfg(windows)]
fn is_current_worker(worker_id: u64) -> bool {
    ACTIVE_WAKE
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|worker| worker.worker_id == worker_id))
        .unwrap_or(false)
}

#[cfg(windows)]
fn mark_worker_stopped(worker_id: u64) {
    if let Ok(mut guard) = ACTIVE_WAKE.lock() {
        if let Some(worker) = guard.as_mut() {
            if worker.worker_id == worker_id {
                worker.running = false;
            }
        }
    }
}

#[cfg(windows)]
fn emit_worker_event(app: &AppHandle, worker_id: u64, payload: serde_json::Value) {
    if is_current_worker(worker_id) {
        let _ = app.emit("voice-wake-native", payload);
    }
}

#[cfg(windows)]
fn stop_worker(worker: &mut WakeWorker) -> Result<(), String> {
    if let Some(command_tx) = worker.command_tx.take() {
        let _ = command_tx.send(WakeCommand::Stop);
    }
    let acknowledged = worker
        .done_rx
        .take()
        .is_none_or(|done_rx| done_rx.recv_timeout(WAKE_STOP_TIMEOUT).is_ok());
    if acknowledged {
        if let Some(handle) = worker.worker.take() {
            handle
                .join()
                .map_err(|_| "语音唤醒线程异常结束".to_string())?;
        }
        return Ok(());
    }
    worker.worker.take();
    Err("语音唤醒停止超时".to_string())
}

#[tauri::command]
pub fn voice_wake_capability() -> VoiceWakeCapability {
    #[cfg(windows)]
    {
        VoiceWakeCapability {
            supported: true,
            engine: Some("windows-sapi"),
        }
    }
    #[cfg(not(windows))]
    {
        VoiceWakeCapability {
            supported: false,
            engine: None,
        }
    }
}

#[tauri::command]
pub async fn voice_wake_start(
    app: AppHandle,
    owner_id: String,
    triggers: Vec<String>,
) -> Result<VoiceWakeCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || voice_wake_start_blocking(app, owner_id, triggers))
        .await
        .map_err(|error| format!("语音唤醒启动任务异常结束: {error}"))?
}

fn voice_wake_start_blocking(
    app: AppHandle,
    owner_id: String,
    triggers: Vec<String>,
) -> Result<VoiceWakeCommandResult, String> {
    let owner_id = validate_owner_id(&owner_id)?;
    let triggers = normalize_triggers(triggers)?;

    #[cfg(not(windows))]
    {
        let _ = app;
        let _ = triggers;
        return Ok(VoiceWakeCommandResult {
            owner_id,
            supported: false,
            listening: false,
            reused: false,
            stopped: false,
        });
    }

    #[cfg(windows)]
    {
        let _control = WAKE_CONTROL
            .lock()
            .map_err(|error| format!("语音唤醒控制锁失败: {error}"))?;
        let previous = {
            let mut guard = ACTIVE_WAKE
                .lock()
                .map_err(|error| format!("语音唤醒状态锁失败: {error}"))?;
            if guard
                .as_ref()
                .is_some_and(|worker| can_reuse_worker(worker, &owner_id, &triggers))
            {
                return Ok(VoiceWakeCommandResult {
                    owner_id,
                    supported: true,
                    listening: true,
                    reused: true,
                    stopped: false,
                });
            }
            guard.take()
        };
        if let Some(mut worker) = previous {
            stop_worker(&mut worker)?;
        }

        let worker_id = NEXT_WORKER_ID.fetch_add(1, Ordering::Relaxed);
        let (command_tx, command_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let (done_tx, done_rx) = mpsc::sync_channel(1);
        let app_for_thread = app.clone();
        let owner_for_thread = owner_id.clone();
        let triggers_for_thread = triggers.clone();
        let worker = std::thread::spawn(move || {
            run_windows_wake_loop(
                app_for_thread,
                worker_id,
                owner_for_thread,
                triggers_for_thread,
                command_rx,
                ready_tx,
            );
            let _ = done_tx.send(());
        });
        {
            let mut guard = ACTIVE_WAKE
                .lock()
                .map_err(|error| format!("语音唤醒状态锁失败: {error}"))?;
            *guard = Some(WakeWorker {
                worker_id,
                owner_id: owner_id.clone(),
                triggers,
                command_tx: Some(command_tx),
                done_rx: Some(done_rx),
                worker: Some(worker),
                running: true,
            });
        }

        match ready_rx.recv_timeout(WAKE_START_TIMEOUT) {
            Ok(Ok(())) => {
                let _ = app.emit(
                    "voice-wake-native",
                    serde_json::json!({ "ownerId": owner_id, "state": "listening" }),
                );
                Ok(VoiceWakeCommandResult {
                    owner_id,
                    supported: true,
                    listening: true,
                    reused: false,
                    stopped: false,
                })
            }
            Ok(Err(error)) => {
                stop_worker_by_id(worker_id);
                Err(error)
            }
            Err(error) => {
                stop_worker_by_id(worker_id);
                Err(format!("语音唤醒启动超时: {error}"))
            }
        }
    }
}

#[tauri::command]
pub async fn voice_wake_stop(
    app: AppHandle,
    owner_id: String,
) -> Result<VoiceWakeCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || voice_wake_stop_blocking(app, owner_id))
        .await
        .map_err(|error| format!("语音唤醒停止任务异常结束: {error}"))?
}

fn voice_wake_stop_blocking(
    app: AppHandle,
    owner_id: String,
) -> Result<VoiceWakeCommandResult, String> {
    let owner_id = validate_owner_id(&owner_id)?;

    #[cfg(not(windows))]
    {
        let _ = app;
        return Ok(VoiceWakeCommandResult {
            owner_id,
            supported: false,
            listening: false,
            reused: false,
            stopped: false,
        });
    }

    #[cfg(windows)]
    {
        let _control = WAKE_CONTROL
            .lock()
            .map_err(|error| format!("语音唤醒控制锁失败: {error}"))?;
        let current = {
            let mut guard = ACTIVE_WAKE
                .lock()
                .map_err(|error| format!("语音唤醒状态锁失败: {error}"))?;
            if guard
                .as_ref()
                .is_some_and(|worker| worker.owner_id != owner_id)
            {
                return Ok(VoiceWakeCommandResult {
                    owner_id,
                    supported: true,
                    listening: false,
                    reused: false,
                    stopped: false,
                });
            }
            guard.take()
        };
        let stopped = if let Some(mut worker) = current {
            stop_worker(&mut worker)?;
            true
        } else {
            false
        };
        if stopped {
            let _ = app.emit(
                "voice-wake-native",
                serde_json::json!({ "ownerId": owner_id, "state": "stopped" }),
            );
        }
        Ok(VoiceWakeCommandResult {
            owner_id,
            supported: true,
            listening: false,
            reused: false,
            stopped,
        })
    }
}

#[cfg(windows)]
fn stop_worker_by_id(worker_id: u64) {
    let current = {
        let mut guard = match ACTIVE_WAKE.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if guard
            .as_ref()
            .is_some_and(|worker| worker.worker_id == worker_id)
        {
            guard.take()
        } else {
            None
        }
    };
    if let Some(mut worker) = current {
        let _ = stop_worker(&mut worker);
    }
}

#[cfg(windows)]
fn run_windows_wake_loop(
    app: AppHandle,
    worker_id: u64,
    owner_id: String,
    triggers: Vec<String>,
    command_rx: mpsc::Receiver<WakeCommand>,
    ready_tx: mpsc::SyncSender<Result<(), String>>,
) {
    use std::ptr::{null, null_mut};
    use windows::core::{Interface, PCWSTR, PWSTR};
    use windows::Win32::Media::Speech::{
        ISpRecoResult, ISpRecognizer, SPRAF_Active, SPRAF_TopLevel, SpSharedRecognizer,
        SPEI_RECOGNITION, SPEVENT, SPRST_ACTIVE_ALWAYS, SPRS_ACTIVE, SPRS_INACTIVE, SPSTATEHANDLE,
        SPWT_LEXICAL,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn recognized_text(result: &ISpRecoResult) -> Result<String, String> {
        let mut text = PWSTR::null();
        unsafe {
            result
                .GetText(0, u32::MAX, true, &mut text, None)
                .map_err(|error| format!("读取 SAPI 唤醒结果失败: {error}"))?;
        }
        let value =
            unsafe { text.to_string() }.map_err(|error| format!("解码 SAPI 唤醒结果失败: {error}"));
        unsafe { CoTaskMemFree(Some(text.0.cast())) };
        value
    }

    let mut ready_sent = false;
    let result: Result<(), String> = (|| {
        let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        initialized
            .ok()
            .map_err(|error| format!("初始化 Windows SAPI COM 失败: {error}"))?;

        let runtime_result = (|| {
            let recognizer: ISpRecognizer =
                unsafe { CoCreateInstance(&SpSharedRecognizer, None, CLSCTX_ALL) }
                    .map_err(|error| format!("创建 Windows SAPI 共享识别器失败: {error}"))?;
            let context = unsafe { recognizer.CreateRecoContext() }
                .map_err(|error| format!("创建 Windows SAPI 识别上下文失败: {error}"))?;
            unsafe {
                context
                    .SetNotifyWin32Event()
                    .map_err(|error| format!("创建 Windows SAPI 通知事件失败: {error}"))?;
                let event_mask = 1u64 << SPEI_RECOGNITION.0;
                context
                    .SetInterest(event_mask, event_mask)
                    .map_err(|error| format!("订阅 Windows SAPI 识别事件失败: {error}"))?;
            }
            let grammar = unsafe { context.CreateGrammar(worker_id) }
                .map_err(|error| format!("创建 Windows SAPI 唤醒 grammar 失败: {error}"))?;
            let rule_name = wide("JunQiVoiceWake");
            let mut rule_state = SPSTATEHANDLE::default();
            unsafe {
                grammar
                    .GetRule(
                        PCWSTR(rule_name.as_ptr()),
                        0,
                        (SPRAF_TopLevel.0 | SPRAF_Active.0) as u32,
                        true,
                        &mut rule_state,
                    )
                    .map_err(|error| format!("创建 Windows SAPI 唤醒规则失败: {error}"))?;
                for trigger in &triggers {
                    let trigger_wide = wide(&speech_match_key(trigger));
                    grammar
                        .AddWordTransition(
                            rule_state,
                            SPSTATEHANDLE::default(),
                            PCWSTR(trigger_wide.as_ptr()),
                            PCWSTR::null(),
                            SPWT_LEXICAL,
                            1.0,
                            null(),
                        )
                        .map_err(|error| format!("添加 Windows SAPI 唤醒词失败: {error}"))?;
                }
                grammar
                    .Commit(0)
                    .map_err(|error| format!("提交 Windows SAPI 唤醒规则失败: {error}"))?;
                grammar
                    .SetRuleState(PCWSTR(rule_name.as_ptr()), null_mut(), SPRS_ACTIVE)
                    .map_err(|error| format!("启用 Windows SAPI 唤醒规则失败: {error}"))?;
                recognizer
                    .SetRecoState(SPRST_ACTIVE_ALWAYS)
                    .map_err(|error| format!("启动 Windows SAPI 共享识别器失败: {error}"))?;
            }

            ready_sent = ready_tx.send(Ok(())).is_ok();
            let trigger_lookup: Vec<(String, String)> = triggers
                .iter()
                .map(|trigger| (speech_match_key(trigger), trigger.clone()))
                .collect();
            let mut detected = false;
            while !detected {
                if matches!(command_rx.try_recv(), Ok(WakeCommand::Stop)) {
                    break;
                }
                unsafe {
                    context
                        .WaitForNotifyEvent(100)
                        .map_err(|error| format!("等待 Windows SAPI 事件失败: {error}"))?;
                }
                loop {
                    let mut event = SPEVENT::default();
                    let mut fetched = 0;
                    unsafe {
                        context
                            .GetEvents(1, &mut event, &mut fetched)
                            .map_err(|error| format!("读取 Windows SAPI 事件失败: {error}"))?;
                    }
                    if fetched == 0 {
                        break;
                    }
                    let event_id = event._bitfield & 0xffff;
                    if event_id != SPEI_RECOGNITION.0 || event.lParam.0 == 0 {
                        continue;
                    }
                    let recognition =
                        unsafe { ISpRecoResult::from_raw(event.lParam.0 as *mut std::ffi::c_void) };
                    let heard = speech_match_key(&recognized_text(&recognition)?);
                    if let Some((_, trigger)) = trigger_lookup
                        .iter()
                        .find(|(candidate, _)| candidate == &heard)
                    {
                        emit_worker_event(
                            &app,
                            worker_id,
                            serde_json::json!({
                                "ownerId": owner_id,
                                "state": "detected",
                                "trigger": trigger,
                            }),
                        );
                        detected = true;
                        break;
                    }
                }
            }
            unsafe {
                let _ = grammar.SetRuleState(PCWSTR(rule_name.as_ptr()), null_mut(), SPRS_INACTIVE);
            }
            Ok(())
        })();
        unsafe { CoUninitialize() };
        runtime_result
    })();

    if let Err(error) = result {
        if !ready_sent {
            let _ = ready_tx.send(Err(error.clone()));
        } else {
            emit_worker_event(
                &app,
                worker_id,
                serde_json::json!({
                    "ownerId": owner_id,
                    "state": "error",
                    "error": error,
                }),
            );
        }
    }
    mark_worker_stopped(worker_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn worker(owner_id: &str, triggers: &[&str], running: bool) -> WakeWorker {
        WakeWorker {
            worker_id: 1,
            owner_id: owner_id.to_string(),
            triggers: triggers.iter().map(|value| value.to_string()).collect(),
            command_tx: None,
            done_rx: None,
            worker: None,
            running,
        }
    }

    #[test]
    fn normalizes_and_deduplicates_triggers() {
        assert_eq!(
            normalize_triggers(vec![
                " OpenClaw ".to_string(),
                "openclaw".to_string(),
                "君旗".to_string(),
            ])
            .unwrap(),
            vec!["OpenClaw".to_string(), "君旗".to_string()]
        );
    }

    #[test]
    fn rejects_empty_or_oversized_triggers() {
        assert!(normalize_triggers(Vec::new()).is_err());
        assert!(normalize_triggers(vec!["  ".to_string()]).is_err());
        assert!(normalize_triggers(vec!["a".repeat(65)]).is_err());
        assert!(normalize_triggers(vec!["a".to_string(); 33]).is_err());
        assert!(normalize_triggers(vec!["...".to_string()]).is_err());
    }

    #[test]
    fn counts_trigger_limit_in_utf16_code_units() {
        assert!(normalize_triggers(vec!["军".repeat(64)]).is_ok());
        assert!(normalize_triggers(vec!["𠮷".repeat(33)]).is_err());
    }

    #[test]
    fn normalizes_sapi_text_without_emitting_free_transcript() {
        assert_eq!(speech_match_key(" Hey,   JunQi!! "), "hey junqi");
        assert_eq!(speech_match_key("君旗。"), "君旗");
    }

    #[test]
    fn validates_owner_and_reuse_fence() {
        assert!(validate_owner_id(" ").is_err());
        assert_eq!(validate_owner_id(" owner ").unwrap(), "owner");
        let active = worker("owner", &["openclaw"], true);
        assert!(can_reuse_worker(
            &active,
            "owner",
            &["openclaw".to_string()]
        ));
        assert!(!can_reuse_worker(
            &active,
            "other",
            &["openclaw".to_string()]
        ));
        assert!(!can_reuse_worker(&active, "owner", &["junqi".to_string()]));
        assert!(!can_reuse_worker(
            &worker("owner", &["openclaw"], false),
            "owner",
            &["openclaw".to_string()],
        ));
    }
}
