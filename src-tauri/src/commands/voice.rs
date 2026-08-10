// 使用 CPAL 与 WAV 编码器进行跨平台原生录音。
// 独立线程隔离 CPAL 的非 Send 流对象。
use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::fs;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

struct ActiveRecording {
    recording_id: String,
    stop_tx: mpsc::Sender<()>,
    worker: JoinHandle<Result<(), String>>,
    path: String,
    start: std::time::Instant,
}

static RECORDER: Mutex<Option<ActiveRecording>> = Mutex::new(None);

fn take_matching_recording(
    recorder_slot: &mut Option<ActiveRecording>,
    recording_id: &str,
) -> Result<ActiveRecording, String> {
    if recording_id.trim().is_empty() {
        return Err("录音实例标识不能为空".to_string());
    }
    let matches = recorder_slot
        .as_ref()
        .map(|active| active.recording_id == recording_id)
        .unwrap_or(false);
    if !matches {
        return Err("录音实例已被替换或不存在".to_string());
    }
    recorder_slot.take().ok_or("没有正在进行的录音".to_string())
}

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
    // 启动事务全程持有槽位，保证并发停止只能处理随后安装的同一工作线程。
    let mut recorder_slot = RECORDER.lock().map_err(|e| format!("Lock: {}", e))?;
    if let Some(previous) = recorder_slot.take() {
        stop_and_discard_recording(previous);
    }

    let recording_id = uuid::Uuid::new_v4().to_string();
    let tmp = std::env::temp_dir().join(format!("junqi-voice-{recording_id}.wav"));
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

            // 等待对应实例的停止信号。
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
        recording_id: recording_id.clone(),
        stop_tx,
        worker,
        path: path.clone(),
        start: std::time::Instant::now(),
    };
    *recorder_slot = Some(rec);

    Ok(serde_json::json!({ "success": true, "recordingId": recording_id }))
}

#[tauri::command]
pub fn voice_stop_recording(recording_id: String) -> Result<serde_json::Value, String> {
    let rec = {
        let mut guard = RECORDER.lock().map_err(|e| format!("Lock: {}", e))?;
        take_matching_recording(&mut guard, &recording_id)?
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

#[cfg(test)]
mod tests {
    use super::*;

    fn recording(recording_id: &str) -> ActiveRecording {
        let (stop_tx, _stop_rx) = mpsc::channel();
        ActiveRecording {
            recording_id: recording_id.to_string(),
            stop_tx,
            worker: std::thread::spawn(|| Ok(())),
            path: String::new(),
            start: std::time::Instant::now(),
        }
    }

    #[test]
    fn mismatched_stop_keeps_the_replacement_recording_owned() {
        let mut slot = Some(recording("new-recording"));

        assert!(take_matching_recording(&mut slot, "old-recording").is_err());
        assert_eq!(
            slot.as_ref().map(|active| active.recording_id.as_str()),
            Some("new-recording")
        );

        let owned =
            take_matching_recording(&mut slot, "new-recording").expect("matching recording");
        owned
            .worker
            .join()
            .expect("recording worker")
            .expect("recording result");
        assert!(slot.is_none());
    }
}
