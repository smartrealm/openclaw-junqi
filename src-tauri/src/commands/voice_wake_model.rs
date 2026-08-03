use serde::{Deserialize, Serialize};
use sherpa_onnx::{KeywordSpotter, KeywordSpotterConfig, OnlineStream};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "voice-wake-model.json";
const MODEL_ID: &str = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20";
const ENCODER_FILE: &str = "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx";
const DECODER_FILE: &str = "decoder-epoch-13-avg-2-chunk-16-left-64.onnx";
const JOINER_FILE: &str = "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx";
const TOKENS_FILE: &str = "tokens.txt";
const KEYWORDS_FILE: &str = "keywords.txt";
// The OpenClaw voice-wake protocol caps triggers at 64 JavaScript UTF-16 code units.
const MAX_GATEWAY_TRIGGER_UTF16_CODE_UNITS: usize = 64;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredWakeModel {
    model_id: String,
    directory: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeDetectorStatus {
    pub available: bool,
    pub model_id: Option<String>,
    pub directory: Option<String>,
    pub keywords: Vec<String>,
    pub reason: Option<String>,
}

pub struct WakeKeywordSpotter {
    spotter: KeywordSpotter,
    stream: OnlineStream,
}

impl WakeKeywordSpotter {
    pub fn create(directory: &Path) -> Result<Self, String> {
        validate_model_directory(directory)?;
        let mut config = KeywordSpotterConfig::default();
        config.model_config.transducer.encoder = Some(path_string(directory.join(ENCODER_FILE))?);
        config.model_config.transducer.decoder = Some(path_string(directory.join(DECODER_FILE))?);
        config.model_config.transducer.joiner = Some(path_string(directory.join(JOINER_FILE))?);
        config.model_config.tokens = Some(path_string(directory.join(TOKENS_FILE))?);
        config.model_config.modeling_unit = Some("phone+ppinyin".to_string());
        config.keywords_file = Some(path_string(directory.join(KEYWORDS_FILE))?);

        let spotter = KeywordSpotter::create(&config)
            .ok_or_else(|| "Unable to create the local keyword detector".to_string())?;
        let stream = spotter.create_stream();
        Ok(Self { spotter, stream })
    }

    pub fn accept_waveform_and_detect(
        &mut self,
        sample_rate: u32,
        samples: &[f32],
    ) -> Option<String> {
        if samples.is_empty() {
            return None;
        }
        let Ok(sample_rate) = i32::try_from(sample_rate) else {
            return None;
        };
        self.stream.accept_waveform(sample_rate, samples);
        while self.spotter.is_ready(&self.stream) {
            self.spotter.decode(&self.stream);
            if let Some(result) = self.spotter.get_result(&self.stream) {
                let keyword = result.keyword.trim();
                if keyword.is_empty() {
                    continue;
                }
                self.spotter.reset(&self.stream);
                return Some(keyword.to_string());
            }
        }
        None
    }
}

pub fn detector_status(app: &AppHandle) -> WakeDetectorStatus {
    let stored = match read_settings(app) {
        Ok(Some(stored)) => stored,
        Ok(None) => return unavailable("model_directory_not_configured"),
        Err(_) => return unavailable("model_settings_unreadable"),
    };
    if stored.model_id != MODEL_ID {
        return unavailable("unsupported_model");
    }
    match validate_model_directory(&stored.directory) {
        Ok(()) => match read_keyword_labels(&stored.directory) {
            Ok(keywords) => match WakeKeywordSpotter::create(&stored.directory) {
                Ok(_) => WakeDetectorStatus {
                    available: true,
                    model_id: Some(stored.model_id),
                    directory: Some(stored.directory.to_string_lossy().into_owned()),
                    keywords,
                    reason: None,
                },
                Err(_) => unavailable_for_model(&stored, "detector_initialization_failed"),
            },
            Err(reason) => unavailable_for_model(&stored, &reason),
        },
        Err(reason) => WakeDetectorStatus {
            available: false,
            model_id: Some(stored.model_id),
            directory: Some(stored.directory.to_string_lossy().into_owned()),
            keywords: Vec::new(),
            reason: Some(reason),
        },
    }
}

pub fn configured_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let status = detector_status(app);
    if !status.available {
        return Err(status
            .reason
            .unwrap_or_else(|| "wake_detector_unavailable".to_string()));
    }
    status
        .directory
        .map(PathBuf::from)
        .ok_or_else(|| "model_directory_not_configured".to_string())
}

#[tauri::command]
pub fn voice_wake_detector_status(app: AppHandle) -> WakeDetectorStatus {
    detector_status(&app)
}

#[tauri::command]
pub fn voice_wake_set_model_directory(
    app: AppHandle,
    directory: String,
) -> Result<WakeDetectorStatus, String> {
    let directory = PathBuf::from(directory);
    validate_model_directory(&directory)?;
    read_keyword_labels(&directory)?;
    WakeKeywordSpotter::create(&directory)?;
    let settings = StoredWakeModel {
        model_id: MODEL_ID.to_string(),
        directory,
    };
    let settings_path = settings_path(&app)?;
    write_settings(&settings_path, &settings)?;
    Ok(detector_status(&app))
}

fn unavailable(reason: &str) -> WakeDetectorStatus {
    WakeDetectorStatus {
        available: false,
        model_id: None,
        directory: None,
        keywords: Vec::new(),
        reason: Some(reason.to_string()),
    }
}

fn unavailable_for_model(stored: &StoredWakeModel, reason: &str) -> WakeDetectorStatus {
    WakeDetectorStatus {
        available: false,
        model_id: Some(stored.model_id.clone()),
        directory: Some(stored.directory.to_string_lossy().into_owned()),
        keywords: Vec::new(),
        reason: Some(reason.to_string()),
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(SETTINGS_FILE))
}

fn read_settings(app: &AppHandle) -> Result<Option<StoredWakeModel>, String> {
    let settings_path = settings_path(app)?;
    if !settings_path.exists() {
        return Ok(None);
    }
    let raw = fs::read(settings_path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&raw)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn write_settings(settings_path: &Path, settings: &StoredWakeModel) -> Result<(), String> {
    let encoded = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    crate::paths::atomic_write_text(settings_path, &encoded)
}

fn validate_model_directory(directory: &Path) -> Result<(), String> {
    if !directory.is_dir() {
        return Err("model_directory_missing".to_string());
    }
    for file_name in [
        ENCODER_FILE,
        DECODER_FILE,
        JOINER_FILE,
        TOKENS_FILE,
        KEYWORDS_FILE,
    ] {
        let asset = directory.join(file_name);
        if !asset.is_file() {
            return Err(format!("model_asset_missing:{file_name}"));
        }
        if fs::metadata(&asset)
            .map_err(|error| error.to_string())?
            .len()
            == 0
        {
            return Err(format!("model_asset_empty:{file_name}"));
        }
    }
    Ok(())
}

fn read_keyword_labels(directory: &Path) -> Result<Vec<String>, String> {
    let raw = fs::read_to_string(directory.join(KEYWORDS_FILE))
        .map_err(|_| "model_keywords_unreadable".to_string())?;
    parse_keyword_labels(&raw)
}

fn parse_keyword_labels(raw: &str) -> Result<Vec<String>, String> {
    let mut keywords = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let label = line
            .split_whitespace()
            .find_map(|token| token.strip_prefix('@'))
            .filter(|label| !label.trim().is_empty())
            .ok_or_else(|| "model_keywords_missing_label".to_string())?;
        if label.encode_utf16().count() > MAX_GATEWAY_TRIGGER_UTF16_CODE_UNITS {
            return Err("model_keywords_label_too_long".to_string());
        }
        if !keywords.iter().any(|candidate| candidate == label) {
            keywords.push(label.to_string());
            if keywords.len() > 32 {
                return Err("model_keywords_too_many".to_string());
            }
        }
    }
    if keywords.is_empty() {
        return Err("model_keywords_empty".to_string());
    }
    Ok(keywords)
}

fn path_string(path: PathBuf) -> Result<String, String> {
    path.into_os_string()
        .into_string()
        .map_err(|_| "model path is not valid Unicode".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        parse_keyword_labels, validate_model_directory, write_settings, StoredWakeModel,
        WakeKeywordSpotter,
    };
    use std::fs;
    use std::path::Path;

    #[test]
    fn model_directory_requires_the_keyword_asset() {
        let base = std::env::temp_dir().join(format!("junqi-voice-wake-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("create test directory");
        for file_name in [
            "encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx",
            "decoder-epoch-13-avg-2-chunk-16-left-64.onnx",
            "joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx",
            "tokens.txt",
        ] {
            fs::write(base.join(file_name), b"test").expect("write test asset");
        }

        assert_eq!(
            validate_model_directory(&base).expect_err("keyword file must be required"),
            "model_asset_missing:keywords.txt"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn model_keyword_labels_require_the_official_original_phrase_marker() {
        assert_eq!(
            parse_keyword_labels("j a r v i s @JARVIS\nn ǐ h ǎo @你好\n")
                .expect("parse official keyword labels"),
            vec!["JARVIS", "你好"]
        );
        assert_eq!(
            parse_keyword_labels("j a r v i s\n").expect_err("marker is required"),
            "model_keywords_missing_label"
        );
    }

    #[test]
    fn model_keyword_labels_match_the_gateway_utf16_trigger_limit() {
        let maximum = "a".repeat(64);
        assert_eq!(
            parse_keyword_labels(&format!("a @{}\n", maximum))
                .expect("64 UTF-16 code units are accepted"),
            vec![maximum]
        );
        assert_eq!(
            parse_keyword_labels(&format!("a @{}\n", "a".repeat(65)))
                .expect_err("a label beyond the Gateway limit is rejected"),
            "model_keywords_label_too_long"
        );
        assert_eq!(
            parse_keyword_labels(&format!("a @{}\n", "𐐀".repeat(33)))
                .expect_err("the length is measured as JavaScript UTF-16 code units"),
            "model_keywords_label_too_long"
        );
    }

    #[test]
    #[ignore = "requires JUNQI_WAKE_MODEL_DIR to point at the official Sherpa model fixture"]
    fn official_model_fixture_detects_a_keyword_when_supplied() {
        let directory = std::env::var("JUNQI_WAKE_MODEL_DIR")
            .expect("JUNQI_WAKE_MODEL_DIR must point at the official Sherpa model fixture");
        let directory = Path::new(&directory);
        let mut detector = WakeKeywordSpotter::create(directory)
            .expect("official model fixture creates a keyword detector");
        let mut reader = hound::WavReader::open(directory.join("test_wavs/zh_3.wav"))
            .expect("official model fixture contains zh_3.wav");
        let sample_rate = reader.spec().sample_rate;
        let mut samples = reader
            .samples::<i16>()
            .map(|sample| sample.expect("valid fixture sample") as f32 / i16::MAX as f32)
            .collect::<Vec<_>>();
        samples.extend(std::iter::repeat_n(0.0, (sample_rate / 2) as usize));

        let detected = detector
            .accept_waveform_and_detect(sample_rate, &samples)
            .expect("official fixture must detect a configured keyword");
        let configured = super::read_keyword_labels(directory)
            .expect("official fixture has configured keyword labels");
        assert!(
            configured.iter().any(|keyword| keyword == &detected),
            "detected keyword must be one of the configured labels: {detected}"
        );
    }

    #[test]
    fn model_settings_are_replaced_atomically() {
        let base =
            std::env::temp_dir().join(format!("junqi-voice-wake-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let path = base.join("voice-wake-model.json");
        write_settings(
            &path,
            &StoredWakeModel {
                model_id: "first".to_string(),
                directory: base.join("first"),
            },
        )
        .expect("write first settings");
        write_settings(
            &path,
            &StoredWakeModel {
                model_id: "second".to_string(),
                directory: base.join("second"),
            },
        )
        .expect("replace settings");
        let settings: StoredWakeModel =
            serde_json::from_slice(&fs::read(&path).expect("read settings"))
                .expect("parse settings");
        assert_eq!(settings.model_id, "second");
        assert_eq!(settings.directory, base.join("second"));
        let _ = fs::remove_dir_all(&base);
    }
}
