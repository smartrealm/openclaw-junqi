// CPAL 音频流不能跨线程发送，因此连续语音采集统一由专用线程持有。

use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SizedSample};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const MAX_OWNER_ID_LENGTH: usize = 128;
const CAPTURE_POLL_INTERVAL_MS: u64 = 20;
const PCM_EVENT_INTERVAL_MS: u64 = 100;
const MIN_TARGET_SAMPLE_RATE_HZ: u32 = 8_000;
const MAX_TARGET_SAMPLE_RATE_HZ: u32 = 192_000;
const MAX_CAPTURE_BUFFER_SECONDS: usize = 1;
const MAX_CAPTURE_BUFFER_BYTES: usize = 4 * 1024 * 1024;
const CAPTURE_SHUTDOWN_TIMEOUT_MS: u64 = 2_000;

enum CaptureCommand {
    Stop,
}

struct CaptureWorker {
    worker_id: u64,
    owner_id: String,
    target_sample_rate_hz: u32,
    target_channels: u16,
    tx: Option<mpsc::Sender<CaptureCommand>>,
    done_rx: Option<mpsc::Receiver<()>>,
    worker: Option<JoinHandle<()>>,
    running: bool,
}

static ACTIVE_CAPTURE: Mutex<Option<CaptureWorker>> = Mutex::new(None);
// 启停过程会在状态锁外等待采集线程退出，因此用独立锁串行化所有权切换。
static CAPTURE_CONTROL: Mutex<()> = Mutex::new(());
static NEXT_WORKER_ID: AtomicU64 = AtomicU64::new(1);

fn validate_owner_id(owner_id: &str) -> Result<(), String> {
    let normalized = owner_id.trim();
    if normalized.is_empty() || normalized.len() > MAX_OWNER_ID_LENGTH {
        return Err("语音采集所有者标识无效".to_string());
    }
    Ok(())
}

fn is_current_worker(worker_id: u64) -> bool {
    ACTIVE_CAPTURE
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|state| state.worker_id == worker_id))
        .unwrap_or(false)
}

fn scope_capture_event(owner_id: &str, mut payload: serde_json::Value) -> serde_json::Value {
    if let Some(record) = payload.as_object_mut() {
        record.insert("ownerId".to_string(), serde_json::json!(owner_id));
    }
    payload
}

fn emit_worker_event(app: &AppHandle, worker_id: u64, owner_id: &str, payload: serde_json::Value) {
    if is_current_worker(worker_id) {
        let _ = app.emit("voice-capture", scope_capture_event(owner_id, payload));
    }
}

fn mark_worker_stopped(state: &mut Option<CaptureWorker>, worker_id: u64) -> bool {
    let Some(active) = state.as_mut() else {
        return false;
    };
    if active.worker_id != worker_id {
        return false;
    }
    active.running = false;
    true
}

fn can_reuse_listener(
    state: &CaptureWorker,
    owner_id: &str,
    target_sample_rate_hz: u32,
    target_channels: u16,
) -> bool {
    state.running
        && state.owner_id == owner_id
        && state.target_sample_rate_hz == target_sample_rate_hz
        && state.target_channels == target_channels
}

fn can_stop_listener(state: &CaptureWorker, owner_id: &str) -> bool {
    state.owner_id == owner_id
}

fn validate_target_format(sample_rate_hz: u32, channels: u16) -> Result<(), String> {
    if !(MIN_TARGET_SAMPLE_RATE_HZ..=MAX_TARGET_SAMPLE_RATE_HZ).contains(&sample_rate_hz) {
        return Err("Talk 采集采样率超出原生音频边界".to_string());
    }
    if channels != 1 {
        return Err("Talk 采集当前只支持单声道 PCM16".to_string());
    }
    Ok(())
}

fn report_stream_error(error_tx: &mpsc::Sender<String>, error: impl std::fmt::Display) {
    let _ = error_tx.send(format!("麦克风采集流失败: {error}"));
}

fn stream_failure(error_rx: &mpsc::Receiver<String>) -> Result<(), String> {
    match error_rx.try_recv() {
        Ok(error) => Err(error),
        Err(mpsc::TryRecvError::Empty | mpsc::TryRecvError::Disconnected) => Ok(()),
    }
}

/// 本地语音活动检测只驱动界面状态，不决定 OpenClaw 的转写或轮次结果。
struct VoiceActivityConfig {
    speech_rms: f32,
    silence_rms: f32,
    speech_start_ms: u64,
    speech_end_ms: u64,
}

impl Default for VoiceActivityConfig {
    fn default() -> Self {
        Self {
            speech_rms: 0.020,
            silence_rms: 0.010,
            speech_start_ms: 250,
            speech_end_ms: 1_200,
        }
    }
}

fn rms<T>(data: &[T]) -> f32
where
    T: Copy,
    f32: FromSample<T>,
{
    if data.is_empty() {
        return 0.0;
    }
    let sum: f64 = data
        .iter()
        .map(|&sample| {
            let normalized = f32::from_sample(sample) as f64;
            normalized * normalized
        })
        .sum();
    (sum / data.len() as f64).sqrt() as f32
}

/// 音频回调与轮询线程共享原始帧和短时能量窗口。
struct CaptureState {
    rms_window: [f32; 10],
    rms_count: usize,
    rms_cursor: usize,
    stream_samples: Vec<i16>,
    max_stream_samples: usize,
}

impl CaptureState {
    fn new(max_stream_samples: usize) -> Self {
        Self {
            rms_window: [0.0; 10],
            rms_count: 0,
            rms_cursor: 0,
            stream_samples: Vec::new(),
            max_stream_samples: max_stream_samples.max(1),
        }
    }

    fn push_rms(&mut self, rms: f32) {
        self.rms_window[self.rms_cursor] = rms;
        self.rms_cursor = (self.rms_cursor + 1) % self.rms_window.len();
        self.rms_count = (self.rms_count + 1).min(self.rms_window.len());
    }

    fn smoothed_rms(&self) -> f32 {
        if self.rms_count == 0 {
            return 0.0;
        }
        self.rms_window[..self.rms_count].iter().sum::<f32>() / self.rms_count as f32
    }

    fn prepare_sample_append(&mut self, incoming_samples: usize) -> usize {
        if incoming_samples >= self.max_stream_samples {
            self.stream_samples.clear();
            return incoming_samples - self.max_stream_samples;
        }
        let overflow = self
            .stream_samples
            .len()
            .saturating_add(incoming_samples)
            .saturating_sub(self.max_stream_samples);
        if overflow > 0 {
            self.stream_samples.drain(..overflow);
        }
        0
    }

    fn push_input_samples<T>(&mut self, data: &[T])
    where
        T: Copy,
        f32: FromSample<T>,
        i16: FromSample<T>,
    {
        self.push_rms(rms(data));
        let start = self.prepare_sample_append(data.len());
        self.stream_samples
            .extend(data[start..].iter().copied().map(i16::from_sample));
    }

    fn take_frame(&mut self) -> (f32, Vec<i16>) {
        (
            self.smoothed_rms(),
            std::mem::take(&mut self.stream_samples),
        )
    }
}

fn build_capture_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    state: Arc<Mutex<CaptureState>>,
    stream_error_tx: mpsc::Sender<String>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + Copy + Send + 'static,
    f32: FromSample<T>,
    i16: FromSample<T>,
{
    let stream_config: cpal::StreamConfig = config.clone().into();
    device
        .build_input_stream(
            &stream_config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                if let Ok(mut capture) = state.lock() {
                    capture.push_input_samples(data);
                }
            },
            move |error| report_stream_error(&stream_error_tx, error),
            None,
        )
        .map_err(|error| format!("创建麦克风采集流失败: {error}"))
}

fn max_capture_buffer_samples(sample_rate_hz: u32, channels: u16) -> usize {
    let channel_count = usize::from(channels.max(1));
    let duration_limit = usize::try_from(sample_rate_hz)
        .unwrap_or(usize::MAX)
        .saturating_mul(channel_count)
        .saturating_mul(MAX_CAPTURE_BUFFER_SECONDS);
    let byte_limit = MAX_CAPTURE_BUFFER_BYTES / std::mem::size_of::<i16>();
    let bounded = duration_limit.min(byte_limit).max(channel_count);
    bounded - (bounded % channel_count)
}

/// 以连续相位做线性重采样，避免按事件分块时重复或丢失边界采样点。
struct PcmResampler {
    source_sample_rate: u32,
    target_sample_rate: u32,
    channels: usize,
    mono_buffer: Vec<f32>,
    source_position: f64,
}

impl PcmResampler {
    fn new(source_sample_rate: u32, channels: u16, target_sample_rate: u32) -> Self {
        Self {
            source_sample_rate,
            target_sample_rate,
            channels: usize::from(channels.max(1)),
            mono_buffer: Vec::new(),
            source_position: 0.0,
        }
    }

    fn push_interleaved(&mut self, samples: &[i16]) -> Vec<i16> {
        if self.source_sample_rate == 0 || self.target_sample_rate == 0 {
            return Vec::new();
        }
        self.mono_buffer
            .extend(samples.chunks_exact(self.channels).map(|frame| {
                let sum: i64 = frame.iter().map(|sample| i64::from(*sample)).sum();
                (sum as f64 / frame.len() as f64) as f32
            }));
        if self.source_sample_rate == self.target_sample_rate {
            return self
                .mono_buffer
                .drain(..)
                .map(|sample| sample.clamp(i16::MIN as f32, i16::MAX as f32) as i16)
                .collect();
        }

        let step = self.source_sample_rate as f64 / self.target_sample_rate as f64;
        let mut output = Vec::new();
        while self.source_position + 1.0 < self.mono_buffer.len() as f64 {
            let left_index = self.source_position.floor() as usize;
            let right_index = left_index + 1;
            let fraction = (self.source_position - left_index as f64) as f32;
            let left = self.mono_buffer[left_index];
            let right = self.mono_buffer[right_index];
            let sample = left + (right - left) * fraction;
            output.push(sample.clamp(i16::MIN as f32, i16::MAX as f32) as i16);
            self.source_position += step;
        }

        let consumed = self.source_position.floor() as usize;
        if consumed > 0 {
            let drain_count = consumed.min(self.mono_buffer.len());
            self.mono_buffer.drain(..drain_count);
            self.source_position -= drain_count as f64;
        }
        output
    }
}

fn pcm_to_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn captured_audio_duration(sample_count: usize, sample_rate_hz: u32, channels: u16) -> Duration {
    if sample_rate_hz == 0 || channels == 0 {
        return Duration::ZERO;
    }
    let frame_count = sample_count / usize::from(channels);
    Duration::from_secs_f64(frame_count as f64 / f64::from(sample_rate_hz))
}

fn pcm_event_sample_count(sample_rate_hz: u32, channels: u16) -> usize {
    let samples_per_second = usize::try_from(sample_rate_hz)
        .unwrap_or(usize::MAX)
        .saturating_mul(usize::from(channels.max(1)));
    samples_per_second
        .saturating_mul(PCM_EVENT_INTERVAL_MS as usize)
        .checked_div(1_000)
        .unwrap_or(0)
        .max(usize::from(channels.max(1)))
}

fn stop_capture_worker(worker: &mut CaptureWorker, timeout: Duration) -> Result<(), String> {
    worker.running = false;
    if let Some(tx) = worker.tx.take() {
        let _ = tx.send(CaptureCommand::Stop);
    }
    let finished = match worker.done_rx.take() {
        Some(done_rx) => match done_rx.recv_timeout(timeout) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => true,
            Err(mpsc::RecvTimeoutError::Timeout) => false,
        },
        None => true,
    };
    if !finished {
        // 操作系统音频初始化不可强制终止；超时后分离线程，所有权围栏会拒绝其后续事件。
        worker.worker.take();
        return Err("语音采集线程未在限定时间内停止".to_string());
    }
    if let Some(thread) = worker.worker.take() {
        let _ = thread.join();
    }
    Ok(())
}

/// 启动用户主动请求的连续语音采集，阻塞设备操作由专用任务执行。
#[tauri::command]
pub async fn voice_capture_start(
    app: AppHandle,
    owner_id: String,
    sample_rate_hz: u32,
    channels: u16,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        voice_capture_start_blocking(app, owner_id, sample_rate_hz, channels)
    })
    .await
    .map_err(|error| format!("语音采集任务异常结束: {error}"))?
}

fn voice_capture_start_blocking(
    app: AppHandle,
    owner_id: String,
    sample_rate_hz: u32,
    channels: u16,
) -> Result<serde_json::Value, String> {
    validate_owner_id(&owner_id)?;
    validate_target_format(sample_rate_hz, channels)?;
    let _control = CAPTURE_CONTROL
        .lock()
        .map_err(|error| format!("语音采集控制锁失败: {error}"))?;
    let stale_worker = {
        let mut guard = ACTIVE_CAPTURE
            .lock()
            .map_err(|error| format!("语音采集状态锁失败: {error}"))?;
        if let Some(active) = guard.as_ref() {
            if can_reuse_listener(active, &owner_id, sample_rate_hz, channels) {
                return Ok(serde_json::json!({
                    "ownerId": owner_id,
                    "listening": true,
                    "reused": true,
                }));
            }
        }
        guard.take()
    };

    if let Some(mut stale) = stale_worker {
        let stale_owner_id = stale.owner_id.clone();
        stop_capture_worker(
            &mut stale,
            Duration::from_millis(CAPTURE_SHUTDOWN_TIMEOUT_MS),
        )?;
        let _ = app.emit(
            "voice-capture",
            scope_capture_event(
                &stale_owner_id,
                serde_json::json!({ "state": "stopped", "reason": "replaced" }),
            ),
        );
    }

    let (command_tx, command_rx) = mpsc::channel::<CaptureCommand>();
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);
    let (done_tx, done_rx) = mpsc::sync_channel::<()>(1);
    let worker_id = NEXT_WORKER_ID.fetch_add(1, Ordering::Relaxed);
    let app_for_thread = app.clone();
    let owner_for_thread = owner_id.clone();
    let worker = std::thread::spawn(move || {
        run_capture_loop(
            app_for_thread,
            command_rx,
            worker_id,
            owner_for_thread,
            sample_rate_hz,
            channels,
            ready_tx,
        );
        let _ = done_tx.send(());
    });

    {
        let mut guard = ACTIVE_CAPTURE
            .lock()
            .map_err(|error| format!("语音采集状态锁失败: {error}"))?;
        *guard = Some(CaptureWorker {
            worker_id,
            owner_id: owner_id.clone(),
            target_sample_rate_hz: sample_rate_hz,
            target_channels: channels,
            tx: Some(command_tx),
            done_rx: Some(done_rx),
            worker: Some(worker),
            running: true,
        });
    }

    match ready_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(())) => {
            let current = ACTIVE_CAPTURE
                .lock()
                .ok()
                .and_then(|state| {
                    state
                        .as_ref()
                        .map(|active| active.worker_id == worker_id && active.running)
                })
                .unwrap_or(false);
            if !current {
                return Ok(serde_json::json!({
                    "ownerId": owner_id,
                    "listening": false,
                    "stopped": true,
                }));
            }
            let _ = app.emit(
                "voice-capture",
                scope_capture_event(&owner_id, serde_json::json!({ "state": "listening" })),
            );
            Ok(serde_json::json!({ "ownerId": owner_id, "listening": true }))
        }
        Ok(Err(error)) => {
            stop_worker_by_id(worker_id);
            Err(error)
        }
        Err(error) => {
            stop_worker_by_id(worker_id);
            Err(format!("语音采集启动超时: {error}"))
        }
    }
}

fn stop_worker_by_id(worker_id: u64) {
    let state = {
        let mut guard = match ACTIVE_CAPTURE.lock() {
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
    let _ = stop_capture_worker(
        &mut state,
        Duration::from_millis(CAPTURE_SHUTDOWN_TIMEOUT_MS),
    );
}

/// 停止当前所有者的语音采集，等待设备退出时不阻塞 Tauri 调度线程。
#[tauri::command]
pub async fn voice_capture_stop(
    app: AppHandle,
    owner_id: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || voice_capture_stop_blocking(app, owner_id))
        .await
        .map_err(|error| format!("语音采集停止任务异常结束: {error}"))?
}

fn voice_capture_stop_blocking(
    app: AppHandle,
    owner_id: String,
) -> Result<serde_json::Value, String> {
    validate_owner_id(&owner_id)?;
    let _control = CAPTURE_CONTROL
        .lock()
        .map_err(|error| format!("语音采集控制锁失败: {error}"))?;
    let mut state = {
        let mut guard = ACTIVE_CAPTURE
            .lock()
            .map_err(|error| format!("语音采集状态锁失败: {error}"))?;
        if let Some(active) = guard.as_ref() {
            if !can_stop_listener(active, &owner_id) {
                return Ok(serde_json::json!({
                    "ownerId": owner_id,
                    "listening": false,
                    "stopped": false,
                }));
            }
        }
        guard.take()
    };

    let stopped = if let Some(active) = state.as_mut() {
        stop_capture_worker(active, Duration::from_millis(CAPTURE_SHUTDOWN_TIMEOUT_MS))?;
        true
    } else {
        false
    };
    if stopped {
        let _ = app.emit(
            "voice-capture",
            scope_capture_event(&owner_id, serde_json::json!({ "state": "stopped" })),
        );
    }
    Ok(serde_json::json!({
        "ownerId": owner_id,
        "listening": false,
        "stopped": stopped,
    }))
}

fn run_capture_loop(
    app: AppHandle,
    command_rx: mpsc::Receiver<CaptureCommand>,
    worker_id: u64,
    owner_id: String,
    target_sample_rate_hz: u32,
    target_channels: u16,
    ready_tx: mpsc::SyncSender<Result<(), String>>,
) {
    let activity = VoiceActivityConfig::default();
    let mut ready_sent = false;
    let result: Result<(), String> = (|| {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "未找到麦克风设备".to_string())?;
        let config = device
            .default_input_config()
            .map_err(|error| format!("读取麦克风配置失败: {error}"))?;
        let sample_rate = config.sample_rate().0;
        let channels = config.channels();
        let state = Arc::new(Mutex::new(CaptureState::new(max_capture_buffer_samples(
            sample_rate,
            channels,
        ))));
        let (stream_error_tx, stream_error_rx) = mpsc::channel::<String>();
        let stream = match config.sample_format() {
            cpal::SampleFormat::I8 => build_capture_input_stream::<i8>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            cpal::SampleFormat::I16 => build_capture_input_stream::<i16>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            cpal::SampleFormat::I32 => build_capture_input_stream::<i32>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            cpal::SampleFormat::I64 => build_capture_input_stream::<i64>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            cpal::SampleFormat::U8 => build_capture_input_stream::<u8>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            cpal::SampleFormat::U16 => build_capture_input_stream::<u16>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            cpal::SampleFormat::U32 => build_capture_input_stream::<u32>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            cpal::SampleFormat::U64 => build_capture_input_stream::<u64>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            cpal::SampleFormat::F32 => build_capture_input_stream::<f32>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            cpal::SampleFormat::F64 => build_capture_input_stream::<f64>(
                &device,
                &config,
                state.clone(),
                stream_error_tx.clone(),
            )?,
            format => return Err(format!("不支持的麦克风采样格式: {format:?}")),
        };

        stream
            .play()
            .map_err(|error| format!("启动麦克风采集流失败: {error}"))?;
        ready_sent = ready_tx.send(Ok(())).is_ok();

        let poll_interval = Duration::from_millis(CAPTURE_POLL_INTERVAL_MS);
        let mut resampler = PcmResampler::new(sample_rate, channels, target_sample_rate_hz);
        let mut relay_pcm = Vec::<i16>::new();
        let relay_chunk_samples = pcm_event_sample_count(target_sample_rate_hz, target_channels);
        let mut speech_elapsed = Duration::ZERO;
        let mut silence_elapsed = Duration::ZERO;
        let mut speech_active = false;

        loop {
            if let Ok(CaptureCommand::Stop) = command_rx.try_recv() {
                break;
            }
            stream_failure(&stream_error_rx)?;
            let (rms, samples) = state
                .lock()
                .map(|mut capture| capture.take_frame())
                .unwrap_or((0.0, Vec::new()));

            let captured_duration = captured_audio_duration(samples.len(), sample_rate, channels);
            relay_pcm.extend(resampler.push_interleaved(&samples));
            while relay_pcm.len() >= relay_chunk_samples {
                let encoded = STANDARD.encode(pcm_to_bytes(&relay_pcm[..relay_chunk_samples]));
                relay_pcm.drain(..relay_chunk_samples);
                emit_worker_event(
                    &app,
                    worker_id,
                    &owner_id,
                    serde_json::json!({
                        "state": "pcm",
                        "data": encoded,
                        "encoding": "pcm16",
                        "sampleRateHz": target_sample_rate_hz,
                        "channels": target_channels,
                        "inputLevel": rms.clamp(0.0, 1.0),
                    }),
                );
            }

            if speech_active {
                if rms <= activity.silence_rms {
                    silence_elapsed += captured_duration;
                } else {
                    silence_elapsed = Duration::ZERO;
                }
                if silence_elapsed >= Duration::from_millis(activity.speech_end_ms) {
                    speech_active = false;
                    speech_elapsed = Duration::ZERO;
                    silence_elapsed = Duration::ZERO;
                    emit_worker_event(
                        &app,
                        worker_id,
                        &owner_id,
                        serde_json::json!({ "state": "speech_ended" }),
                    );
                }
            } else {
                if rms >= activity.speech_rms {
                    speech_elapsed += captured_duration;
                } else {
                    speech_elapsed = Duration::ZERO;
                }
                if speech_elapsed >= Duration::from_millis(activity.speech_start_ms) {
                    speech_active = true;
                    speech_elapsed = Duration::ZERO;
                    silence_elapsed = Duration::ZERO;
                    emit_worker_event(
                        &app,
                        worker_id,
                        &owner_id,
                        serde_json::json!({ "state": "speech_started" }),
                    );
                }
            }

            std::thread::sleep(poll_interval);
        }

        drop(stream);
        Ok(())
    })();

    if let Err(error) = result {
        if !ready_sent {
            let _ = ready_tx.send(Err(error.clone()));
        }
        emit_worker_event(
            &app,
            worker_id,
            &owner_id,
            serde_json::json!({ "state": "error", "error": error }),
        );
    }
    if let Ok(mut guard) = ACTIVE_CAPTURE.lock() {
        mark_worker_stopped(&mut guard, worker_id);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        can_reuse_listener, can_stop_listener, captured_audio_duration, mark_worker_stopped,
        max_capture_buffer_samples, pcm_event_sample_count, scope_capture_event,
        stop_capture_worker, stream_failure, validate_target_format, CaptureState, CaptureWorker,
        PcmResampler, MAX_CAPTURE_BUFFER_BYTES,
    };

    fn capture_worker(owner_id: &str) -> CaptureWorker {
        CaptureWorker {
            worker_id: 1,
            owner_id: owner_id.to_string(),
            target_sample_rate_hz: 24_000,
            target_channels: 1,
            tx: None,
            done_rx: None,
            worker: None,
            running: true,
        }
    }

    #[test]
    fn listener_reuse_and_stop_require_the_same_owner() {
        let active = capture_worker("owner-a");
        assert!(can_reuse_listener(&active, "owner-a", 24_000, 1));
        assert!(!can_reuse_listener(&active, "owner-b", 24_000, 1));
        assert!(!can_reuse_listener(&active, "owner-a", 16_000, 1));
        assert!(can_stop_listener(&active, "owner-a"));
        assert!(!can_stop_listener(&active, "owner-b"));
    }

    #[test]
    fn target_format_uses_verified_native_bounds() {
        assert!(validate_target_format(8_000, 1).is_ok());
        assert!(validate_target_format(48_000, 1).is_ok());
        assert!(validate_target_format(7_999, 1).is_err());
        assert!(validate_target_format(24_000, 2).is_err());
    }

    #[test]
    fn stale_worker_cannot_stop_its_replacement() {
        let mut active = capture_worker("owner-a");
        active.worker_id = 2;
        let mut state = Some(active);
        assert!(!mark_worker_stopped(&mut state, 1));
        assert!(state.as_ref().is_some_and(|worker| worker.running));
        assert!(mark_worker_stopped(&mut state, 2));
        assert!(state.as_ref().is_some_and(|worker| !worker.running));
    }

    #[test]
    fn sample_conversion_covers_unsigned_integer_and_float_devices() {
        let mut unsigned = CaptureState::new(3);
        unsigned.push_input_samples(&[0_u16, 32_768, 65_535]);
        let (unsigned_rms, unsigned_samples) = unsigned.take_frame();
        assert_eq!(unsigned_samples, vec![-32_768, 0, 32_767]);
        assert!(unsigned_rms > 0.7);

        let mut floating = CaptureState::new(3);
        floating.push_input_samples(&[-1.0_f64, 0.0, 1.0]);
        let (floating_rms, floating_samples) = floating.take_frame();
        assert_eq!(floating_samples, vec![-32_768, 0, 32_767]);
        assert!(floating_rms > 0.7);
    }

    #[test]
    fn capture_events_are_scoped_to_the_request_owner() {
        let event = scope_capture_event("owner-a", serde_json::json!({ "state": "listening" }));
        assert_eq!(event["ownerId"], "owner-a");
        assert_eq!(event["state"], "listening");
    }

    #[test]
    fn microphone_stream_error_terminates_the_capture_loop() {
        let (tx, rx) = std::sync::mpsc::channel();
        tx.send("麦克风已断开".to_string()).expect("接收端仍然有效");
        assert_eq!(stream_failure(&rx), Err("麦克风已断开".to_string()));
    }

    #[test]
    fn capture_buffer_keeps_only_the_latest_bounded_samples() {
        let mut state = CaptureState::new(4);
        state.push_input_samples(&[1_i16, 2, 3, 4, 5, 6]);
        state.push_input_samples(&[7_i16, 8]);
        let (_, samples) = state.take_frame();
        assert_eq!(samples, vec![5, 6, 7, 8]);

        assert_eq!(max_capture_buffer_samples(48_000, 2), 96_000);
        assert!(max_capture_buffer_samples(u32::MAX, u16::MAX) * 2 <= MAX_CAPTURE_BUFFER_BYTES);
    }

    #[test]
    fn capture_shutdown_is_bounded_when_an_audio_thread_does_not_acknowledge() {
        let (command_tx, _command_rx) = std::sync::mpsc::channel();
        let (_done_tx, done_rx) = std::sync::mpsc::sync_channel(1);
        let mut worker = capture_worker("owner-a");
        worker.tx = Some(command_tx);
        worker.done_rx = Some(done_rx);

        let result = stop_capture_worker(&mut worker, std::time::Duration::from_millis(1));
        assert_eq!(result, Err("语音采集线程未在限定时间内停止".to_string()));
        assert!(!worker.running);
    }

    #[test]
    fn vad_duration_follows_captured_frames_instead_of_poll_count() {
        assert_eq!(
            captured_audio_duration(1_920, 48_000, 2),
            std::time::Duration::from_millis(20)
        );
        assert_eq!(
            captured_audio_duration(0, 48_000, 2),
            std::time::Duration::ZERO
        );
    }

    #[test]
    fn relay_pcm_chunk_size_uses_the_advertised_target_format() {
        assert_eq!(pcm_event_sample_count(24_000, 1), 2_400);
        assert_eq!(pcm_event_sample_count(48_000, 2), 9_600);
    }

    #[test]
    fn pcm_stream_is_downmixed_and_resampled_for_gateway_relay() {
        let mut resampler = PcmResampler::new(48_000, 2, 24_000);
        assert_eq!(
            resampler.push_interleaved(&[1_000, 3_000, 5_000, 7_000]),
            vec![2_000],
        );
    }

    #[test]
    fn resampling_keeps_phase_across_event_boundaries() {
        let samples: Vec<i16> = (0..512).map(|value| value * 17).collect();
        let mut whole = PcmResampler::new(44_100, 1, 24_000);
        let expected = whole.push_interleaved(&samples);

        let mut chunked = PcmResampler::new(44_100, 1, 24_000);
        let mut actual = chunked.push_interleaved(&samples[..173]);
        actual.extend(chunked.push_interleaved(&samples[173..]));
        assert_eq!(actual, expected);
    }
}
