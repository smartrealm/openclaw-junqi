use crate::{commands::openclaw_cli::OpenClawCliTarget, paths};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, sync::OnceLock, time::Duration};
use tokio::io::{AsyncRead, AsyncReadExt};

const CONFIG_TIMEOUT: Duration = Duration::from_secs(30);
const DOCTOR_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 512 * 1024;
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigValidationEnvelope {
    valid: bool,
    path: Option<String>,
    #[serde(default)]
    issues: Vec<Value>,
    #[serde(default)]
    errors: Vec<Value>,
    #[serde(default)]
    warnings: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DoctorEnvelope {
    ok: bool,
    checks_run: Option<u64>,
    checks_skipped: Option<u64>,
    findings: Vec<Value>,
}

async fn run_json_command(
    target: &OpenClawCliTarget,
    args: &[&str],
    timeout: Duration,
    required_keys: &[&str],
) -> Result<Value, String> {
    let label = args.join(" ");
    let mut command = target.command(args);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run OpenClaw {label}: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("OpenClaw {label} stdout was unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("OpenClaw {label} stderr was unavailable"))?;

    let execution = tokio::time::timeout(timeout, async {
        tokio::try_join!(
            async {
                child
                    .wait()
                    .await
                    .map_err(|error| format!("Failed to wait for OpenClaw {label}: {error}"))
            },
            read_limited(stdout, MAX_STDOUT_BYTES, "stdout"),
            read_limited(stderr, MAX_STDERR_BYTES, "stderr"),
        )
    })
    .await;

    let (status, stdout, _stderr) = match execution {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(format!("OpenClaw {label} {error}"));
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(format!(
                "OpenClaw {label} timed out after {} seconds",
                timeout.as_secs()
            ));
        }
    };

    // Validation commands intentionally use non-zero exit codes when they find issues.
    // The structured payload is authoritative, so parse it regardless of exit status.
    parse_json_object(&stdout, required_keys).map_err(|_| {
        if status.success() {
            format!("OpenClaw {label} returned an invalid JSON response")
        } else {
            format!(
                "OpenClaw {label} failed with exit code {} and no valid JSON response",
                status.code().unwrap_or(-1)
            )
        }
    })
}

async fn read_limited<R>(mut reader: R, limit: usize, stream: &str) -> Result<Vec<u8>, String>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = reader
            .read(&mut chunk)
            .await
            .map_err(|error| format!("{stream} read failed: {error}"))?;
        if read == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(read) > limit {
            return Err(format!("{stream} exceeded the {} byte limit", limit));
        }
        output.extend_from_slice(&chunk[..read]);
    }
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
        "error" | "fatal" | "critical" => "error",
        "warn" | "warning" => "warning",
        "info" | "notice" | "pass" | "passed" | "success" => "info",
        _ => "warning",
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

fn apply_config_payload(report: &mut MaintenanceReport, payload: Value) -> Result<(), String> {
    let payload = serde_json::from_value::<ConfigValidationEnvelope>(payload).map_err(|error| {
        format!("OpenClaw config validate returned an incompatible response: {error}")
    })?;
    report.config_valid = Some(payload.valid);
    report.config_path = payload.path;
    report.findings.extend(
        payload
            .issues
            .iter()
            .filter_map(|item| finding_from_value("config", item, "error")),
    );
    report.findings.extend(
        payload
            .errors
            .iter()
            .filter_map(|item| finding_from_value("config", item, "error")),
    );
    report.findings.extend(
        payload
            .warnings
            .iter()
            .filter_map(|item| finding_from_value("config", item, "warning")),
    );
    if !payload.valid
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
    Ok(())
}

fn apply_doctor_payload(report: &mut MaintenanceReport, payload: Value) -> Result<(), String> {
    let payload = serde_json::from_value::<DoctorEnvelope>(payload)
        .map_err(|error| format!("OpenClaw doctor returned an incompatible response: {error}"))?;
    report.doctor_ok = Some(payload.ok);
    report.checks_run = payload.checks_run;
    report.checks_skipped = payload.checks_skipped;
    report.findings.extend(
        payload
            .findings
            .iter()
            .filter_map(|item| finding_from_value("doctor", item, "warning")),
    );
    Ok(())
}

#[tauri::command]
pub async fn run_maintenance_scan() -> Result<MaintenanceReport, String> {
    let _operation_guard = acquire_operation_guard().await;
    let checked_at_ms = chrono::Utc::now().timestamp_millis();
    if let Err(error) = paths::validate_runtime_mode(paths::active_runtime_mode()) {
        return Ok(MaintenanceReport {
            healthy: false,
            checked_at_ms,
            config_valid: None,
            config_path: Some(paths::active_config_path().display().to_string()),
            doctor_ok: None,
            checks_run: None,
            checks_skipped: None,
            findings: Vec::new(),
            scan_errors: vec![error],
            summary: MaintenanceSummary::default(),
        });
    }
    let target = match crate::commands::openclaw_cli::resolve_active_openclaw_target().await {
        Ok(target) => target,
        Err(error) => {
            return Ok(MaintenanceReport {
                healthy: false,
                checked_at_ms,
                config_valid: None,
                config_path: Some(paths::active_config_path().display().to_string()),
                doctor_ok: None,
                checks_run: None,
                checks_skipped: None,
                findings: Vec::new(),
                scan_errors: vec![error],
                summary: MaintenanceSummary::default(),
            });
        }
    };

    let config_result = run_json_command(
        &target,
        &["config", "validate", "--json"],
        CONFIG_TIMEOUT,
        &["valid"],
    )
    .await;
    let doctor_result = run_json_command(
        &target,
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

    if let Err(error) = config_result.and_then(|payload| apply_config_payload(&mut report, payload))
    {
        report.scan_errors.push(error);
    }

    if let Err(error) = doctor_result.and_then(|payload| apply_doctor_payload(&mut report, payload))
    {
        report.scan_errors.push(error);
    }

    deduplicate(&mut report.findings);
    report.summary = summarize(&report.findings);
    report.healthy = report.scan_errors.is_empty()
        && report.config_valid == Some(true)
        && report.doctor_ok == Some(true)
        && report.summary.errors == 0
        && report.summary.warnings == 0;
    report.checked_at_ms = chrono::Utc::now().timestamp_millis();
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_report() -> MaintenanceReport {
        MaintenanceReport {
            healthy: false,
            checked_at_ms: 0,
            config_valid: None,
            config_path: None,
            doctor_ok: None,
            checks_run: None,
            checks_skipped: None,
            findings: Vec::new(),
            scan_errors: Vec::new(),
            summary: MaintenanceSummary::default(),
        }
    }

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
    fn bug_m01_typed_envelopes_reject_wrong_field_types() {
        let mut report = empty_report();
        let config_error = apply_config_payload(
            &mut report,
            serde_json::json!({"valid": "yes", "issues": []}),
        )
        .unwrap_err();
        assert!(config_error.contains("incompatible response"));
        assert_eq!(report.config_valid, None);

        let doctor_error =
            apply_doctor_payload(&mut report, serde_json::json!({"ok": true, "findings": {}}))
                .unwrap_err();
        assert!(doctor_error.contains("incompatible response"));
        assert_eq!(report.doctor_ok, None);
    }

    #[test]
    fn bug_m02_config_issues_preserve_path_and_message() {
        let mut report = empty_report();
        apply_config_payload(
            &mut report,
            serde_json::json!({
                "valid": false,
                "path": "/tmp/openclaw.json",
                "issues": [{"path": "gateway.port", "message": "Invalid input"}]
            }),
        )
        .unwrap();
        assert_eq!(report.config_valid, Some(false));
        assert_eq!(report.findings.len(), 1);
        assert_eq!(report.findings[0].path.as_deref(), Some("gateway.port"));
        assert_eq!(report.findings[0].message, "Invalid input");
        assert_eq!(report.findings[0].severity, "error");
    }

    #[test]
    fn bug_m07_unknown_severity_fails_closed() {
        assert_eq!(normalize_severity(Some("critical"), "info"), "error");
        assert_eq!(normalize_severity(Some("future-level"), "info"), "warning");
        assert_eq!(normalize_severity(Some("info"), "warning"), "info");
    }

    #[tokio::test]
    async fn bug_m09_output_reader_enforces_byte_limit() {
        let error = read_limited(&b"12345"[..], 4, "stdout").await.unwrap_err();
        assert!(error.contains("exceeded"));
        assert_eq!(
            read_limited(&b"1234"[..], 4, "stdout").await.unwrap(),
            b"1234"
        );
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
