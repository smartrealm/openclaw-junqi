use crate::{commands::gateway::resolve_openclaw_binary, commands::system, paths, platform};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, path::Path, process::Stdio, sync::OnceLock, time::Duration};

const CONFIG_TIMEOUT: Duration = Duration::from_secs(30);
const DOCTOR_TIMEOUT: Duration = Duration::from_secs(120);
static MAINTENANCE_OPERATION: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

pub async fn acquire_operation_guard() -> tokio::sync::MutexGuard<'static, ()> {
    MAINTENANCE_OPERATION
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceFinding {
    pub source: String,
    pub category: String,
    pub severity: String,
    pub check_id: Option<String>,
    pub message: String,
    pub path: Option<String>,
    pub requirement: Option<String>,
    pub fix_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceSummary {
    pub errors: usize,
    pub warnings: usize,
    pub info: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceReport {
    pub healthy: bool,
    pub checked_at_ms: i64,
    pub config_valid: Option<bool>,
    pub config_path: Option<String>,
    pub doctor_ok: Option<bool>,
    pub checks_run: Option<u64>,
    pub checks_skipped: Option<u64>,
    pub findings: Vec<MaintenanceFinding>,
    pub scan_errors: Vec<String>,
    pub summary: MaintenanceSummary,
}

fn build_command(binary: &Path, args: &[&str]) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(binary);
    command
        .args(args)
        .env("PATH", system::openclaw_search_path())
        .env("OPENCLAW_STATE_DIR", paths::desktop_dir())
        .env("OPENCLAW_CONFIG_PATH", paths::config_path())
        .env("OPENCLAW_NO_RESPAWN", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    command
}

async fn run_json_command(
    binary: &Path,
    args: &[&str],
    timeout: Duration,
    required_keys: &[&str],
) -> Result<Value, String> {
    let label = args.join(" ");
    let mut command = build_command(binary, args);
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| {
            format!(
                "OpenClaw {label} timed out after {} seconds",
                timeout.as_secs()
            )
        })?
        .map_err(|error| format!("Failed to run OpenClaw {label}: {error}"))?;

    // Validation commands intentionally use non-zero exit codes when they find issues.
    // The structured payload is authoritative, so parse it regardless of exit status.
    parse_json_object(&output.stdout, required_keys).map_err(|_| {
        if output.status.success() {
            format!("OpenClaw {label} returned an invalid JSON response")
        } else {
            format!(
                "OpenClaw {label} failed with exit code {} and no valid JSON response",
                output.status.code().unwrap_or(-1)
            )
        }
    })
}

fn has_required_keys(value: &Value, required_keys: &[&str]) -> bool {
    required_keys.iter().all(|key| value.get(*key).is_some())
}

fn parse_json_object(output: &[u8], required_keys: &[&str]) -> Result<Value, ()> {
    let text = String::from_utf8_lossy(output);
    if let Ok(value @ Value::Object(_)) = serde_json::from_str::<Value>(text.trim()) {
        if has_required_keys(&value, required_keys) {
            return Ok(value);
        }
    }

    // Some OpenClaw/plugin versions print warnings before the JSON payload.
    for (start, ch) in text.char_indices().rev() {
        if ch != '{' {
            continue;
        }
        let mut deserializer = serde_json::Deserializer::from_str(&text[start..]);
        if let Ok(value @ Value::Object(_)) = Value::deserialize(&mut deserializer) {
            if has_required_keys(&value, required_keys) {
                return Ok(value);
            }
        }
    }
    Err(())
}

fn optional_text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_severity(value: Option<&str>, fallback: &str) -> String {
    match value.unwrap_or(fallback).to_ascii_lowercase().as_str() {
        "error" | "fatal" => "error",
        "warn" | "warning" => "warning",
        _ => "info",
    }
    .to_string()
}

fn classify(source: &str, check_id: Option<&str>, path: Option<&str>, message: &str) -> String {
    let haystack = format!(
        "{} {} {} {}",
        source,
        check_id.unwrap_or_default(),
        path.unwrap_or_default(),
        message
    )
    .to_ascii_lowercase();
    if haystack.contains("security") || haystack.contains("secret") {
        "security"
    } else if haystack.contains("plugin") {
        "plugin"
    } else if haystack.contains("mcp") {
        "mcp"
    } else if haystack.contains("gateway") {
        "gateway"
    } else if source == "config" {
        "config"
    } else {
        "doctor"
    }
    .to_string()
}

fn finding_from_value(
    source: &str,
    value: &Value,
    fallback_severity: &str,
) -> Option<MaintenanceFinding> {
    let message = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| optional_text(value, "message"))
        .or_else(|| optional_text(value, "error"))?;
    let check_id = optional_text(value, "checkId");
    let path = optional_text(value, "path");
    Some(MaintenanceFinding {
        source: source.to_string(),
        category: classify(source, check_id.as_deref(), path.as_deref(), &message),
        severity: normalize_severity(
            value.get("severity").and_then(Value::as_str),
            fallback_severity,
        ),
        check_id,
        message,
        path,
        requirement: optional_text(value, "requirement"),
        fix_hint: optional_text(value, "fixHint"),
    })
}

fn collect_array_findings(
    payload: &Value,
    field: &str,
    source: &str,
    fallback_severity: &str,
    findings: &mut Vec<MaintenanceFinding>,
) {
    if let Some(items) = payload.get(field).and_then(Value::as_array) {
        findings.extend(
            items
                .iter()
                .filter_map(|item| finding_from_value(source, item, fallback_severity)),
        );
    }
}

fn deduplicate(findings: &mut Vec<MaintenanceFinding>) {
    let mut seen = HashSet::new();
    findings.retain(|finding| {
        seen.insert((
            finding.source.clone(),
            finding.severity.clone(),
            finding.check_id.clone(),
            finding.message.clone(),
            finding.path.clone(),
            finding.requirement.clone(),
            finding.fix_hint.clone(),
        ))
    });
}

fn summarize(findings: &[MaintenanceFinding]) -> MaintenanceSummary {
    let mut summary = MaintenanceSummary::default();
    for finding in findings {
        match finding.severity.as_str() {
            "error" => summary.errors += 1,
            "warning" => summary.warnings += 1,
            _ => summary.info += 1,
        }
    }
    summary
}

#[tauri::command]
pub async fn run_maintenance_scan() -> Result<MaintenanceReport, String> {
    let _operation_guard = acquire_operation_guard().await;
    let checked_at_ms = chrono::Utc::now().timestamp_millis();
    let Some(binary) = resolve_openclaw_binary() else {
        return Ok(MaintenanceReport {
            healthy: false,
            checked_at_ms,
            config_valid: None,
            config_path: Some(paths::config_path().display().to_string()),
            doctor_ok: None,
            checks_run: None,
            checks_skipped: None,
            findings: Vec::new(),
            scan_errors: vec!["OpenClaw executable was not found".to_string()],
            summary: MaintenanceSummary::default(),
        });
    };

    let config_result = run_json_command(
        &binary,
        &["config", "validate", "--json"],
        CONFIG_TIMEOUT,
        &["valid"],
    )
    .await;
    let doctor_result = run_json_command(
        &binary,
        &["doctor", "--lint", "--json"],
        DOCTOR_TIMEOUT,
        &["ok", "findings"],
    )
    .await;

    let mut report = MaintenanceReport {
        healthy: false,
        checked_at_ms,
        config_valid: None,
        config_path: None,
        doctor_ok: None,
        checks_run: None,
        checks_skipped: None,
        findings: Vec::new(),
        scan_errors: Vec::new(),
        summary: MaintenanceSummary::default(),
    };

    match config_result {
        Ok(payload) => {
            report.config_valid = payload.get("valid").and_then(Value::as_bool);
            report.config_path = optional_text(&payload, "path");
            collect_array_findings(&payload, "errors", "config", "error", &mut report.findings);
            collect_array_findings(
                &payload,
                "warnings",
                "config",
                "warning",
                &mut report.findings,
            );
            if report.config_valid == Some(false)
                && !report
                    .findings
                    .iter()
                    .any(|finding| finding.source == "config")
            {
                report.findings.push(MaintenanceFinding {
                    source: "config".to_string(),
                    category: "config".to_string(),
                    severity: "error".to_string(),
                    check_id: None,
                    message: "OpenClaw configuration is invalid".to_string(),
                    path: report.config_path.clone(),
                    requirement: None,
                    fix_hint: None,
                });
            }
        }
        Err(error) => report.scan_errors.push(error),
    }

    match doctor_result {
        Ok(payload) => {
            report.doctor_ok = payload.get("ok").and_then(Value::as_bool);
            report.checks_run = payload.get("checksRun").and_then(Value::as_u64);
            report.checks_skipped = payload.get("checksSkipped").and_then(Value::as_u64);
            collect_array_findings(
                &payload,
                "findings",
                "doctor",
                "warning",
                &mut report.findings,
            );
        }
        Err(error) => report.scan_errors.push(error),
    }

    deduplicate(&mut report.findings);
    report.summary = summarize(&report.findings);
    report.healthy = report.scan_errors.is_empty()
        && report.config_valid != Some(false)
        && report.doctor_ok != Some(false)
        && report.summary.errors == 0
        && report.summary.warnings == 0;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_after_noisy_prefix() {
        let value = parse_json_object(
            b"plugin warning\n{\"valid\":true,\"warnings\":[]}",
            &["valid"],
        )
        .unwrap();
        assert_eq!(value.get("valid").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn noisy_json_parser_does_not_return_a_nested_finding() {
        let value = parse_json_object(
            b"warning\n{\"ok\":false,\"findings\":[{\"message\":\"nested\"}]}",
            &["ok", "findings"],
        )
        .unwrap();
        assert_eq!(value.get("ok").and_then(Value::as_bool), Some(false));
    }

    #[test]
    fn classifies_duplicate_plugin_id_from_structured_config_warning() {
        let value = serde_json::json!({
            "path": "plugins.entries.openclaw-lark",
            "message": "duplicate plugin id detected"
        });
        let finding = finding_from_value("config", &value, "warning").unwrap();
        assert_eq!(finding.category, "plugin");
        assert_eq!(finding.severity, "warning");
    }

    #[test]
    fn duplicate_doctor_findings_are_collapsed() {
        let finding = MaintenanceFinding {
            source: "doctor".into(),
            category: "mcp".into(),
            severity: "error".into(),
            check_id: Some("runtime-tool-schemas".into()),
            message: "MCP server failed".into(),
            path: Some("mcp.servers.demo".into()),
            requirement: None,
            fix_hint: Some("Disable the server".into()),
        };
        let mut findings = vec![finding.clone(), finding];
        deduplicate(&mut findings);
        assert_eq!(findings.len(), 1);
    }
}
