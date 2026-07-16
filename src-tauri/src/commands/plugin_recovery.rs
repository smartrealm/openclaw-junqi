//! Broken-plugin recovery for Gateway startup failures (BUG-CPI-07).
//!
//! OpenClaw's post-core payload smoke check refuses to start the Gateway when
//! an enabled plugin is damaged (e.g. its declared main entry is missing), but
//! none of the CLI's structured commands surface that failure today
//! (`plugins list/inspect/doctor` all load the package root and report
//! "loaded"). This module locates the culprit without hardcoding plugin names
//! or matching human-readable prose:
//!
//! - **Channel A (hint)**: plugin ids quoted as `Plugin "<id>"` in the gateway
//!   failure text. Hints are never acted on alone — they must cross-validate
//!   against the structured plugin list.
//! - **Channel B (authoritative)**: a file-level replica of the smoke check.
//!   For every enabled plugin from `plugins list --json`, the package must
//!   ship the main entry its own `package.json` declares. Pure filesystem
//!   reads, independent of any error wording.
//!
//! Recovery is a ladder with a decidable re-check after every rung:
//! `plugins update <id>` → `plugins install <spec> --force` → report
//! not-healable so the UI can offer a temporary `plugins disable <id>`.
//! An upstream package that ships without its declared entry (observed with
//! `@larksuite/openclaw-lark@2026.7.9`) fails both heal rungs and must be
//! disabled until its author publishes a fixed release.
//!
//! A second damage class exists (2026-07-16 drill): when a plugin's
//! *registered extension entry* itself is missing, OpenClaw marks the whole
//! config invalid and locks every `plugins ...` subcommand — including
//! `update repair`, so JunQi's generic repair path cannot recover it either.
//! Two whitelisted commands still run in that state and cover it:
//! - **Detection fallback**: `config validate --json` reports the culprit as
//!   a structured `issues[].path` of the form `plugins.entries.<id>`.
//! - **Rung 0**: `doctor --fix` fully self-heals this class (re-downloads
//!   the payload into a fresh generation and restores a valid config).

use crate::commands::openclaw_cli::{
    output_error, parse_cli_json, run_openclaw, validate_cli_identifier,
};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

const LIST_TIMEOUT: Duration = Duration::from_secs(60);
const INSPECT_TIMEOUT: Duration = Duration::from_secs(60);
/// Update/reinstall reach the npm registry; align with repair-scale timeouts.
const HEAL_TIMEOUT: Duration = Duration::from_secs(240);
const DISABLE_TIMEOUT: Duration = Duration::from_secs(60);
/// `doctor --fix` runs config recovery plus plugin payload repair (network).
const DOCTOR_TIMEOUT: Duration = Duration::from_secs(360);

const CONFIG_PLUGIN_ENTRY_PREFIX: &str = "plugins.entries.";
const GATEWAY_SMOKE_CHECK_REASON: &str = "gateway-smoke-check";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrokenPlugin {
    pub id: String,
    pub version: Option<String>,
    /// Machine-readable cause: "missing-main-entry" | "plugin-error"
    /// | "gateway-smoke-check".
    pub reason: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginHealOutcome {
    pub id: String,
    pub healed: bool,
    pub attempted: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PluginEntry {
    id: String,
    version: Option<String>,
    enabled: bool,
    root_dir: Option<String>,
    error: Option<String>,
}

fn entry_text(entry: &Value, key: &str) -> Option<String> {
    entry
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn parse_plugin_entries(payload: &Value) -> Vec<PluginEntry> {
    payload
        .get("plugins")
        .and_then(Value::as_array)
        .map(|plugins| {
            plugins
                .iter()
                .filter_map(|entry| {
                    Some(PluginEntry {
                        id: entry_text(entry, "id")?,
                        version: entry_text(entry, "version"),
                        enabled: entry
                            .get("enabled")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        root_dir: entry_text(entry, "rootDir"),
                        error: entry_text(entry, "error"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Channel B: the package must ship the main entry its `package.json`
/// declares. Returns the declared entry when it is missing on disk. This is
/// the file-level subset of OpenClaw's post-core payload smoke check; it is
/// deliberately conservative — a package without a `main` field is not judged.
fn missing_main_entry(root_dir: &Path) -> Option<String> {
    let manifest = std::fs::read_to_string(root_dir.join("package.json")).ok()?;
    let manifest: Value = serde_json::from_str(&manifest).ok()?;
    let main = manifest.get("main")?.as_str()?.trim();
    if main.is_empty() {
        return None;
    }
    if root_dir.join(main).is_file() {
        None
    } else {
        Some(main.to_string())
    }
}

/// Channel A: plugin ids quoted as `Plugin "<id>"` in gateway failure text.
/// Case-insensitive on the keyword, exact on the id. Extraction is only a
/// hint; callers must cross-validate ids against the structured plugin list.
fn plugin_id_hints(error: &str) -> Vec<String> {
    let mut hints = Vec::new();
    let lower = error.to_lowercase();
    let mut cursor = 0;
    while let Some(found) = lower[cursor..].find("plugin \"") {
        let start = cursor + found + "plugin \"".len();
        let Some(len) = error[start..].find('"') else {
            break;
        };
        let id = error[start..start + len].trim();
        if !id.is_empty() && !hints.iter().any(|existing| existing == id) {
            hints.push(id.to_string());
        }
        cursor = start + len + 1;
    }
    hints
}

/// npm package specs (`@scope/name@version`) exceed the strict CLI identifier
/// charset, so they get their own conservative validation before being passed
/// as a single argv entry to `plugins install`.
fn is_valid_npm_spec(spec: &str) -> bool {
    !spec.is_empty()
        && spec.len() <= 214
        && spec
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric() || character == '@')
        && !spec.starts_with("--")
        && spec
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "@/._-".contains(character))
        && !spec.contains("..")
}

async fn structured_plugin_entries() -> Result<Vec<PluginEntry>, String> {
    let output = run_openclaw(&["plugins", "list", "--json"], None, LIST_TIMEOUT).await?;
    // Non-zero exits can still carry the payload (config warnings); the
    // structured JSON is authoritative when present.
    let payload =
        parse_cli_json(&output).map_err(|_| output_error("plugins list --json", &output))?;
    Ok(parse_plugin_entries(&payload))
}

/// Extract broken-plugin findings from `config validate --json` issue paths.
/// The `plugins.entries.<id>` path is a structured field emitted by OpenClaw's
/// own validator — no prose matching is involved.
fn plugin_issues_from_config_validation(payload: &Value) -> Vec<BrokenPlugin> {
    if payload.get("valid").and_then(Value::as_bool) == Some(true) {
        return Vec::new();
    }
    let mut broken: Vec<BrokenPlugin> = Vec::new();
    for issue in payload
        .get("issues")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
    {
        let Some(id) = issue
            .get("path")
            .and_then(Value::as_str)
            .and_then(|path| path.strip_prefix(CONFIG_PLUGIN_ENTRY_PREFIX))
            .map(str::trim)
            .filter(|id| !id.is_empty())
        else {
            continue;
        };
        if broken.iter().any(|existing| existing.id == id) {
            continue;
        }
        broken.push(BrokenPlugin {
            id: id.to_string(),
            version: None,
            reason: "config-entry-invalid".to_string(),
            detail: issue
                .get("message")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        });
    }
    broken
}

/// Detection fallback for the invalid-config damage class, where
/// `plugins list --json` itself is locked. `config validate --json` is one of
/// OpenClaw's documented always-available commands.
async fn config_validation_plugin_issues() -> Result<Vec<BrokenPlugin>, String> {
    let output = run_openclaw(&["config", "validate", "--json"], None, LIST_TIMEOUT).await?;
    let payload =
        parse_cli_json(&output).map_err(|_| output_error("config validate --json", &output))?;
    Ok(plugin_issues_from_config_validation(&payload))
}

fn diagnose_entries(entries: &[PluginEntry], hints: &[String]) -> Vec<BrokenPlugin> {
    let mut broken = Vec::new();
    for entry in entries.iter().filter(|entry| entry.enabled) {
        if let Some(error) = &entry.error {
            broken.push(BrokenPlugin {
                id: entry.id.clone(),
                version: entry.version.clone(),
                reason: "plugin-error".to_string(),
                detail: Some(error.clone()),
            });
            continue;
        }
        if let Some(root_dir) = &entry.root_dir {
            if let Some(main) = missing_main_entry(Path::new(root_dir)) {
                broken.push(BrokenPlugin {
                    id: entry.id.clone(),
                    version: entry.version.clone(),
                    reason: "missing-main-entry".to_string(),
                    detail: Some(format!("declared main entry {main} is missing")),
                });
                continue;
            }
        }
        // A hint alone means the gateway smoke check rejected this plugin for
        // a cause our file-level replica cannot see. The id is trusted only
        // because it matched a real enabled plugin from the structured list.
        if hints.iter().any(|hint| hint == &entry.id) {
            broken.push(BrokenPlugin {
                id: entry.id.clone(),
                version: entry.version.clone(),
                reason: GATEWAY_SMOKE_CHECK_REASON.to_string(),
                detail: None,
            });
        }
    }
    broken
}

/// Locate enabled plugins that would fail the Gateway's payload smoke check.
/// `error` is the optional gateway failure text used for Channel A hints.
/// Docker runtimes keep plugin payloads inside the container where the image
/// refresh repair path already covers them, so they report no host findings.
#[tauri::command]
pub async fn list_broken_gateway_plugins(
    error: Option<String>,
) -> Result<Vec<BrokenPlugin>, String> {
    if !matches!(
        crate::paths::active_runtime_mode(),
        crate::paths::OpenClawRuntimeMode::Native
    ) {
        return Ok(Vec::new());
    }
    let entries = match structured_plugin_entries().await {
        Ok(entries) => entries,
        // A missing registered extension entry invalidates the whole config
        // and locks `plugins list`; fall back to the validator's structured
        // issue paths so this damage class is still located.
        Err(_) => return config_validation_plugin_issues().await,
    };
    let hints = error.as_deref().map(plugin_id_hints).unwrap_or_default();
    Ok(diagnose_entries(&entries, &hints))
}

async fn plugin_is_still_broken(id: &str) -> Result<bool, String> {
    let entries = match structured_plugin_entries().await {
        Ok(entries) => entries,
        // Invalid-config state: the plugin is broken exactly when the
        // validator still names it in a structured issue path.
        Err(_) => {
            let issues = config_validation_plugin_issues().await?;
            return Ok(issues.iter().any(|issue| issue.id == id));
        }
    };
    for entry in entries {
        if entry.id == id {
            if entry.error.is_some() {
                return Ok(true);
            }
            if let Some(root_dir) = &entry.root_dir {
                return Ok(missing_main_entry(Path::new(root_dir)).is_some());
            }
            return Ok(false);
        }
    }
    // The plugin disappeared from the structured list: healing cannot be
    // confirmed, so fail closed and let the caller degrade to disable.
    Ok(true)
}

async fn plugin_install_spec(id: &str) -> Option<String> {
    let output = run_openclaw(&["plugins", "inspect", id, "--json"], None, INSPECT_TIMEOUT)
        .await
        .ok()?;
    let payload = parse_cli_json(&output).ok()?;
    let install = payload.get("install")?;
    install
        .get("resolvedSpec")
        .or_else(|| install.get("spec"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|spec| !spec.is_empty())
        .map(ToOwned::to_owned)
}

/// Whether a finding's failure cause can be re-observed by this module's own
/// re-checks. A `gateway-smoke-check` finding exists precisely because the
/// file-level replica could NOT see the failure, so a clean file-level
/// re-check proves nothing about it — claiming `healed` from that re-check
/// would let a no-op `plugins update` masquerade as a fix and trap the user
/// in a repair→fail loop that never reaches the disable exit.
fn is_verifiable_reason(reason: Option<&str>) -> bool {
    reason != Some(GATEWAY_SMOKE_CHECK_REASON)
}

/// Run the self-heal ladder for one plugin. Every rung ends with a decidable
/// re-check (Channel B against the refreshed plugin list), so the outcome is
/// observed rather than assumed and the ladder can never loop. `reason` is
/// the detection finding's cause: for causes our re-checks cannot observe,
/// `healed` is conservatively false and real verification is delegated to a
/// controlled Gateway start by the caller.
#[tauri::command]
pub async fn heal_openclaw_plugin(
    id: String,
    reason: Option<String>,
) -> Result<PluginHealOutcome, String> {
    validate_cli_identifier(&id, "plugin id")?;
    let verifiable = is_verifiable_reason(reason.as_deref());
    let _guard = crate::commands::maintenance::acquire_operation_guard().await;
    let mut attempted = Vec::new();
    let mut last_error: Option<String> = None;

    // Rung 0: invalid-config damage class. Every `plugins ...` subcommand
    // (and `update repair`) is locked in this state; `doctor --fix` is the
    // whitelisted remedy and fully re-downloads the payload (verified in the
    // 2026-07-16 drill). Skipped entirely when the plugin list is readable.
    if structured_plugin_entries().await.is_err() {
        attempted.push("doctor-fix".to_string());
        match run_openclaw(&["doctor", "--fix"], None, DOCTOR_TIMEOUT).await {
            Ok(output) if output.success => {}
            Ok(output) => last_error = Some(output_error("doctor --fix", &output)),
            Err(error) => last_error = Some(error),
        }
        if verifiable && !plugin_is_still_broken(&id).await? {
            return Ok(PluginHealOutcome {
                id,
                healed: true,
                attempted,
                error: None,
            });
        }
        // Still locked: the remaining rungs cannot run, so report honestly.
        if structured_plugin_entries().await.is_err() {
            return Ok(PluginHealOutcome {
                id,
                healed: false,
                attempted,
                error: last_error,
            });
        }
    }

    // Rung 1: targeted update. Skips silently when the registry version
    // matches, which cannot repair a damaged payload — hence the re-check.
    attempted.push("update".to_string());
    match run_openclaw(&["plugins", "update", &id], None, HEAL_TIMEOUT).await {
        Ok(output) if output.success => {}
        Ok(output) => last_error = Some(output_error("plugins update", &output)),
        Err(error) => last_error = Some(error),
    }
    if verifiable && !plugin_is_still_broken(&id).await? {
        return Ok(PluginHealOutcome {
            id,
            healed: true,
            attempted,
            error: None,
        });
    }

    // Rung 2: forced reinstall from the tracked npm spec. Re-downloads the
    // payload, which heals local corruption but not an upstream package that
    // was published without its declared files.
    if let Some(spec) = plugin_install_spec(&id).await {
        if is_valid_npm_spec(&spec) {
            attempted.push("reinstall".to_string());
            match run_openclaw(
                &["plugins", "install", &spec, "--force"],
                None,
                HEAL_TIMEOUT,
            )
            .await
            {
                Ok(output) if output.success => {}
                Ok(output) => last_error = Some(output_error("plugins install", &output)),
                Err(error) => last_error = Some(error),
            }
            if verifiable && !plugin_is_still_broken(&id).await? {
                return Ok(PluginHealOutcome {
                    id,
                    healed: true,
                    attempted,
                    error: None,
                });
            }
        }
    }

    Ok(PluginHealOutcome {
        id,
        healed: false,
        attempted,
        error: last_error,
    })
}

/// Last rung: temporarily disable the plugin so the Gateway can start. The
/// plugin stays installed and can be re-enabled from settings once a fixed
/// release exists.
#[tauri::command]
pub async fn disable_openclaw_plugin(id: String) -> Result<(), String> {
    validate_cli_identifier(&id, "plugin id")?;
    let _guard = crate::commands::maintenance::acquire_operation_guard().await;
    let output = run_openclaw(&["plugins", "disable", &id], None, DISABLE_TIMEOUT).await?;
    if output.success {
        Ok(())
    } else {
        Err(output_error("plugins disable", &output))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_plugin_dir(main: Option<&str>, ship_main: bool) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "junqi-plugin-recovery-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let manifest = match main {
            Some(main) => format!(r#"{{"name":"x","version":"1.0.0","main":"{main}"}}"#),
            None => r#"{"name":"x","version":"1.0.0"}"#.to_string(),
        };
        std::fs::write(root.join("package.json"), manifest).unwrap();
        if ship_main {
            if let Some(main) = main {
                let entry = root.join(main);
                std::fs::create_dir_all(entry.parent().unwrap()).unwrap();
                std::fs::write(entry, "module.exports = {}").unwrap();
            }
        }
        root
    }

    #[test]
    fn missing_main_entry_replicates_the_gateway_smoke_check_verdicts() {
        let broken = temp_plugin_dir(Some("./dist/index.js"), false);
        assert_eq!(
            missing_main_entry(&broken),
            Some("./dist/index.js".to_string())
        );
        let healthy = temp_plugin_dir(Some("./dist/index.js"), true);
        assert_eq!(missing_main_entry(&healthy), None);
        let no_main = temp_plugin_dir(None, false);
        assert_eq!(missing_main_entry(&no_main), None);
        for dir in [broken, healthy, no_main] {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn hints_extract_quoted_plugin_ids_without_matching_prose() {
        let error = "Plugin \"openclaw-lark\" failed post-core payload smoke check \
                     (missing-main-entry): Plugin main entry \"./dist/index.js\" not found";
        assert_eq!(plugin_id_hints(error), vec!["openclaw-lark".to_string()]);
        assert!(plugin_id_hints("Gateway process exited before becoming ready").is_empty());
        assert_eq!(
            plugin_id_hints("plugin \"a\" broke; Plugin \"a\" broke again; plugin \"b\" too"),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    fn diagnosis_is_structured_and_cross_validated() {
        let broken_dir = temp_plugin_dir(Some("./dist/index.js"), false);
        let entries = vec![
            PluginEntry {
                id: "damaged".to_string(),
                version: Some("1.0.0".to_string()),
                enabled: true,
                root_dir: Some(broken_dir.to_string_lossy().to_string()),
                error: None,
            },
            PluginEntry {
                id: "disabled-damaged".to_string(),
                version: None,
                enabled: false,
                root_dir: Some(broken_dir.to_string_lossy().to_string()),
                error: None,
            },
            PluginEntry {
                id: "errored".to_string(),
                version: None,
                enabled: true,
                root_dir: None,
                error: Some("failed to load".to_string()),
            },
            PluginEntry {
                id: "hinted".to_string(),
                version: None,
                enabled: true,
                root_dir: None,
                error: None,
            },
        ];
        // A hint that matches no enabled plugin id must be ignored.
        let hints = vec!["hinted".to_string(), "ghost-plugin".to_string()];
        let broken = diagnose_entries(&entries, &hints);
        let reasons: Vec<(&str, &str)> = broken
            .iter()
            .map(|plugin| (plugin.id.as_str(), plugin.reason.as_str()))
            .collect();
        assert_eq!(
            reasons,
            vec![
                ("damaged", "missing-main-entry"),
                ("errored", "plugin-error"),
                ("hinted", "gateway-smoke-check"),
            ]
        );
        let _ = std::fs::remove_dir_all(broken_dir);
    }

    #[test]
    fn plugin_entries_parse_from_the_documented_list_payload() {
        let payload: Value = serde_json::from_str(
            r#"{
                "registry": {},
                "plugins": [
                    {"id": "a", "version": "1.2.3", "enabled": true,
                     "rootDir": "/tmp/a", "error": null},
                    {"id": "b", "enabled": false},
                    {"notAnId": true}
                ],
                "diagnostics": []
            }"#,
        )
        .unwrap();
        let entries = parse_plugin_entries(&payload);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "a");
        assert_eq!(entries[0].version.as_deref(), Some("1.2.3"));
        assert!(entries[0].enabled);
        assert_eq!(entries[0].root_dir.as_deref(), Some("/tmp/a"));
        assert!(!entries[1].enabled);
    }

    #[test]
    fn gateway_smoke_check_findings_are_never_verifiable_by_file_level_rechecks() {
        // The finding exists precisely because the file-level replica saw
        // nothing wrong, so a clean re-check must not be credited as a fix.
        assert!(!is_verifiable_reason(Some("gateway-smoke-check")));
        assert!(is_verifiable_reason(Some("missing-main-entry")));
        assert!(is_verifiable_reason(Some("plugin-error")));
        assert!(is_verifiable_reason(Some("config-entry-invalid")));
        assert!(is_verifiable_reason(None));
    }

    #[test]
    fn config_validation_issues_locate_plugins_by_structured_path_only() {
        // Shape observed live on 2026-07-16 with a missing extension entry.
        let payload: Value = serde_json::from_str(
            r#"{
                "valid": false,
                "path": "/tmp/openclaw.json",
                "issues": [
                    {"path": "plugins.entries.dingtalk-connector",
                     "message": "plugin dingtalk-connector: extension entry not found: dist/index.mjs"},
                    {"path": "plugins.entries.dingtalk-connector",
                     "message": "duplicate finding is deduplicated"},
                    {"path": "plugins.allow",
                     "message": "plugin not found: dingtalk-connector"},
                    {"path": "agents.defaults.model",
                     "message": "unrelated issue"}
                ]
            }"#,
        )
        .unwrap();
        let broken = plugin_issues_from_config_validation(&payload);
        assert_eq!(broken.len(), 1);
        assert_eq!(broken[0].id, "dingtalk-connector");
        assert_eq!(broken[0].reason, "config-entry-invalid");
        assert!(broken[0]
            .detail
            .as_deref()
            .unwrap()
            .contains("dist/index.mjs"));

        let valid: Value = serde_json::from_str(r#"{"valid": true, "issues": []}"#).unwrap();
        assert!(plugin_issues_from_config_validation(&valid).is_empty());
    }

    #[test]
    fn npm_specs_are_validated_before_reaching_argv() {
        assert!(is_valid_npm_spec("@larksuite/openclaw-lark@2026.7.9"));
        assert!(is_valid_npm_spec("openclaw-lark"));
        assert!(!is_valid_npm_spec("--force"));
        assert!(!is_valid_npm_spec("../../etc/passwd"));
        assert!(!is_valid_npm_spec("pkg; rm -rf /"));
        assert!(!is_valid_npm_spec(""));
    }

    #[test]
    fn gateway_smoke_check_reason_is_not_claimed_verifiable() {
        assert!(!is_verifiable_reason(Some(GATEWAY_SMOKE_CHECK_REASON)));
        assert!(is_verifiable_reason(Some("missing-main-entry")));
        assert!(is_verifiable_reason(None));
    }
}
