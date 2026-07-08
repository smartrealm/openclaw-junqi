// Voice recording via macOS CoreAudio (cpal + hound).
// Spawns a dedicated thread to avoid cpal Send issues.
use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::fs;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

struct ActiveRecording {
    stop_tx: mpsc::Sender<()>,
    path: String,
    start: std::time::Instant,
}

static RECORDER: Mutex<Option<ActiveRecording>> = Mutex::new(None);

#[tauri::command]
pub fn voice_start_recording() -> Result<serde_json::Value, String> {
    // Stop any existing recording first
    {
        let mut guard = RECORDER.lock().map_err(|e| format!("Lock: {}", e))?;
        if let Some(rec) = guard.take() {
            let _ = rec.stop_tx.send(());
            let _ = fs::remove_file(&rec.path);
        }
    }

    let tmp = std::env::temp_dir().join(format!("junqi-voice-{}.wav", std::process::id()));
    let path = tmp.to_string_lossy().to_string();
    let path_clone = path.clone();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    std::thread::spawn(move || {
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
                _ => return Err("不支持的音频格式".to_string()),
            };

            stream.play().map_err(|e| format!("播放流失败: {}", e))?;

            // Block until stop signal
            let _ = stop_rx.recv();

            drop(stream);
            if let Ok(mut w) = writer.lock() {
                w.take();
            }
            Ok(())
        })();

        if let Err(e) = result {
            eprintln!("[Voice] recording error: {}", e);
        }
    });

    let rec = ActiveRecording {
        stop_tx,
        path: path.clone(),
        start: std::time::Instant::now(),
    };
    let mut guard = RECORDER.lock().map_err(|e| format!("Lock: {}", e))?;
    *guard = Some(rec);

    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub fn voice_stop_recording() -> Result<serde_json::Value, String> {
    let rec = {
        let mut guard = RECORDER.lock().map_err(|e| format!("Lock: {}", e))?;
        guard.take().ok_or("没有正在进行的录音")?
    };

    let _ = rec.stop_tx.send(());
    // Brief wait for the recording thread to finalize the WAV file
    std::thread::sleep(std::time::Duration::from_millis(200));

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
    Ok(serde_json::json!({ "recording": guard.is_some() }))
}
