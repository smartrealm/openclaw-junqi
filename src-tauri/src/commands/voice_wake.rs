// Voice wake detection via cpal continuous capture + energy-based VAD.
// Cross-platform (macOS CoreAudio / Windows WASAPI via cpal).
//
// Phase 1: VAD placeholder for a wake word.
//   - Continuous mic capture on a background thread.
//   - Energy-based VAD: speech → start capturing samples; silence → finalize.
//   - Emits `voice-wake` events: listening / wake_detected / captured / error.
//   - Captured utterance returned as base64 WAV for the frontend to feed ASR.
// Phase 2: replace the VAD detector with Porcupine (real wake word).
//
// cpal streams are !Send, so all audio lives on one dedicated thread; the
// Tauri side only touches channels + the AppHandle.

use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::VecDeque;
use std::io::Cursor;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

enum WakeCmd {
    Stop,
}

struct WakeState {
    worker_id: u64,
    tx: Option<mpsc::Sender<WakeCmd>>,
    worker: Option<JoinHandle<()>>,
    running: bool,
}

static WAKE: Mutex<Option<WakeState>> = Mutex::new(None);
static NEXT_WORKER_ID: AtomicU64 = AtomicU64::new(1);

fn is_current_worker(worker_id: u64) -> bool {
    WAKE.lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|state| state.worker_id == worker_id))
        .unwrap_or(false)
}

fn emit_worker_event(app: &AppHandle, worker_id: u64, payload: serde_json::Value) {
    if is_current_worker(worker_id) {
        let _ = app.emit("voice-wake", payload);
    }
}

fn mark_worker_stopped(state: &mut Option<WakeState>, worker_id: u64) -> bool {
    let Some(active) = state.as_mut() else {
        return false;
    };
    if active.worker_id != worker_id {
        return false;
    }
    active.running = false;
    true
}

fn should_emit_command_stop(state: &Option<WakeState>) -> bool {
    state.is_none()
}

/// Tunable VAD thresholds (platform-agnostic).
struct VadConfig {
    speech_rms: f32,
    silence_rms: f32,
    speech_trigger_ms: u64,
    silence_end_ms: u64,
    max_utterance_ms: u64,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            speech_rms: 0.020,
            silence_rms: 0.010,
            speech_trigger_ms: 250,
            silence_end_ms: 1200,
            max_utterance_ms: 15_000,
        }
    }
}

fn rms_i16(data: &[i16]) -> f32 {
    if data.is_empty() {
        return 0.0;
    }
    let sum: f64 = data
        .iter()
        .map(|&s| {
            let f = s as f64 / i16::MAX as f64;
            f * f
        })
        .sum();
    (sum / data.len() as f64).sqrt() as f32
}

fn rms_f32(data: &[f32]) -> f32 {
    if data.is_empty() {
        return 0.0;
    }
    let sum: f64 = data.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (sum / data.len() as f64).sqrt() as f32
}

fn rms_u16(data: &[u16]) -> f32 {
    if data.is_empty() {
        return 0.0;
    }
    let sum: f64 = data
        .iter()
        .map(|&sample| {
            let centered = (sample as f64 - 32_768.0) / 32_768.0;
            centered * centered
        })
        .sum();
    (sum / data.len() as f64).sqrt() as f32
}

/// Shared state between the audio callback and the poll loop.
struct CaptureState {
    rms_window: Vec<f32>,
    samples: Vec<i16>,
    pre_roll: VecDeque<i16>,
    pre_roll_capacity: usize,
    sample_rate: u32,
    channels: u16,
    recording_flag: bool,
}

impl CaptureState {
    fn new() -> Self {
        Self {
            rms_window: Vec::with_capacity(8),
            samples: Vec::new(),
            pre_roll: VecDeque::new(),
            pre_roll_capacity: 5_600,
            sample_rate: 16000,
            channels: 1,
            recording_flag: false,
        }
    }
    fn push_rms(&mut self, rms: f32) {
        self.rms_window.push(rms);
        if self.rms_window.len() > 8 {
            self.rms_window.remove(0);
        }
    }
    fn smoothed_rms(&self) -> f32 {
        if self.rms_window.is_empty() {
            0.0
        } else {
            self.rms_window.iter().sum::<f32>() / self.rms_window.len() as f32
        }
    }
    fn set_audio_format(&mut self, sample_rate: u32, channels: u16) {
        self.sample_rate = sample_rate;
        self.channels = channels;
        self.pre_roll_capacity = ((sample_rate as u64)
            .saturating_mul(channels as u64)
            .saturating_mul(350)
            / 1_000) as usize;
        self.pre_roll.clear();
    }
    fn push_sample(&mut self, sample: i16) {
        if self.recording_flag {
            self.samples.push(sample);
            return;
        }
        if self.pre_roll_capacity == 0 {
            return;
        }
        if self.pre_roll.len() >= self.pre_roll_capacity {
            self.pre_roll.pop_front();
        }
        self.pre_roll.push_back(sample);
    }
    fn push_samples_i16(&mut self, data: &[i16]) {
        for &sample in data {
            self.push_sample(sample);
        }
    }
    fn push_samples_f32(&mut self, data: &[f32]) {
        for &sample in data {
            self.push_sample((sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16);
        }
    }
    fn push_samples_u16(&mut self, data: &[u16]) {
        for &sample in data {
            self.push_sample((sample as i32 - (i16::MAX as i32 + 1)) as i16);
        }
    }
    fn begin_recording(&mut self) {
        self.samples.clear();
        while let Some(sample) = self.pre_roll.pop_front() {
            self.samples.push(sample);
        }
        self.recording_flag = true;
    }
}

/// Start continuous wake listening. Idempotent.
#[tauri::command]
pub fn voice_wake_start(app: AppHandle) -> Result<serde_json::Value, String> {
    let stale_worker = {
        let mut guard = WAKE.lock().map_err(|e| format!("Lock: {}", e))?;
        if let Some(ref st) = *guard {
            if st.running {
                return Ok(serde_json::json!({ "listening": true, "already": true }));
            }
        }
        guard.take()
    };
    if let Some(mut stale) = stale_worker {
        if let Some(tx) = stale.tx.take() {
            let _ = tx.send(WakeCmd::Stop);
        }
        if let Some(worker) = stale.worker.take() {
            let _ = worker.join();
        }
    }

    let mut guard = WAKE.lock().map_err(|e| format!("Lock: {}", e))?;
    if let Some(ref st) = *guard {
        if st.running {
            return Ok(serde_json::json!({ "listening": true, "already": true }));
        }
    }

    let (cmd_tx, cmd_rx) = mpsc::channel::<WakeCmd>();
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);
    let worker_id = NEXT_WORKER_ID.fetch_add(1, Ordering::Relaxed);
    let app_for_thread = app.clone();
    let worker =
        std::thread::spawn(move || run_vad_loop(app_for_thread, cmd_rx, worker_id, ready_tx));

    *guard = Some(WakeState {
        worker_id,
        tx: Some(cmd_tx),
        worker: Some(worker),
        running: true,
    });
    drop(guard);

    match ready_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(())) => {
            // A concurrent stop may have taken this worker while it was
            // starting. Do not report a new listener after that stop won.
            let current = WAKE
                .lock()
                .ok()
                .and_then(|state| {
                    state
                        .as_ref()
                        .map(|active| active.worker_id == worker_id && active.running)
                })
                .unwrap_or(false);
            if !current {
                return Ok(serde_json::json!({ "listening": false, "stopped": true }));
            }
            if let Ok(state) = WAKE.lock() {
                if state
                    .as_ref()
                    .is_some_and(|active| active.worker_id == worker_id && active.running)
                {
                    let _ = app.emit("voice-wake", serde_json::json!({ "state": "listening" }));
                }
            }
            Ok(serde_json::json!({ "listening": true }))
        }
        Ok(Err(error)) => {
            stop_worker_by_id(worker_id);
            Err(error)
        }
        Err(error) => {
            stop_worker_by_id(worker_id);
            Err(format!("语音唤醒启动超时: {}", error))
        }
    }
}

fn stop_worker_by_id(worker_id: u64) {
    let state = {
        let mut guard = match WAKE.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if guard
            .as_ref()
            .is_some_and(|active| active.worker_id == worker_id)
        {
            guard.take()
        } else {
            None
        }
    };
    let Some(mut state) = state else { return };
    state.running = false;
    if let Some(tx) = state.tx.take() {
        let _ = tx.send(WakeCmd::Stop);
    }
    if let Some(worker) = state.worker.take() {
        let _ = worker.join();
    }
}

/// Stop continuous wake listening.
#[tauri::command]
pub fn voice_wake_stop(app: AppHandle) -> Result<serde_json::Value, String> {
    let mut state = {
        let mut guard = WAKE.lock().map_err(|e| format!("Lock: {}", e))?;
        guard.take()
    };
    let stopped = if let Some(ref mut st) = state {
        st.running = false;
        if let Some(tx) = st.tx.take() {
            let _ = tx.send(WakeCmd::Stop);
        }
        if let Some(worker) = st.worker.take() {
            let _ = worker.join();
        }
        true
    } else {
        false
    };
    // Keep the lock while deciding/emitting so a replacement start cannot
    // receive a stale command-level `stopped` notification.
    if let Ok(current) = WAKE.lock() {
        if should_emit_command_stop(&current) {
            let _ = app.emit("voice-wake", serde_json::json!({ "state": "stopped" }));
        }
    }
    Ok(serde_json::json!({ "listening": false, "stopped": stopped }))
}

/// Is wake listening active?
#[tauri::command]
pub fn voice_wake_status() -> Result<serde_json::Value, String> {
    let guard = WAKE.lock().map_err(|e| format!("Lock: {}", e))?;
    let listening = guard.as_ref().map(|st| st.running).unwrap_or(false);
    Ok(serde_json::json!({ "listening": listening }))
}

fn run_vad_loop(
    app: AppHandle,
    cmd_rx: mpsc::Receiver<WakeCmd>,
    worker_id: u64,
    ready_tx: mpsc::SyncSender<Result<(), String>>,
) {
    let cfg = VadConfig::default();
    let mut ready_sent = false;
    let result: Result<(), String> = (|| {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "未找到麦克风设备".to_string())?;
        let config = device
            .default_input_config()
            .map_err(|e| format!("麦克风配置失败: {}", e))?;
        let sample_rate = config.sample_rate().0;
        let channels = config.channels();

        let state = Arc::new(Mutex::new(CaptureState::new()));
        {
            let mut s = state.lock().map_err(|e| format!("Lock: {}", e))?;
            s.set_audio_format(sample_rate, channels);
        }

        let state_cb = state.clone();
        let stream = match config.sample_format() {
            cpal::SampleFormat::I16 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        let rms = rms_i16(data);
                        if let Ok(mut s) = state_cb.lock() {
                            s.push_rms(rms);
                            s.push_samples_i16(data);
                        }
                    },
                    |e| eprintln!("[VoiceWake] stream error: {}", e),
                    None,
                )
                .map_err(|e| format!("启动采集流失败: {}", e))?,
            cpal::SampleFormat::F32 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        let rms = rms_f32(data);
                        if let Ok(mut s) = state_cb.lock() {
                            s.push_rms(rms);
                            s.push_samples_f32(data);
                        }
                    },
                    |e| eprintln!("[VoiceWake] stream error: {}", e),
                    None,
                )
                .map_err(|e| format!("启动采集流失败: {}", e))?,
            cpal::SampleFormat::U16 => device
                .build_input_stream(
                    &config.into(),
                    move |data: &[u16], _: &cpal::InputCallbackInfo| {
                        let rms = rms_u16(data);
                        if let Ok(mut s) = state_cb.lock() {
                            s.push_rms(rms);
                            s.push_samples_u16(data);
                        }
                    },
                    |e| eprintln!("[VoiceWake] stream error: {}", e),
                    None,
                )
                .map_err(|e| format!("启动采集流失败: {}", e))?,
            fmt => return Err(format!("不支持的音频格式: {:?}", fmt)),
        };

        stream.play().map_err(|e| format!("启动采集失败: {}", e))?;
        ready_sent = ready_tx.send(Ok(())).is_ok();
        emit_worker_event(&app, worker_id, serde_json::json!({ "state": "ready" }));

        // Poll loop: 20ms tick, run VAD state machine over smoothed RMS.
        let poll = std::time::Duration::from_millis(20);
        let thread_start = std::time::Instant::now();
        let mut recording = false;
        let mut speech_ms: u64 = 0;
        let mut silence_ms: u64 = 0;
        let mut utterance_start_ms: u128 = 0;

        loop {
            if let Ok(WakeCmd::Stop) = cmd_rx.try_recv() {
                break;
            }

            let rms = state.lock().map(|s| s.smoothed_rms()).unwrap_or(0.0);
            let is_speech = rms >= cfg.speech_rms;
            let is_silence = rms <= cfg.silence_rms;
            let now_ms = thread_start.elapsed().as_millis();

            if !recording {
                if is_speech {
                    speech_ms += 20;
                    silence_ms = 0;
                } else {
                    speech_ms = 0;
                }
                if speech_ms >= cfg.speech_trigger_ms {
                    recording = true;
                    speech_ms = 0;
                    silence_ms = 0;
                    utterance_start_ms = now_ms;
                    // Begin capturing samples.
                    if let Ok(mut s) = state.lock() {
                        s.begin_recording();
                    }
                    emit_worker_event(
                        &app,
                        worker_id,
                        serde_json::json!({ "state": "wake_detected" }),
                    );
                }
            } else {
                if is_silence {
                    silence_ms += 20;
                } else {
                    silence_ms = 0;
                }
                let elapsed = (now_ms - utterance_start_ms) as u64;
                if silence_ms >= cfg.silence_end_ms || elapsed >= cfg.max_utterance_ms {
                    recording = false;
                    silence_ms = 0;
                    // Stop capturing and finalize WAV.
                    let wav_result = {
                        let mut s = state.lock().map_err(|e| format!("Lock: {}", e))?;
                        s.recording_flag = false;
                        let samples = std::mem::take(&mut s.samples);
                        finalize_wav(&samples, s.sample_rate, s.channels)
                    };
                    match wav_result {
                        Ok(b64) => {
                            emit_worker_event(
                                &app,
                                worker_id,
                                serde_json::json!({
                                    "state": "captured",
                                    "data": format!("data:audio/wav;base64,{}", b64),
                                }),
                            );
                        }
                        Err(e) => {
                            emit_worker_event(
                                &app,
                                worker_id,
                                serde_json::json!({ "state": "error", "error": e }),
                            );
                        }
                    }
                }
            }

            std::thread::sleep(poll);
        }

        drop(stream);
        Ok(())
    })();

    if let Err(e) = result {
        if !ready_sent {
            let _ = ready_tx.send(Err(e.clone()));
        }
        emit_worker_event(
            &app,
            worker_id,
            serde_json::json!({ "state": "error", "error": e }),
        );
    }
    if let Ok(mut guard) = WAKE.lock() {
        mark_worker_stopped(&mut guard, worker_id);
    }
}

fn finalize_wav(samples: &[i16], sample_rate: u32, channels: u16) -> Result<String, String> {
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut writer = hound::WavWriter::new(Cursor::new(&mut buf), spec)
            .map_err(|e| format!("WAV writer: {}", e))?;
        for &s in samples {
            let _ = writer.write_sample(s);
        }
        writer
            .finalize()
            .map_err(|e| format!("WAV finalize: {}", e))?;
    }
    Ok(STANDARD.encode(&buf))
}

#[cfg(test)]
mod tests {
    use super::{mark_worker_stopped, rms_u16, should_emit_command_stop, CaptureState, WakeState};

    #[test]
    fn test_bug_01_old_worker_cannot_stop_replacement() {
        let mut state = Some(WakeState {
            worker_id: 2,
            tx: None,
            worker: None,
            running: true,
        });

        assert!(!mark_worker_stopped(&mut state, 1));
        assert!(state.as_ref().is_some_and(|active| active.running));
        assert!(mark_worker_stopped(&mut state, 2));
        assert!(state.as_ref().is_some_and(|active| !active.running));
    }

    #[test]
    fn test_bug_10_vad_keeps_pre_roll_before_trigger() {
        let mut capture = CaptureState::new();
        capture.set_audio_format(10, 1);
        capture.push_samples_i16(&[1, 2, 3, 4]);
        capture.begin_recording();
        capture.push_samples_i16(&[5]);
        assert_eq!(capture.samples, vec![2, 3, 4, 5]);
    }

    #[test]
    fn test_bug_10_u16_input_is_centered() {
        let mut capture = CaptureState::new();
        capture.set_audio_format(16_000, 1);
        capture.push_samples_u16(&[0, 32_768, 65_535]);
        assert_eq!(
            capture.pre_roll.iter().copied().collect::<Vec<_>>(),
            vec![-32_768, 0, 32_767]
        );
        assert!(rms_u16(&[0, 65_535]) > 0.9);
    }

    #[test]
    fn test_bug_12_replacement_suppresses_stale_command_stop() {
        let replacement = Some(WakeState {
            worker_id: 9,
            tx: None,
            worker: None,
            running: true,
        });
        assert!(!should_emit_command_stop(&replacement));
        assert!(should_emit_command_stop(&None));
    }
}
