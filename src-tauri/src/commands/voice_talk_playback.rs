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
    Finish {
        response: mpsc::SyncSender<Result<(), String>>,
    },
    Stop {
        response: mpsc::SyncSender<Result<(), String>>,
    },
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
                        PlaybackCommand::Finish { response } => {
                            let _ = response
                                .send(Err(format!("Talk output device unavailable: {error}")));
                        }
                        PlaybackCommand::Stop { response } => {
                            let _ = response.send(Ok(()));
                            return;
                        }
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
                        PlaybackCommand::Finish { response } => {
                            let _ = response
                                .send(Err(format!("Talk output queue unavailable: {error}")));
                        }
                        PlaybackCommand::Stop { response } => {
                            let _ = response.send(Ok(()));
                            return;
                        }
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
                PlaybackCommand::Finish { response } => {
                    let mut completion = Some(response);
                    loop {
                        if sink.empty() {
                            if let Some(response) = completion.take() {
                                let _ = response.send(Ok(()));
                            }
                            break;
                        }
                        match rx.recv_timeout(Duration::from_millis(20)) {
                            Ok(PlaybackCommand::Append { samples, response }) => {
                                sink.append(SamplesBuffer::new(1, 24_000, samples));
                                let _ = response.send(Ok(()));
                            }
                            Ok(PlaybackCommand::Finish { response }) => {
                                let _ = response
                                    .send(Err("Talk output is already draining".to_string()));
                            }
                            Ok(PlaybackCommand::Stop { response }) => {
                                sink.stop();
                                if let Some(response) = completion.take() {
                                    let _ =
                                        response.send(Err("Talk output interrupted".to_string()));
                                }
                                let _ = response.send(Ok(()));
                                return;
                            }
                            Err(mpsc::RecvTimeoutError::Timeout) => {}
                            Err(mpsc::RecvTimeoutError::Disconnected) => {
                                if let Some(response) = completion.take() {
                                    let _ =
                                        response
                                            .send(Err("Talk output worker stopped unexpectedly"
                                                .to_string()));
                                }
                                return;
                            }
                        }
                    }
                }
                PlaybackCommand::Stop { response } => {
                    sink.stop();
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
        .map_err(|_| "Talk output worker stopped unexpectedly".to_string())?;
    response_rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "Talk output worker did not stop promptly".to_string())?
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
    // Keep the singleton lock until the old sink has acknowledged stop. This prevents a
    // concurrent append from creating a second worker before the old physical output ends.
    let mut slot = PLAYBACK
        .lock()
        .map_err(|error| format!("Talk playback lock: {error}"))?;
    let sender = slot.take();
    if let Some(sender) = sender {
        stop_playback_sender(&sender)?;
    }
    Ok(())
}

#[tauri::command]
pub fn voice_talk_finish_playback() -> Result<(), String> {
    let sender = playback_sender()?;
    let (response_tx, response_rx) = mpsc::sync_channel(1);
    sender
        .send(PlaybackCommand::Finish {
            response: response_tx,
        })
        .map_err(|_| "Talk output worker stopped unexpectedly".to_string())?;
    response_rx
        .recv_timeout(Duration::from_secs(90))
        .map_err(|_| "Talk output worker did not drain before timeout".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{decode_pcm16, stop_playback_sender, PlaybackCommand};
    use std::sync::mpsc;
    use std::thread;

    #[test]
    fn pcm16_decoder_rejects_partial_samples() {
        assert!(decode_pcm16("AA==").is_err());
    }

    #[test]
    fn pcm16_decoder_reads_little_endian_samples() {
        assert_eq!(decode_pcm16("AQACAAMA").expect("valid PCM"), vec![1, 2, 3]);
    }

    #[test]
    fn stop_waits_for_worker_acknowledgement() {
        let (sender, receiver) = mpsc::channel();
        let worker = thread::spawn(move || match receiver.recv().expect("stop command") {
            PlaybackCommand::Stop { response } => response.send(Ok(())).expect("acknowledge stop"),
            _ => panic!("expected stop command"),
        });
        assert!(stop_playback_sender(&sender).is_ok());
        worker.join().expect("worker joins");
    }
}
