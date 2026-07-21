// Voice recording via macOS CoreAudio (cpal + hound).
// Spawns a dedicated thread to avoid cpal Send issues.
use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::fs;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

struct ActiveRecording {
    stop_tx: mpsc::Sender<()>,
    worker: JoinHandle<Result<(), String>>,
    path: String,
    start: std::time::Instant,
}

static RECORDER: Mutex<Option<ActiveRecording>> = Mutex::new(None);

fn stop_and_discard_recording(rec: ActiveRecording) {
    let ActiveRecording {
        stop_tx,
        worker,
        path,
        ..
    } = rec;
    let _ = stop_tx.send(());
    let _ = worker.join();
    let _ = fs::remove_file(path);
}

#[tauri::command]
pub fn voice_start_recording() -> Result<serde_json::Value, String> {
    // Hold the slot for the full start transaction. A concurrent stop then
    // waits and deterministically addresses the worker installed below.
    let mut recorder_slot = RECORDER.lock().map_err(|e| format!("Lock: {}", e))?;
    if let Some(previous) = recorder_slot.take() {
        stop_and_discard_recording(previous);
    }

    let tmp = std::env::temp_dir().join(format!("junqi-voice-{}.wav", uuid::Uuid::new_v4()));
    let path = tmp.to_string_lossy().to_string();
    let path_clone = path.clone();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);

    let worker = std::thread::spawn(move || -> Result<(), String> {
        let result: Result<(), String> = (|| {
            let host = cpal::default_host();
            let device = host.default_input_device().ok_or("未找到麦克风设备")?;
            let config = device
                .default_input_config()
                .map_err(|e| format!("麦克风配置失败: {}", e))?;

            let spec = hound::WavSpec {
                channels: config.channels(),
                sample_rate: config.sample_rate().0,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };
            let writer = hound::WavWriter::create(&path_clone, spec)
                .map_err(|e| format!("创建文件失败: {}", e))?;
            let writer = Arc::new(Mutex::new(Some(writer)));

            let writer_clone = writer.clone();
            let stream = match config.sample_format() {
                cpal::SampleFormat::I16 => device
                    .build_input_stream(
                        &config.into(),
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            if let Ok(mut w) = writer_clone.lock() {
                                if let Some(ref mut w) = *w {
                                    for &s in data {
                                        let _ = w.write_sample(s);
                                    }
                                }
                            }
                        },
                        |e| eprintln!("[Voice] error: {}", e),
                        None,
                    )
                    .map_err(|e| format!("启动流失败: {}", e))?,
                cpal::SampleFormat::F32 => device
                    .build_input_stream(
                        &config.into(),
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            if let Ok(mut w) = writer_clone.lock() {
                                if let Some(ref mut w) = *w {
                                    for &s in data {
                                        let _ = w.write_sample((s * i16::MAX as f32) as i16);
                                    }
                                }
                            }
                        },
                        |e| eprintln!("[Voice] error: {}", e),
                        None,
                    )
                    .map_err(|e| format!("启动流失败: {}", e))?,
                cpal::SampleFormat::U16 => device
                    .build_input_stream(
                        &config.into(),
                        move |data: &[u16], _: &cpal::InputCallbackInfo| {
                            if let Ok(mut w) = writer_clone.lock() {
                                if let Some(ref mut w) = *w {
                                    for &s in data {
                                        let sample = (s as i32 - i16::MAX as i32 - 1) as i16;
                                        let _ = w.write_sample(sample);
                                    }
                                }
                            }
                        },
                        |e| eprintln!("[Voice] error: {}", e),
                        None,
                    )
                    .map_err(|e| format!("启动流失败: {}", e))?,
                _ => return Err("不支持的音频格式".to_string()),
            };

            stream.play().map_err(|e| format!("播放流失败: {}", e))?;
            let _ = ready_tx.send(Ok(()));

            // Block until stop signal
            let _ = stop_rx.recv();

            drop(stream);
            if let Ok(mut w) = writer.lock() {
                if let Some(writer) = w.take() {
                    writer
                        .finalize()
                        .map_err(|e| format!("WAV finalize 失败: {}", e))?;
                }
            }
            Ok(())
        })();

        if let Err(error) = &result {
            let _ = ready_tx.send(Err(error.clone()));
            eprintln!("[Voice] recording error: {}", error);
        }
        result
    });

    match ready_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            let _ = worker.join();
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        Err(error) => {
            let _ = stop_tx.send(());
            let _ = worker.join();
            let _ = fs::remove_file(&path);
            return Err(format!("录音启动超时: {}", error));
        }
    }

    let rec = ActiveRecording {
        stop_tx,
        worker,
        path: path.clone(),
        start: std::time::Instant::now(),
    };
    *recorder_slot = Some(rec);

    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub fn voice_stop_recording() -> Result<serde_json::Value, String> {
    let rec = {
        let mut guard = RECORDER.lock().map_err(|e| format!("Lock: {}", e))?;
        guard.take().ok_or("没有正在进行的录音")?
    };

    let _ = rec.stop_tx.send(());
    rec.worker
        .join()
        .map_err(|_| "录音线程异常退出".to_string())??;

    let elapsed = rec.start.elapsed().as_secs_f64();
    if !std::path::Path::new(&rec.path).exists() {
        return Err("录音文件未找到".to_string());
    }

    let bytes = fs::read(&rec.path).map_err(|e| format!("读取失败: {}", e))?;
    let _ = fs::remove_file(&rec.path);
    let b64 = STANDARD.encode(&bytes);

    Ok(serde_json::json!({
        "success": true,
        "data": format!("data:audio/wav;base64,{}", b64),
        "duration": elapsed.round() as u64
    }))
}

#[tauri::command]
pub fn voice_is_recording() -> Result<serde_json::Value, String> {
    let guard = RECORDER.lock().map_err(|e| format!("Lock: {}", e))?;
    let recording = guard
        .as_ref()
        .map(|active| !active.worker.is_finished())
        .unwrap_or(false);
    Ok(serde_json::json!({ "recording": recording }))
}
