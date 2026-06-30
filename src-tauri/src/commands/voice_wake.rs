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

use std::sync::{Arc, Mutex};
use std::sync::mpsc;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::io::Cursor;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{AppHandle, Emitter};

enum WakeCmd {
    Stop,
}

struct WakeState {
    tx: Option<mpsc::Sender<WakeCmd>>,
    running: bool,
}

static WAKE: Mutex<Option<WakeState>> = Mutex::new(None);

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
    if data.is_empty() { return 0.0; }
    let sum: f64 = data.iter().map(|&s| { let f = s as f64 / i16::MAX as f64; f * f }).sum();
    (sum / data.len() as f64).sqrt() as f32
}

fn rms_f32(data: &[f32]) -> f32 {
    if data.is_empty() { return 0.0; }
    let sum: f64 = data.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (sum / data.len() as f64).sqrt() as f32
}

/// Shared state between the audio callback and the poll loop.
struct CaptureState {
    rms_window: Vec<f32>,
    samples: Vec<i16>,
    sample_rate: u32,
    channels: u16,
    recording_flag: bool,
}

impl CaptureState {
    fn new() -> Self {
        Self { rms_window: Vec::with_capacity(8), samples: Vec::new(), sample_rate: 16000, channels: 1, recording_flag: false }
    }
    fn push_rms(&mut self, rms: f32) {
        self.rms_window.push(rms);
        if self.rms_window.len() > 8 { self.rms_window.remove(0); }
    }
    fn smoothed_rms(&self) -> f32 {
        if self.rms_window.is_empty() { 0.0 } else { self.rms_window.iter().sum::<f32>() / self.rms_window.len() as f32 }
    }
    fn push_samples_i16(&mut self, data: &[i16]) {
        if self.recording_flag { self.samples.extend_from_slice(data); }
    }
    fn push_samples_f32(&mut self, data: &[f32]) {
        if self.recording_flag {
            for &s in data { self.samples.push((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16); }
        }
    }
}

/// Start continuous wake listening. Idempotent.
#[tauri::command]
pub fn voice_wake_start(app: AppHandle) -> Result<serde_json::Value, String> {
    let mut guard = WAKE.lock().map_err(|e| format!("Lock: {}", e))?;
    if let Some(ref st) = *guard {
        if st.running { return Ok(serde_json::json!({ "listening": true, "already": true })); }
    }

    let (cmd_tx, cmd_rx) = mpsc::channel::<WakeCmd>();
    let app_for_thread = app.clone();
    std::thread::spawn(move || run_vad_loop(app_for_thread, cmd_rx));

    *guard = Some(WakeState { tx: Some(cmd_tx), running: true });
    let _ = app.emit("voice-wake", serde_json::json!({ "state": "listening" }));
    Ok(serde_json::json!({ "listening": true }))
}

/// Stop continuous wake listening.
#[tauri::command]
pub fn voice_wake_stop(app: AppHandle) -> Result<serde_json::Value, String> {
    let stopped = {
        let mut guard = WAKE.lock().map_err(|e| format!("Lock: {}", e))?;
        let mut did = false;
        if let Some(ref mut st) = *guard {
            st.running = false;
            if let Some(tx) = st.tx.take() { let _ = tx.send(WakeCmd::Stop); did = true; }
        }
        *guard = None;
        did
    };
    let _ = app.emit("voice-wake", serde_json::json!({ "state": "stopped" }));
    Ok(serde_json::json!({ "listening": false, "stopped": stopped }))
}

/// Is wake listening active?
#[tauri::command]
pub fn voice_wake_status() -> Result<serde_json::Value, String> {
    let guard = WAKE.lock().map_err(|e| format!("Lock: {}", e))?;
    let listening = guard.as_ref().map(|st| st.running).unwrap_or(false);
    Ok(serde_json::json!({ "listening": listening }))
}

fn run_vad_loop(app: AppHandle, cmd_rx: mpsc::Receiver<WakeCmd>) {
    let cfg = VadConfig::default();
    let result: Result<(), String> = (|| {
        let host = cpal::default_host();
        let device = host.default_input_device().ok_or_else(|| "未找到麦克风设备".to_string())?;
        let config = device.default_input_config().map_err(|e| format!("麦克风配置失败: {}", e))?;
        let sample_rate = config.sample_rate().0;
        let channels = config.channels();

        let state = Arc::new(Mutex::new(CaptureState::new()));
        {
            let mut s = state.lock().map_err(|e| format!("Lock: {}", e))?;
            s.sample_rate = sample_rate;
            s.channels = channels;
        }

        let state_cb = state.clone();
        let stream = match config.sample_format() {
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let rms = rms_i16(data);
                    if let Ok(mut s) = state_cb.lock() { s.push_rms(rms); s.push_samples_i16(data); }
                },
                |e| eprintln!("[VoiceWake] stream error: {}", e),
                None,
            ).map_err(|e| format!("启动采集流失败: {}", e))?,
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let rms = rms_f32(data);
                    if let Ok(mut s) = state_cb.lock() { s.push_rms(rms); s.push_samples_f32(data); }
                },
                |e| eprintln!("[VoiceWake] stream error: {}", e),
                None,
            ).map_err(|e| format!("启动采集流失败: {}", e))?,
            fmt => return Err(format!("不支持的音频格式: {:?}", fmt)),
        };

        stream.play().map_err(|e| format!("启动采集失败: {}", e))?;
        let _ = app.emit("voice-wake", serde_json::json!({ "state": "ready" }));

        // Poll loop: 20ms tick, run VAD state machine over smoothed RMS.
        let poll = std::time::Duration::from_millis(20);
        let thread_start = std::time::Instant::now();
        let mut recording = false;
        let mut speech_ms: u64 = 0;
        let mut silence_ms: u64 = 0;
        let mut utterance_start_ms: u128 = 0;

        loop {
            if let Ok(WakeCmd::Stop) = cmd_rx.try_recv() { break; }

            let rms = state.lock().map(|s| s.smoothed_rms()).unwrap_or(0.0);
            let is_speech = rms >= cfg.speech_rms;
            let is_silence = rms <= cfg.silence_rms;
            let now_ms = thread_start.elapsed().as_millis();

            if !recording {
                if is_speech { speech_ms += 20; silence_ms = 0; } else { speech_ms = 0; }
                if speech_ms >= cfg.speech_trigger_ms {
                    recording = true;
                    speech_ms = 0;
                    silence_ms = 0;
                    utterance_start_ms = now_ms;
                    // Begin capturing samples.
                    if let Ok(mut s) = state.lock() { s.recording_flag = true; s.samples.clear(); }
                    let _ = app.emit("voice-wake", serde_json::json!({ "state": "wake_detected" }));
                }
            } else {
                if is_silence { silence_ms += 20; } else { silence_ms = 0; }
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
                            let _ = app.emit("voice-wake", serde_json::json!({
                                "state": "captured",
                                "data": format!("data:audio/wav;base64,{}", b64),
                            }));
                        }
                        Err(e) => {
                            let _ = app.emit("voice-wake", serde_json::json!({ "state": "error", "error": e }));
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
        let _ = app.emit("voice-wake", serde_json::json!({ "state": "error", "error": e }));
    }
    if let Ok(mut guard) = WAKE.lock() {
        if let Some(ref mut st) = *guard { st.running = false; }
    }
}

fn finalize_wav(samples: &[i16], sample_rate: u32, channels: u16) -> Result<String, String> {
    let spec = hound::WavSpec { channels, sample_rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut writer = hound::WavWriter::new(Cursor::new(&mut buf), spec).map_err(|e| format!("WAV writer: {}", e))?;
        for &s in samples { let _ = writer.write_sample(s); }
        writer.finalize().map_err(|e| format!("WAV finalize: {}", e))?;
    }
    Ok(STANDARD.encode(&buf))
}
