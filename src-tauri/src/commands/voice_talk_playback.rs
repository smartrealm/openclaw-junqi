use base64::{engine::general_purpose::STANDARD, Engine};
use rodio::{buffer::SamplesBuffer, OutputStream, Sink};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

enum PlaybackCommand {
    Append {
        samples: Vec<i16>,
        response: mpsc::SyncSender<Result<(), String>>,
    },
    Stop,
}

static PLAYBACK: Mutex<Option<mpsc::Sender<PlaybackCommand>>> = Mutex::new(None);

fn decode_pcm16(base64: &str) -> Result<Vec<i16>, String> {
    let bytes = STANDARD
        .decode(base64)
        .map_err(|error| format!("Invalid Talk PCM frame: {error}"))?;
    if bytes.is_empty() || bytes.len() % 2 != 0 {
        return Err("Talk PCM frame must contain complete PCM16 samples".to_string());
    }
    Ok(bytes
        .chunks_exact(2)
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
        .collect())
}

fn start_playback_worker() -> mpsc::Sender<PlaybackCommand> {
    let (tx, rx) = mpsc::channel::<PlaybackCommand>();
    std::thread::spawn(move || {
        let (stream, handle) = match OutputStream::try_default() {
            Ok(output) => output,
            Err(error) => {
                while let Ok(command) = rx.recv() {
                    match command {
                        PlaybackCommand::Append { response, .. } => {
                            let _ = response
                                .send(Err(format!("Talk output device unavailable: {error}")));
                        }
                        PlaybackCommand::Stop => return,
                    }
                }
                return;
            }
        };
        let sink = match Sink::try_new(&handle) {
            Ok(sink) => sink,
            Err(error) => {
                while let Ok(command) = rx.recv() {
                    match command {
                        PlaybackCommand::Append { response, .. } => {
                            let _ = response
                                .send(Err(format!("Talk output queue unavailable: {error}")));
                        }
                        PlaybackCommand::Stop => return,
                    }
                }
                return;
            }
        };
        let _stream = stream;
        while let Ok(command) = rx.recv() {
            match command {
                PlaybackCommand::Append { samples, response } => {
                    sink.append(SamplesBuffer::new(1, 24_000, samples));
                    let _ = response.send(Ok(()));
                }
                PlaybackCommand::Stop => {
                    sink.stop();
                    return;
                }
            }
        }
    });
    tx
}

fn playback_sender() -> Result<mpsc::Sender<PlaybackCommand>, String> {
    let mut slot = PLAYBACK
        .lock()
        .map_err(|error| format!("Talk playback lock: {error}"))?;
    if slot.is_none() {
        *slot = Some(start_playback_worker());
    }
    slot.as_ref()
        .cloned()
        .ok_or_else(|| "Talk output queue did not initialize".to_string())
}

#[tauri::command]
pub fn voice_talk_play_pcm(
    audio_base64: String,
    sample_rate_hz: u32,
    channels: u16,
) -> Result<(), String> {
    if sample_rate_hz != 24_000 || channels != 1 {
        return Err("Talk playback accepts only PCM16 24000Hz mono frames".to_string());
    }
    let samples = decode_pcm16(&audio_base64)?;
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    playback_sender()?
        .send(PlaybackCommand::Append {
            samples,
            response: response_tx,
        })
        .map_err(|_| "Talk output worker stopped unexpectedly".to_string())?;
    response_rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Talk output worker did not accept the audio frame".to_string())?
}

#[tauri::command]
pub fn voice_talk_stop_playback() -> Result<(), String> {
    let sender = PLAYBACK
        .lock()
        .map_err(|error| format!("Talk playback lock: {error}"))?
        .take();
    if let Some(sender) = sender {
        let _ = sender.send(PlaybackCommand::Stop);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::decode_pcm16;

    #[test]
    fn pcm16_decoder_rejects_partial_samples() {
        assert!(decode_pcm16("AA==").is_err());
    }

    #[test]
    fn pcm16_decoder_reads_little_endian_samples() {
        assert_eq!(decode_pcm16("AQACAAMA").expect("valid PCM"), vec![1, 2, 3]);
    }
}
