use base64::{engine::general_purpose::STANDARD, Engine};
use rodio::{buffer::SamplesBuffer, OutputStream, Sink};
use serde::Serialize;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MIN_SAMPLE_RATE_HZ: u32 = 8_000;
const MAX_SAMPLE_RATE_HZ: u32 = 192_000;
const MAX_CHANNELS: u16 = 8;
const MAX_QUEUED_AUDIO_SECONDS: u64 = 10;
const MAX_QUEUED_AUDIO_SOURCES: usize = 320;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTalkPlaybackAppendResult {
    queued: bool,
}

enum PlaybackCommand {
    Append {
        samples: Vec<i16>,
        sample_rate_hz: u32,
        channels: u16,
        response: mpsc::SyncSender<Result<bool, String>>,
    },
    Finish {
        response: mpsc::SyncSender<Result<(), String>>,
    },
    Stop {
        response: mpsc::SyncSender<Result<(), String>>,
    },
}

struct PlaybackQueue {
    sink: Sink,
    queued_until: Instant,
}

impl PlaybackQueue {
    fn new(sink: Sink) -> Self {
        Self {
            sink,
            queued_until: Instant::now(),
        }
    }

    fn append(&mut self, samples: Vec<i16>, sample_rate_hz: u32, channels: u16) -> bool {
        let now = Instant::now();
        if self.sink.empty() {
            self.queued_until = now;
        }
        let queued_seconds = self
            .queued_until
            .saturating_duration_since(now)
            .as_secs_f64();
        let frame_seconds = samples.len() as f64 / f64::from(sample_rate_hz) / f64::from(channels);
        if !can_queue_frame(self.sink.len(), queued_seconds, frame_seconds) {
            return false;
        }

        self.sink
            .append(SamplesBuffer::new(channels, sample_rate_hz, samples));
        self.queued_until += Duration::from_secs_f64(frame_seconds);
        true
    }

    fn stop(&self) {
        self.sink.stop();
    }

    fn empty(&self) -> bool {
        self.sink.empty()
    }
}

static PLAYBACK: Mutex<Option<mpsc::Sender<PlaybackCommand>>> = Mutex::new(None);

fn validate_audio_format(sample_rate_hz: u32, channels: u16) -> Result<(), String> {
    if !(MIN_SAMPLE_RATE_HZ..=MAX_SAMPLE_RATE_HZ).contains(&sample_rate_hz) {
        return Err("Talk 播放采样率超出原生音频边界".to_string());
    }
    if channels == 0 || channels > MAX_CHANNELS {
        return Err("Talk 播放声道数超出原生音频边界".to_string());
    }
    Ok(())
}

fn decode_pcm16(base64: &str, sample_rate_hz: u32, channels: u16) -> Result<Vec<i16>, String> {
    let max_bytes = usize::try_from(sample_rate_hz)
        .unwrap_or(usize::MAX)
        .saturating_mul(usize::from(channels))
        .saturating_mul(2)
        .saturating_mul(MAX_QUEUED_AUDIO_SECONDS as usize);
    let max_base64_length = max_bytes
        .saturating_add(2)
        .saturating_div(3)
        .saturating_mul(4);
    if base64.len() > max_base64_length {
        return Err("Talk PCM 数据超过单次播放边界".to_string());
    }

    let bytes = STANDARD
        .decode(base64)
        .map_err(|error| format!("Talk PCM 数据无效: {error}"))?;
    let frame_bytes = usize::from(channels) * 2;
    if bytes.is_empty() || bytes.len() % frame_bytes != 0 {
        return Err("Talk PCM 数据不包含完整音频帧".to_string());
    }
    Ok(bytes
        .chunks_exact(2)
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
        .collect())
}

fn can_queue_frame(pending_sources: usize, queued_seconds: f64, frame_seconds: f64) -> bool {
    pending_sources < MAX_QUEUED_AUDIO_SOURCES
        && frame_seconds.is_finite()
        && frame_seconds > 0.0
        && queued_seconds + frame_seconds <= MAX_QUEUED_AUDIO_SECONDS as f64
}

fn respond_to_unavailable_output(rx: mpsc::Receiver<PlaybackCommand>, error: String) {
    while let Ok(command) = rx.recv() {
        match command {
            PlaybackCommand::Append { response, .. } => {
                let _ = response.send(Err(error.clone()));
            }
            PlaybackCommand::Finish { response } => {
                let _ = response.send(Err(error.clone()));
            }
            PlaybackCommand::Stop { response } => {
                let _ = response.send(Ok(()));
                return;
            }
        }
    }
}

fn start_playback_worker() -> mpsc::Sender<PlaybackCommand> {
    let (tx, rx) = mpsc::channel::<PlaybackCommand>();
    std::thread::spawn(move || {
        let (stream, handle) = match OutputStream::try_default() {
            Ok(output) => output,
            Err(error) => {
                respond_to_unavailable_output(rx, format!("Talk 输出设备不可用: {error}"));
                return;
            }
        };
        let sink = match Sink::try_new(&handle) {
            Ok(sink) => sink,
            Err(error) => {
                respond_to_unavailable_output(rx, format!("Talk 输出队列不可用: {error}"));
                return;
            }
        };
        let _stream = stream;
        let mut queue = PlaybackQueue::new(sink);
        while let Ok(command) = rx.recv() {
            match command {
                PlaybackCommand::Append {
                    samples,
                    sample_rate_hz,
                    channels,
                    response,
                } => {
                    let queued = queue.append(samples, sample_rate_hz, channels);
                    let _ = response.send(Ok(queued));
                }
                PlaybackCommand::Finish { response } => {
                    let mut completion = Some(response);
                    loop {
                        if queue.empty() {
                            if let Some(response) = completion.take() {
                                let _ = response.send(Ok(()));
                            }
                            break;
                        }
                        match rx.recv_timeout(Duration::from_millis(20)) {
                            Ok(PlaybackCommand::Append {
                                samples,
                                sample_rate_hz,
                                channels,
                                response,
                            }) => {
                                let queued = queue.append(samples, sample_rate_hz, channels);
                                let _ = response.send(Ok(queued));
                            }
                            Ok(PlaybackCommand::Finish { response }) => {
                                let _ = response.send(Err("Talk 输出正在等待播放完成".to_string()));
                            }
                            Ok(PlaybackCommand::Stop { response }) => {
                                queue.stop();
                                if let Some(completion) = completion.take() {
                                    let _ = completion.send(Err("Talk 输出已中断".to_string()));
                                }
                                let _ = response.send(Ok(()));
                                return;
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {}
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                if let Some(completion) = completion.take() {
                                    let _ =
                                        completion.send(Err("Talk 输出线程意外停止".to_string()));
                                }
                                return;
                            }
                        }
                    }
                }
                PlaybackCommand::Stop { response } => {
                    queue.stop();
                    let _ = response.send(Ok(()));
                    return;
                }
            }
        }
    });
    tx
}

fn stop_playback_sender(sender: &mpsc::Sender<PlaybackCommand>) -> Result<(), String> {
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    sender
        .send(PlaybackCommand::Stop {
            response: response_tx,
        })
        .map_err(|_| "Talk 输出线程意外停止".to_string())?;
    response_rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Talk 输出线程未及时停止".to_string())?
}

fn playback_sender() -> Result<mpsc::Sender<PlaybackCommand>, String> {
    let mut slot = PLAYBACK
        .lock()
        .map_err(|error| format!("Talk 播放状态锁失败: {error}"))?;
    if slot.is_none() {
        *slot = Some(start_playback_worker());
    }
    slot.as_ref()
        .cloned()
        .ok_or_else(|| "Talk 输出队列初始化失败".to_string())
}

fn voice_talk_play_pcm_blocking(
    audio_base64: String,
    sample_rate_hz: u32,
    channels: u16,
) -> Result<VoiceTalkPlaybackAppendResult, String> {
    validate_audio_format(sample_rate_hz, channels)?;
    let samples = decode_pcm16(&audio_base64, sample_rate_hz, channels)?;
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    playback_sender()?
        .send(PlaybackCommand::Append {
            samples,
            sample_rate_hz,
            channels,
            response: response_tx,
        })
        .map_err(|_| "Talk 输出线程意外停止".to_string())?;
    let queued = response_rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Talk 输出线程未及时接收音频帧".to_string())??;
    Ok(VoiceTalkPlaybackAppendResult { queued })
}

/// 解码和队列确认都可能阻塞，统一放入 Tauri 的阻塞任务池。
#[tauri::command]
pub async fn voice_talk_play_pcm(
    audio_base64: String,
    sample_rate_hz: u32,
    channels: u16,
) -> Result<VoiceTalkPlaybackAppendResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        voice_talk_play_pcm_blocking(audio_base64, sample_rate_hz, channels)
    })
    .await
    .map_err(|error| format!("Talk 播放任务异常结束: {error}"))?
}

pub fn stop_playback_for_privacy_lock() -> Result<(), String> {
    voice_talk_stop_playback_blocking()
}

fn voice_talk_stop_playback_blocking() -> Result<(), String> {
    // 持有单例锁直到旧输出确认停止，避免并发追加提前创建第二个物理输出线程。
    let mut slot = PLAYBACK
        .lock()
        .map_err(|error| format!("Talk 播放状态锁失败: {error}"))?;
    let sender = slot.take();
    if let Some(sender) = sender {
        stop_playback_sender(&sender)?;
    }
    Ok(())
}

/// 停止确认不会占用 Tauri 调度线程。
#[tauri::command]
pub async fn voice_talk_stop_playback() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(voice_talk_stop_playback_blocking)
        .await
        .map_err(|error| format!("Talk 停止任务异常结束: {error}"))?
}

fn voice_talk_finish_playback_blocking() -> Result<(), String> {
    let sender = playback_sender()?;
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    sender
        .send(PlaybackCommand::Finish {
            response: response_tx,
        })
        .map_err(|_| "Talk 输出线程意外停止".to_string())?;
    response_rx
        .recv_timeout(Duration::from_secs(90))
        .map_err(|_| "Talk 输出未在限定时间内播放完成".to_string())?
}

/// 播放排空最长可等待九十秒，必须在阻塞任务池中完成。
#[tauri::command]
pub async fn voice_talk_finish_playback() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(voice_talk_finish_playback_blocking)
        .await
        .map_err(|error| format!("Talk 播放排空任务异常结束: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        can_queue_frame, decode_pcm16, stop_playback_sender, validate_audio_format,
        PlaybackCommand, MAX_QUEUED_AUDIO_SOURCES,
    };
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn pcm16_decoder_rejects_partial_frames() {
        assert!(decode_pcm16("AA==", 24_000, 1).is_err());
        assert!(decode_pcm16("AQACAAMA", 24_000, 2).is_err());
    }

    #[test]
    fn pcm16_decoder_reads_little_endian_samples() {
        assert_eq!(
            decode_pcm16("AQACAAMA", 24_000, 1).expect("PCM 数据有效"),
            vec![1, 2, 3]
        );
    }

    #[test]
    fn playback_format_uses_verified_native_bounds() {
        assert!(validate_audio_format(8_000, 1).is_ok());
        assert!(validate_audio_format(48_000, 2).is_ok());
        assert!(validate_audio_format(7_999, 1).is_err());
        assert!(validate_audio_format(48_000, 0).is_err());
    }

    #[test]
    fn playback_queue_has_time_and_source_bounds() {
        assert!(can_queue_frame(0, 0.0, 0.02));
        assert!(!can_queue_frame(MAX_QUEUED_AUDIO_SOURCES, 0.0, 0.02));
        assert!(!can_queue_frame(1, 9.9, 0.2));
        assert!(!can_queue_frame(1, 0.0, f64::INFINITY));
    }

    #[test]
    fn stop_waits_for_worker_acknowledgement() {
        let (sender, receiver) = mpsc::channel();
        let worker = thread::spawn(move || match receiver.recv().expect("收到停止命令") {
            PlaybackCommand::Stop { response } => response.send(Ok(())).expect("确认停止"),
            _ => panic!("预期收到停止命令"),
        });
        assert!(stop_playback_sender(&sender).is_ok());
        worker.join().expect("输出线程结束");
    }
}
