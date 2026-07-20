//! 状态目录能力探测与目录分裂检测。
//!
//! OpenClaw Gateway 启动时会对状态目录执行 chmod(凭据目录收紧为 700/600)。
//! exFAT、网络盘或带权限策略的目录会拒绝该操作,进程在监听端口前就退出,
//! 外层只能看到 60 秒就绪超时。这里用与 OpenClaw 相同的运行时(Node 的
//! fs.chmod)做一次真实探测,把根因在启动前用可行动的提示暴露出来。

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::paths;
use crate::platform;

/// 探测脚本:在状态目录里建临时文件,chmod 收紧后用 stat 验证真实生效,
/// 再恢复并清理。只输出机器可判定的标记,退出码区分失败类别:
/// 2 = chmod/文件操作被拒绝;3 = chmod 调用成功但未生效(静默无效)。
const CHMOD_PROBE_SCRIPT: &str = r#"
const fs = require('fs');
const path = require('path');
const dir = process.argv[1];
let probeDir;
try {
  probeDir = fs.mkdtempSync(path.join(dir, '.junqi-chmod-probe-'));
  const file = path.join(probeDir, 'probe');
  fs.writeFileSync(file, 'p');
  fs.chmodSync(file, 0o400);
  const lockedWritable = (fs.statSync(file).mode & 0o200) !== 0;
  fs.chmodSync(file, 0o600);
  const restoredWritable = (fs.statSync(file).mode & 0o200) !== 0;
  fs.chmodSync(probeDir, 0o700);
  if (lockedWritable || !restoredWritable) {
    console.error('JUNQI_CHMOD_PROBE:INEFFECTIVE');
    process.exitCode = 3;
  } else {
    console.log('JUNQI_CHMOD_PROBE:OK');
  }
} catch (err) {
  const code = (err && err.code) || 'UNKNOWN';
  const message = (err && err.message) || String(err);
  console.error('JUNQI_CHMOD_PROBE:ERROR:' + code + ':' + message);
  process.exitCode = 2;
} finally {
  if (probeDir) {
    try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch {}
  }
}
"#;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ChmodProbeOutcome {
    /// chmod 调用成功且 stat 验证生效。
    Supported,
    /// 明确证据表明该目录不支持所需的权限调整(拒绝或静默无效)。
    Unsupported(String),
    /// 探测本身没有跑成(Node 启动失败、超时等),不能据此下结论。
    Inconclusive(String),
}

/// 只有拿到明确证据才阻塞启动;探测自身故障必须走 Inconclusive,
/// 由原有的就绪检测兜底,避免探测缺陷反而卡死健康环境。
pub(crate) fn classify_probe_output(
    exit_code: Option<i32>,
    stdout: &str,
    stderr: &str,
) -> ChmodProbeOutcome {
    match exit_code {
        Some(0) if stdout.contains("JUNQI_CHMOD_PROBE:OK") => ChmodProbeOutcome::Supported,
        Some(2) => {
            let detail = stderr
                .lines()
                .find_map(|line| line.strip_prefix("JUNQI_CHMOD_PROBE:ERROR:"))
                .unwrap_or(stderr)
                .trim()
                .to_string();
            ChmodProbeOutcome::Unsupported(detail)
        }
        Some(3) => ChmodProbeOutcome::Unsupported(
            "chmod succeeded but had no effect on this filesystem".to_string(),
        ),
        other => ChmodProbeOutcome::Inconclusive(format!(
            "probe did not produce a verdict (exit={:?}, stdout={}, stderr={})",
            other,
            stdout.trim(),
            stderr.trim(),
        )),
    }
}

/// 面向用户的可行动提示。产品当前主要面向中文用户,与向导文案保持一致。
pub(crate) fn chmod_unsupported_message(state_dir: &Path, detail: &str) -> String {
    let mut message = format!(
        "该数据目录不支持 OpenClaw 所需的权限调整(chmod),Gateway 无法在此目录运行:{}。\
         请在存储设置中将 OpenClaw 数据迁移到本地 NTFS/APFS 目录(例如用户主目录下的 .openclaw)后重试。",
        state_dir.display()
    );
    if !detail.is_empty() {
        message.push_str(&format!(" [probe: {}]", detail));
    }
    message
}

/// 用选定的 Node 运行时对状态目录做真实 chmod 探测。
pub(crate) async fn probe_chmod_capability(node: &Path, state_dir: &Path) -> ChmodProbeOutcome {
    if let Err(error) = std::fs::create_dir_all(state_dir) {
        return ChmodProbeOutcome::Unsupported(format!(
            "state directory cannot be created: {error}"
        ));
    }
    let mut command = tokio::process::Command::new(node);
    command
        .arg("-e")
        .arg(CHMOD_PROBE_SCRIPT)
        // Windows verbatim (`\\?\`) paths break Node's fs handling; use the
        // same normalization as every other Node invocation in this app.
        .arg(crate::commands::system::path_for_node_argument(state_dir))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    match tokio::time::timeout(Duration::from_secs(20), command.output()).await {
        Ok(Ok(output)) => classify_probe_output(
            output.status.code(),
            &String::from_utf8_lossy(&output.stdout),
            &String::from_utf8_lossy(&output.stderr),
        ),
        Ok(Err(error)) => {
            ChmodProbeOutcome::Inconclusive(format!("probe process failed to run: {error}"))
        }
        Err(_) => ChmodProbeOutcome::Inconclusive("probe timed out after 20s".to_string()),
    }
}

// ── 状态目录分裂检测 ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateDirSplit {
    /// 选定目录与系统默认目录不同,且默认目录也存在一份 OpenClaw 配置。
    pub split: bool,
    pub active_dir: String,
    pub default_dir: String,
    pub default_has_config: bool,
}

pub(crate) fn evaluate_state_dir_split(
    active_dir: &Path,
    default_dir: &Path,
    default_config_exists: bool,
) -> StateDirSplit {
    let same = paths::paths_refer_to_same_location(active_dir, default_dir);
    StateDirSplit {
        split: !same && default_config_exists,
        active_dir: active_dir.display().to_string(),
        default_dir: default_dir.display().to_string(),
        default_has_config: default_config_exists,
    }
}

/// 检测选定状态目录与系统默认目录(`~/.openclaw`)是否分裂。外部安装的
/// openclaw 命令、计划任务或系统服务在没有环境变量时读取默认目录;当两边
/// 各有一份配置时会互相不一致,必须提示用户统一。
#[tauri::command]
pub async fn detect_state_dir_split() -> Result<StateDirSplit, String> {
    let active_dir = paths::desktop_dir();
    let default_dir = paths::legacy_default_state_dir();
    let default_config_exists = default_dir.join("openclaw.json").is_file();
    Ok(evaluate_state_dir_split(
        &active_dir,
        &default_dir,
        default_config_exists,
    ))
}

/// 在 Gateway 启动前解析出可用于探测的 Node 可执行文件路径。
pub(crate) fn probe_node_path(node: &crate::commands::system::NodeStatus) -> Option<PathBuf> {
    node.path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_script_verifies_effect_and_cleans_up() {
        assert!(CHMOD_PROBE_SCRIPT.contains("chmodSync(file, 0o400)"));
        assert!(CHMOD_PROBE_SCRIPT.contains("statSync(file).mode & 0o200"));
        assert!(CHMOD_PROBE_SCRIPT.contains("JUNQI_CHMOD_PROBE:INEFFECTIVE"));
        assert!(CHMOD_PROBE_SCRIPT.contains("rmSync(probeDir, { recursive: true, force: true })"));
    }

    #[test]
    fn ok_output_is_supported() {
        assert_eq!(
            classify_probe_output(Some(0), "JUNQI_CHMOD_PROBE:OK\n", ""),
            ChmodProbeOutcome::Supported,
        );
    }

    #[test]
    fn rejected_chmod_is_unsupported_with_detail() {
        let outcome = classify_probe_output(
            Some(2),
            "",
            "JUNQI_CHMOD_PROBE:ERROR:EPERM:operation not permitted, chmod 'F:\\probe'\n",
        );
        match outcome {
            ChmodProbeOutcome::Unsupported(detail) => {
                assert!(detail.contains("EPERM"));
                assert!(detail.contains("chmod"));
            }
            other => panic!("expected Unsupported, got {:?}", other),
        }
    }

    #[test]
    fn silent_noop_chmod_is_unsupported() {
        assert!(matches!(
            classify_probe_output(Some(3), "", "JUNQI_CHMOD_PROBE:INEFFECTIVE\n"),
            ChmodProbeOutcome::Unsupported(_),
        ));
    }

    #[test]
    fn probe_infrastructure_failures_are_inconclusive() {
        assert!(matches!(
            classify_probe_output(None, "", ""),
            ChmodProbeOutcome::Inconclusive(_),
        ));
        assert!(matches!(
            classify_probe_output(Some(1), "SyntaxError", ""),
            ChmodProbeOutcome::Inconclusive(_),
        ));
        // exit 0 但没有 OK 标记(例如脚本被截断)不能当作支持。
        assert!(matches!(
            classify_probe_output(Some(0), "", ""),
            ChmodProbeOutcome::Inconclusive(_),
        ));
    }

    #[test]
    fn unsupported_message_is_actionable_and_names_the_directory() {
        let message = chmod_unsupported_message(Path::new("F:/Tools/AI/OpenClaw/state"), "EPERM");
        assert!(message.contains("F:/Tools/AI/OpenClaw/state"));
        assert!(message.contains("chmod"));
        assert!(message.contains("迁移"));
        assert!(message.contains("[probe: EPERM]"));
    }

    #[test]
    fn split_requires_both_directories_diverging_and_default_config() {
        let split = evaluate_state_dir_split(
            Path::new("/data/openclaw-state"),
            Path::new("/home/user/.openclaw"),
            true,
        );
        assert!(split.split);
        assert!(split.default_has_config);

        let no_default_config = evaluate_state_dir_split(
            Path::new("/data/openclaw-state"),
            Path::new("/home/user/.openclaw"),
            false,
        );
        assert!(!no_default_config.split);

        let same_dir = evaluate_state_dir_split(
            Path::new("/home/user/.openclaw"),
            Path::new("/home/user/.openclaw"),
            true,
        );
        assert!(!same_dir.split);
    }
}
