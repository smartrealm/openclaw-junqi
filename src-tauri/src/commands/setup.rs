use crate::commands::npm_registry;
use crate::paths;
use crate::platform;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, OnceLock,
};
use tauri::Emitter;

static OPENCLAW_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

struct TemporaryDirectory(PathBuf);

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// ─── Platform helpers ──────────────────────────────────────────────────────────

#[cfg(windows)]
pub fn refresh_path_from_registry() {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winreg::enums::*;
    use winreg::RegKey;

    let mut parts: Vec<String> = Vec::new();
    if let Ok(env) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
    {
        if let Ok(val) = env.get_raw_value("Path") {
            let wide: Vec<u16> = val
                .bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let s = OsString::from_wide(&wide);
            if let Some(s) = s.to_str() {
                parts.extend(s.trim_end_matches('\0').split(';').map(|p| p.to_string()));
            }
        }
    }
    if let Ok(env) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
        if let Ok(val) = env.get_raw_value("Path") {
            let wide: Vec<u16> = val
                .bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let s = OsString::from_wide(&wide);
            if let Some(s) = s.to_str() {
                parts.extend(s.trim_end_matches('\0').split(';').map(|p| p.to_string()));
            }
        }
    }
    if !parts.is_empty() {
        std::env::set_var("PATH", parts.join(";"));
    }
}

#[cfg(windows)]
pub fn find_git_in_default_paths() -> Option<PathBuf> {
    let candidates = [
        r"C:\Program Files\Git\cmd\git.exe",
        r"C:\Program Files (x86)\Git\cmd\git.exe",
    ];
    for p in &candidates {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

// ─── Progress event ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SetupProgress {
    pub step: String,
    pub message: String,
    /// Optional i18n key. When present, the frontend uses it to localize
    /// the message; falls back to the raw `message` field otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub progress: Option<f64>,
    pub error: Option<String>,
}

fn emit(app: &tauri::AppHandle, step: &str, message: &str, progress: f64) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            step: step.into(),
            message: message.into(),
            key: None,
            progress: Some(progress.clamp(0.0, 1.0)),
            error: None,
        },
    );
}

/// Emit a progress event tagged with an i18n key. Frontend renders the
/// localized copy when the key resolves; otherwise falls back to `message`.
fn emit_keyed(app: &tauri::AppHandle, step: &str, message: &str, key: &str, progress: f64) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            step: step.into(),
            message: message.into(),
            key: Some(key.into()),
            progress: Some(progress.clamp(0.0, 1.0)),
            error: None,
        },
    );
}

// ─── Download sources ──────────────────────────────────────────────────────────

const NODE_VERSION: &str = "24.14.0";
const GIT_WIN_VERSION: &str = "2.47.1";

fn node_filename() -> String {
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    if cfg!(windows) {
        format!("node-v{}-win-{}.zip", NODE_VERSION, arch)
    } else if cfg!(target_os = "macos") {
        format!("node-v{}-darwin-{}.tar.gz", NODE_VERSION, arch)
    } else {
        format!("node-v{}-linux-{}.tar.gz", NODE_VERSION, arch)
    }
}

/// (url, display_label) pairs — CN mirror first, official fallback.
fn node_sources() -> Vec<(String, &'static str)> {
    let f = node_filename();
    vec![
        (
            format!("https://npmmirror.com/mirrors/node/v{}/{}", NODE_VERSION, f),
            "npmmirror.com（国内）",
        ),
        (
            format!("https://nodejs.org/dist/v{}/{}", NODE_VERSION, f),
            "nodejs.org（官方）",
        ),
    ]
}

fn git_win_filename() -> String {
    format!("Git-{}-64-bit.exe", GIT_WIN_VERSION)
}

fn git_win_sources() -> Vec<(String, &'static str)> {
    let f = git_win_filename();
    vec![
        (
            format!(
                "https://registry.npmmirror.com/-/binary/git-for-windows/v{}.windows.1/{}",
                GIT_WIN_VERSION, f
            ),
            "npmmirror.com（国内）",
        ),
        (
            format!(
                "https://github.com/git-for-windows/git/releases/download/v{}.windows.1/{}",
                GIT_WIN_VERSION, f
            ),
            "GitHub（官方）",
        ),
    ]
}

// ─── Download helper ───────────────────────────────────────────────────────────

/// Download a file from the first reachable source.
/// Progress events are emitted every ~2 percentage points during streaming.
/// Returns number of bytes written on success.
async fn download_with_fallback(
    app: &tauri::AppHandle,
    step: &str,
    sources: &[(String, &'static str)],
    dest: &PathBuf,
    prog_start: f64,
    prog_end: f64,
) -> Result<u64, String> {
    let mut last_err = "unknown error".to_string();
    let total_sources = sources.len();

    for (idx, (url, label)) in sources.iter().enumerate() {
        emit(
            app,
            step,
            &format!(
                "【下载 {}/{}】正在连接 {}...",
                idx + 1,
                total_sources,
                label
            ),
            prog_start,
        );

        let resp = match reqwest::get(url.as_str()).await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                last_err = format!("HTTP {}", r.status());
                let next_hint = if idx + 1 < total_sources {
                    "，切换备用源..."
                } else {
                    ""
                };
                emit(
                    app,
                    step,
                    &format!("{} 返回错误 ({}){}", label, last_err, next_hint),
                    prog_start,
                );
                continue;
            }
            Err(e) => {
                last_err = e.to_string();
                let next_hint = if idx + 1 < total_sources {
                    "，切换备用源..."
                } else {
                    ""
                };
                emit(
                    app,
                    step,
                    &format!("{} 无法连接{}", label, next_hint),
                    prog_start,
                );
                continue;
            }
        };

        let total_bytes = resp.content_length().unwrap_or(0);
        let size_str = if total_bytes > 0 {
            format!("{:.1} MB", total_bytes as f64 / 1024.0 / 1024.0)
        } else {
            "大小未知".into()
        };

        emit(
            app,
            step,
            &format!("Connected to {}, size {}, downloading...", label, size_str),
            prog_start,
        );

        let mut downloaded: u64 = 0;
        let mut last_reported_pct: u64 = 0;
        let mut data: Vec<u8> = Vec::with_capacity(total_bytes as usize);
        let mut resp = resp;
        let mut download_ok = true;

        loop {
            match resp.chunk().await {
                Ok(Some(chunk)) => {
                    downloaded += chunk.len() as u64;
                    data.extend_from_slice(&chunk);

                    if total_bytes > 0 {
                        let pct = downloaded * 100 / total_bytes;
                        if pct >= last_reported_pct + 2 {
                            last_reported_pct = pct;
                            let frac = downloaded as f64 / total_bytes as f64;
                            let prog = prog_start + frac * (prog_end - prog_start);
                            emit(
                                app,
                                step,
                                &format!(
                                    "下载中 {}%（{:.1}/{} MB）via {}",
                                    pct,
                                    downloaded as f64 / 1024.0 / 1024.0,
                                    size_str,
                                    label,
                                ),
                                prog,
                            );
                        }
                    } else {
                        // Unknown total: emit every ~2 MB
                        let mb = downloaded / (2 * 1024 * 1024);
                        if mb > last_reported_pct {
                            last_reported_pct = mb;
                            emit(
                                app,
                                step,
                                &format!(
                                    "Downloading... got {:.1} MB via {}",
                                    downloaded as f64 / 1024.0 / 1024.0,
                                    label
                                ),
                                prog_start + 0.1,
                            );
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    last_err = format!("传输中断: {}", e);
                    download_ok = false;
                    break;
                }
            }
        }

        if !download_ok || data.is_empty() {
            if idx + 1 < total_sources {
                emit(
                    app,
                    step,
                    "Download failed, switching to fallback source...",
                    prog_start,
                );
            }
            continue;
        }

        std::fs::write(dest, &data).map_err(|e| format!("写入文件失败: {}", e))?;

        emit(
            app,
            step,
            &format!(
                "Download complete ({:.1} MB), source: {}",
                downloaded as f64 / 1024.0 / 1024.0,
                label
            ),
            prog_end,
        );
        return Ok(downloaded);
    }

    Err(format!("所有下载源均失败。最后错误：{}", last_err))
}

// ─── Extraction helpers ────────────────────────────────────────────────────────

fn extract_zip(
    app: &tauri::AppHandle,
    step: &str,
    archive: &PathBuf,
    dest: &PathBuf,
    prog_start: f64,
    prog_end: f64,
) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("读取 zip 失败: {}", e))?;
    let total = zip.len();
    emit(
        app,
        step,
        &format!("Extracting, {} files total...", total),
        prog_start,
    );

    for i in 0..total {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        // Strip top-level directory (node-vX.X.X-win-x64/)
        let parts: Vec<&str> = name.splitn(2, '/').collect();
        if parts.len() < 2 || parts[1].is_empty() {
            continue;
        }
        let outpath = dest.join(parts[1]);
        if entry.is_dir() {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(p) = outpath.parent() {
                std::fs::create_dir_all(p).ok();
            }
            let mut out = std::fs::File::create(&outpath)
                .map_err(|e| format!("创建 {} 失败: {}", outpath.display(), e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("解压 {} 失败: {}", parts[1], e))?;
        }
        if i % 200 == 0 && total > 0 {
            let frac = i as f64 / total as f64;
            emit(
                app,
                step,
                &format!("Extracting {}% ({}/{})...", (frac * 100.0) as u32, i, total),
                prog_start + frac * (prog_end - prog_start),
            );
        }
    }
    Ok(())
}

fn extract_targz(
    app: &tauri::AppHandle,
    step: &str,
    archive: &PathBuf,
    dest: &PathBuf,
    prog_start: f64,
    prog_end: f64,
) -> Result<(), String> {
    emit(app, step, "Extracting tar.gz archive...", prog_start);
    let file = std::fs::File::open(archive).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);
    let mut count: usize = 0;

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.to_path_buf();
        let components: Vec<_> = path.components().collect();
        if components.len() < 2 {
            continue;
        }
        // Strip top-level dir (node-vX.X.X-darwin-arm64/)
        let relative: PathBuf = components[1..].iter().collect();
        let outpath = dest.join(&relative);

        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(p) = outpath.parent() {
                std::fs::create_dir_all(p).ok();
            }
            entry
                .unpack(&outpath)
                .map_err(|e| format!("解压 {} 失败: {}", relative.display(), e))?;
        }
        count += 1;
        if count % 200 == 0 {
            // tar.gz doesn't know total entry count upfront; show a count instead
            let prog = (prog_start + (prog_end - prog_start) * 0.5).min(prog_end - 0.05);
            emit(
                app,
                step,
                &format!("Extracting... processed {} files", count),
                prog,
            );
        }
    }
    emit(
        app,
        step,
        &format!("Extraction complete, {} files processed", count),
        prog_end,
    );
    Ok(())
}

// ─── npm install with registry fallback ───────────────────────────────────────

/// Run `npm install -g <pkg>` against a user-writable global prefix with
/// live output streaming. The registry order is selected from verified package
/// metadata and current network latency, then returns Ok on first success.
///
/// We deliberately use `-g` plus an `npm_config_prefix` env var rather than
/// `npm install --prefix <dir>`: `--prefix` is the project-local install
/// flag and produces non-standard bin layouts that diverge from a normal
/// global install. `-g` gives us the real global layout
/// (`<prefix>/bin/openclaw`, `<prefix>/lib/node_modules/openclaw/...`) and
/// respects whatever the user already has on `PATH` via `detect_openclaw`.
async fn npm_install_with_fallback(
    app: &tauri::AppHandle,
    step: &str,
    node_cmd: &str,
    npm_cli: Option<&str>,
    global_prefix: &std::path::Path,
    pkg: &str,
    prog_start: f64,
    prog_end: f64,
) -> Result<(), String> {
    let node_bin_dir = paths::node_bin_dir();
    let git_bin_dir = paths::git_bin_dir();
    let node_bin_str = node_bin_dir.to_string_lossy().to_string();
    let git_bin_str = if git_bin_dir.exists() {
        Some(git_bin_dir.to_string_lossy().to_string())
    } else {
        None
    };
    let path_env = platform::build_path(&node_bin_str, git_bin_str.as_deref());
    let install_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    // A fresh cache avoids npm repeatedly reusing a partially extracted tarball
    // after an interrupted Windows install. It is removed when this call ends.
    let npm_cache_root =
        paths::npm_cache_dir().join(format!("install-{}-{}", std::process::id(), install_nonce));
    let _npm_cache_cleanup = TemporaryDirectory(npm_cache_root.clone());
    std::fs::create_dir_all(&npm_cache_root).ok();
    std::fs::create_dir_all(global_prefix).ok();
    let staging_prefix = global_prefix.join(format!(
        ".junqi-openclaw-stage-{}-{}",
        std::process::id(),
        install_nonce
    ));
    let install_prefix = if cfg!(windows) {
        staging_prefix.as_path()
    } else {
        global_prefix
    };
    let _staging_cleanup = cfg!(windows).then(|| TemporaryDirectory(staging_prefix.clone()));
    // `npm i -g` creates `<prefix>/bin` and `<prefix>/lib/node_modules`
    // itself; pre-creating the prefix dir avoids races on first run.
    let npm_prefix_str = install_prefix.to_string_lossy().to_string();

    let registries = npm_registry::select_npm_registry().await.candidates();
    let mut last_err = String::new();
    let total_regs = registries.len();

    for (reg_idx, registry) in registries.into_iter().enumerate() {
        if cfg!(windows) {
            let _ = std::fs::remove_dir_all(&staging_prefix);
            std::fs::create_dir_all(&staging_prefix).map_err(|error| {
                format!(
                    "Cannot prepare the isolated OpenClaw installer at {}: {}",
                    staging_prefix.display(),
                    error
                )
            })?;
        }
        // A failed source must not poison the fallback source with partially
        // extracted cache entries.
        let npm_cache = npm_cache_root.join(format!("registry-{}", reg_idx + 1));
        std::fs::create_dir_all(&npm_cache).ok();
        let reg_label = registry.label();
        emit(
            app,
            step,
            &format!(
                "【安装 {}/{}】使用 {} 安装 {}...",
                reg_idx + 1,
                total_regs,
                reg_label,
                pkg
            ),
            prog_start,
        );

        let mut cmd = if let Some(cli) = npm_cli {
            let mut c = tokio::process::Command::new(node_cmd);
            c.arg(cli);
            c
        } else {
            tokio::process::Command::new(platform::bin_name("npm"))
        };

        cmd.args([
            "install",
            "-g",
            "--prefer-online",
            "--no-fund",
            "--no-audit",
            pkg,
        ])
        .env("PATH", &path_env)
        .env("npm_config_prefix", &npm_prefix_str)
        .env("npm_config_cache", &npm_cache)
        // This is deliberately process-scoped. Do not alter user or global npmrc.
        .env("npm_config_registry", registry.url)
        .env("NPM_CONFIG_REGISTRY", registry.url)
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "url.https://github.com/.insteadOf")
        .env("GIT_CONFIG_VALUE_0", "ssh://git@github.com/")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
        platform::configure_background_command(&mut cmd);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                last_err = format!("Failed to spawn npm: {}", e);
                continue;
            }
        };

        // Stream stdout to progress events so the user sees live npm output
        let prog_live = prog_start + (prog_end - prog_start) * 0.4;
        if let Some(stdout) = child.stdout.take() {
            let app_c = app.clone();
            let step_c = step.to_string();
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = line.trim().to_string();
                    if line.is_empty() || line.starts_with("npm notice") {
                        continue;
                    }
                    emit(&app_c, &step_c, &format!("npm › {}", line), prog_live);
                }
            });
        }
        let tar_warning_count = Arc::new(AtomicUsize::new(0));
        if let Some(stderr) = child.stderr.take() {
            let app_e = app.clone();
            let step_e = step.to_string();
            let tar_warning_count_e = Arc::clone(&tar_warning_count);
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = line.trim().to_string();
                    if line.is_empty() || line.starts_with("npm notice") {
                        continue;
                    }
                    if line.contains("TAR_ENTRY_ERROR") && line.contains("ENOENT") {
                        let seen = tar_warning_count_e.fetch_add(1, Ordering::Relaxed);
                        // Preserve the first diagnostic but avoid flooding the
                        // setup UI with hundreds of identical npm warnings.
                        if seen > 0 {
                            continue;
                        }
                    }
                    emit(&app_e, &step_e, &format!("npm › {}", line), prog_live);
                }
            });
        }

        let status =
            match tokio::time::timeout(std::time::Duration::from_secs(360), child.wait()).await {
                Ok(Ok(s)) => s,
                Ok(Err(e)) => {
                    last_err = format!("npm process error: {}", e);
                    if reg_idx + 1 < total_regs {
                        emit(
                            app,
                            step,
                            &format!(
                                "{} install errored, retrying with fallback source...",
                                reg_label
                            ),
                            prog_start,
                        );
                    }
                    continue;
                }
                Err(_) => {
                    last_err = "npm install timed out (>6 min)".into();
                    if reg_idx + 1 < total_regs {
                        emit(
                            app,
                            step,
                            &format!(
                                "{} install timed out, retrying with fallback source...",
                                reg_label
                            ),
                            prog_start,
                        );
                    }
                    continue;
                }
            };

        if status.success() {
            let tar_warnings = tar_warning_count.load(Ordering::Relaxed);
            if tar_warnings > 1 {
                emit(
                    app,
                    step,
                    &format!(
                        "npm reported {} duplicate extraction warnings; installation validation will confirm integrity",
                        tar_warnings
                    ),
                    prog_live,
                );
            }
            if cfg!(windows) {
                validate_staged_openclaw_install(&staging_prefix)?;
                promote_staged_openclaw_install(&staging_prefix, global_prefix).await?;
            }
            emit(
                app,
                step,
                &format!("{} installed (via {}) ✓", pkg, reg_label),
                prog_end,
            );
            return Ok(());
        }

        last_err = format!("npm 退出码 {}", status.code().unwrap_or(-1));
        if reg_idx + 1 < total_regs {
            emit(
                app,
                step,
                &format!(
                    "{} install failed ({}), retrying with fallback source...",
                    reg_label, last_err
                ),
                prog_start,
            );
        }
    }

    Err(format!(
        "All npm registries failed. Last error: {}",
        last_err
    ))
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn install_node(app: tauri::AppHandle) -> Result<String, String> {
    let step = "node";
    let node_dir = paths::desktop_dir().join("node");
    let node_bin = paths::local_node_path();

    // ① 检测现有版本
    emit_keyed(
        &app,
        step,
        "Checking installed Node.js version...",
        "setup.node.check",
        0.02,
    );

    if node_bin.exists() {
        let version_str = tokio::process::Command::new(&node_bin)
            .arg("--version")
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                } else {
                    None
                }
            });

        let needs_upgrade = match &version_str {
            Some(v) => {
                let parts: Vec<u32> = v
                    .trim_start_matches('v')
                    .split('.')
                    .filter_map(|s| s.parse().ok())
                    .collect();
                parts.len() < 3 || (parts[0], parts[1], parts[2]) < (24, 14, 0)
            }
            None => true,
        };

        if !needs_upgrade {
            let ver = version_str.unwrap_or_default();
            emit_keyed(
                &app,
                step,
                &format!("Node.js {} meets requirement (>= v24.14.0), skipping", ver),
                "setup.node.skip",
                1.0,
            );
            return Ok(format!("Node.js {} already installed", ver));
        }

        let ver = version_str.unwrap_or_else(|| "older version".into());
        emit_keyed(
            &app,
            step,
            &format!("Detected {} below v24.14.0, cleaning up...", ver),
            "setup.node.upgrade",
            0.04,
        );
        let _ = std::fs::remove_dir_all(&node_dir);
    }

    // ② Download (CN mirror first, official fallback)
    emit_keyed(
        &app,
        step,
        &format!(
            "Preparing to download Node.js v{}, prefer CN mirror...",
            NODE_VERSION
        ),
        "setup.node.prepareDownload",
        0.05,
    );
    let temp_dir = paths::desktop_dir().join("tmp");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let archive_path = temp_dir.join(node_filename());

    download_with_fallback(&app, step, &node_sources(), &archive_path, 0.06, 0.60).await?;

    // ③ Extract
    std::fs::create_dir_all(&node_dir).map_err(|e| format!("Failed to create node dir: {}", e))?;
    emit_keyed(
        &app,
        step,
        &format!("Extracting to {}...", node_dir.display()),
        "setup.node.extract",
        0.62,
    );

    if cfg!(windows) {
        extract_zip(&app, step, &archive_path, &node_dir, 0.62, 0.90)?;
    } else {
        extract_targz(&app, step, &archive_path, &node_dir, 0.62, 0.90)?;
    }

    // ④ Cleanup
    emit_keyed(
        &app,
        step,
        "Cleaning up temp files...",
        "setup.node.cleanup",
        0.92,
    );
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&temp_dir);

    // ⑤ Verify
    emit_keyed(
        &app,
        step,
        "Verifying installation...",
        "setup.node.verify",
        0.96,
    );
    let ver = tokio::process::Command::new(&node_bin)
        .arg("--version")
        .output()
        .await
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unknown version".into());

    emit_keyed(
        &app,
        step,
        &format!("Node.js {} installed successfully ✓", ver),
        "setup.node.done",
        1.0,
    );
    Ok(format!("Node.js {} installed successfully", ver))
}

#[tauri::command]
pub async fn install_git(app: tauri::AppHandle) -> Result<String, String> {
    let step = "git";

    // ① Detect
    emit_keyed(
        &app,
        step,
        "Checking Git installation...",
        "setup.git.check",
        0.02,
    );
    let local_git = paths::local_git_path();
    let system_git = platform::bin_name("git");

    if local_git.exists()
        || tokio::process::Command::new(&system_git)
            .arg("--version")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
    {
        emit_keyed(
            &app,
            step,
            "Git already installed, skipping",
            "setup.git.skip",
            1.0,
        );
        return Ok("Git already installed".into());
    }

    if cfg!(windows) {
        // ── Windows：下载安装包（CN 源优先，GitHub 兜底）──────────────────

        emit(
            &app,
            step,
            &format!(
                "准备下载 Git for Windows v{}，优先使用国内镜像源...",
                GIT_WIN_VERSION
            ),
            0.04,
        );

        let temp_dir = paths::desktop_dir().join("tmp");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temp dir: {}", e))?;
        let installer_path = temp_dir.join(git_win_filename());

        download_with_fallback(&app, step, &git_win_sources(), &installer_path, 0.05, 0.50).await?;

        // 启动安装向导
        emit_keyed(
            &app,
            step,
            "Download complete, launching Git installer wizard...",
            "setup.git.launchWizard",
            0.52,
        );
        let mut child = tokio::process::Command::new(&installer_path)
            .spawn()
            .map_err(|e| format!("Failed to launch Git installer: {}", e))?;

        // 等待用户完成向导（最多 15 分钟）
        let mut elapsed_secs: u64 = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            elapsed_secs += 5;
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    let mins = elapsed_secs / 60;
                    let secs = elapsed_secs % 60;
                    let pct = (0.52 + (elapsed_secs as f64 / 900.0) * 0.35).min(0.87);
                    emit_keyed(
                        &app,
                        step,
                        &format!(
                            "Waiting for installer wizard... elapsed {:02}:{:02}",
                            mins, secs
                        ),
                        "setup.git.waitingWizard",
                        pct,
                    );
                    if elapsed_secs > 900 {
                        return Err(
                            "Timed out (15 min) waiting for Git installer, please retry".into()
                        );
                    }
                }
                Err(e) => return Err(format!("Installer process error: {}", e)),
            }
        }

        // 清理安装包
        let _ = std::fs::remove_file(&installer_path);
        let _ = std::fs::remove_dir_all(&temp_dir);

        // 刷新 PATH 并验证
        emit_keyed(
            &app,
            step,
            "Wizard finished, refreshing system PATH...",
            "setup.git.refreshPath",
            0.90,
        );
        #[cfg(windows)]
        refresh_path_from_registry();

        emit_keyed(
            &app,
            step,
            "Verifying git is usable...",
            "setup.git.verify",
            0.94,
        );

        #[allow(unused_mut)]
        let mut git_ok = tokio::process::Command::new("git.exe")
            .arg("--version")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);

        #[cfg(windows)]
        if !git_ok {
            if let Some(git_path) = find_git_in_default_paths() {
                git_ok = tokio::process::Command::new(&git_path)
                    .arg("--version")
                    .output()
                    .await
                    .map(|o| o.status.success())
                    .unwrap_or(false);
            }
        }

        if git_ok {
            emit_keyed(
                &app,
                step,
                "Git installed successfully ✓",
                "setup.git.done",
                1.0,
            );
            return Ok("Git installed successfully".into());
        }

        Err("Git installer wizard finished, but git was not detected. Please restart the app or manually add Git to PATH.".into())
    } else {
        emit_keyed(
            &app,
            step,
            "Git is not available. Please install Apple Command Line Tools manually, then retry.",
            "setup.git.manualRequired",
            1.0,
        );
        Err("Git is required. Install Apple Command Line Tools manually, then retry JunQi.".into())
    }
}

/// Pick the directory we hand to `npm install -g` for the openclaw install.
///
/// Order of preference:
/// 1. The user's `npm config get prefix` from the local node's npm. This
///    matches what `npm i -g openclaw` from the user's terminal would
///    resolve to — same bin, same `package.json`, same place the user
///    can then manage with `npm i -g openclaw@latest`.
/// 2. Whatever is hard-coded in `~/.npmrc` (`prefix=...`).
/// 3. Fall back to the JunQi-managed sandbox at
///    `paths::openclaw_global_dir()` if neither is writable, so the
///    install never silently fails.
async fn pick_install_target(app: &tauri::AppHandle, step: &str) -> PathBuf {
    let node_bin = paths::local_node_path();
    let npm_cli = paths::local_npm_cli_path();
    let mut cmd = if node_bin.exists() && npm_cli.exists() {
        let mut c = tokio::process::Command::new(&node_bin);
        c.arg(&npm_cli);
        c
    } else {
        tokio::process::Command::new(platform::bin_name("npm"))
    };
    cmd.args(["config", "get", "prefix"])
        .env(
            "PATH",
            platform::build_path(&paths::node_bin_dir().to_string_lossy(), None),
        )
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let prefix_from_npm = match cmd.output().await {
        Ok(out) if out.status.success() => {
            let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if raw.is_empty() {
                None
            } else {
                Some(PathBuf::from(raw))
            }
        }
        _ => None,
    };
    let user_prefix = prefix_from_npm.or_else(paths::user_npm_prefix);
    if let Some(prefix) = user_prefix {
        if try_use_prefix(&prefix) {
            emit_keyed(
                app,
                step,
                &format!(
                    "Detected npm prefix {} (matches your `npm i -g`); installing openclaw there",
                    prefix.display()
                ),
                "setup.openclaw.userNpmPrefix",
                0.075,
            );
            return prefix;
        }
        // User's npm prefix exists but isn't writable (typical case:
        // default `prefix=/usr/local` from a Homebrew/apt/Stock-Windows
        // install). Fall through to the XDG tier.
    }

    // Tier 2: XDG Base Directory fallback at `~/.local`. User-owned on
    // every platform we ship to, so `npm install -g` always lands and
    // the bin ends up in a place the user can put on PATH.
    let local = paths::local_npm_prefix();
    if try_use_prefix(&local) {
        let bin = paths::local_npm_bin_dir();
        emit_keyed(
            app,
            step,
            &format!(
                "User npm prefix not writable; using XDG fallback {} (add {} to your PATH to use openclaw from terminal)",
                local.display(),
                bin.display()
            ),
            "setup.openclaw.localNpmPrefix",
            0.075,
        );
        return local;
    }

    // Tier 3: JunQi-managed sandbox. Always reachable because it
    // lives under `~/.openclaw/` which is owned by whoever runs the
    // app. Caller will surface the path so the user can still run
    // `openclaw` from JunQi even if their terminal can't find it.
    // We announce the resolved sandbox path through
    // `setup.openclaw.sandboxNpmPrefix` so the frontend can surface a
    // dedicated install-location card just like tiers 1/2.
    let sandbox = paths::openclaw_global_dir();
    emit_keyed(
        app,
        step,
        &format!(
            "User npm prefix and ~/.local both unwritable; using JunQi sandbox {}",
            sandbox.display()
        ),
        "setup.openclaw.sandboxNpmPrefix",
        0.075,
    );
    sandbox
}

/// Decide whether `path` is a usable install target. Returns true when
/// the directory exists (or can be created) AND we can write a probe
/// file into it. `false` means the caller should fall through to the
/// next fallback tier.
fn try_use_prefix(path: &std::path::Path) -> bool {
    if !path.exists() {
        if std::fs::create_dir_all(path).is_err() {
            return false;
        }
    }
    // Probe-write into the dir itself. Use a per-process unique name
    // so concurrent installs can't collide on the probe file.
    let probe = path.join(format!(
        ".junqi-write-probe-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn openclaw_node_modules_dir(prefix: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        prefix.join("node_modules")
    } else {
        prefix.join("lib").join("node_modules")
    }
}

fn validate_staged_openclaw_install(prefix: &std::path::Path) -> Result<(), String> {
    let package_dir = openclaw_node_modules_dir(prefix).join("openclaw");
    let package_json = package_dir.join("package.json");
    let launcher = prefix.join("openclaw.cmd");
    if package_json.is_file() && launcher.is_file() {
        return Ok(());
    }
    Err(format!(
        "npm finished but the isolated OpenClaw install is incomplete at {}",
        prefix.display()
    ))
}

async fn promote_staged_openclaw_install(
    staging_prefix: &std::path::Path,
    target_prefix: &std::path::Path,
) -> Result<(), String> {
    let staged_package = openclaw_node_modules_dir(staging_prefix).join("openclaw");
    let target_node_modules = openclaw_node_modules_dir(target_prefix);
    let target_package = target_node_modules.join("openclaw");
    let backup_package =
        target_node_modules.join(format!(".junqi-openclaw-backup-{}", std::process::id()));
    let mut last_error = String::new();

    for attempt in 0..6 {
        std::fs::create_dir_all(&target_node_modules).map_err(|error| {
            format!(
                "Cannot prepare the OpenClaw package directory {}: {}",
                target_node_modules.display(),
                error
            )
        })?;
        let _ = std::fs::remove_dir_all(&backup_package);

        let had_existing_package = target_package.exists();
        if had_existing_package {
            if let Err(error) = std::fs::rename(&target_package, &backup_package) {
                last_error = format!(
                    "Cannot move the current OpenClaw installation because it is in use: {}",
                    error
                );
                if attempt < 5 {
                    tokio::time::sleep(std::time::Duration::from_millis(250 * (attempt + 1))).await;
                }
                continue;
            }
        }

        match std::fs::rename(&staged_package, &target_package) {
            Ok(()) => {
                for shim in ["openclaw", "openclaw.cmd", "openclaw.ps1"] {
                    let source = staging_prefix.join(shim);
                    if source.is_file() {
                        std::fs::copy(&source, target_prefix.join(shim)).map_err(|error| {
                            format!("Cannot install the OpenClaw launcher {}: {}", shim, error)
                        })?;
                    }
                }
                let _ = std::fs::remove_dir_all(&backup_package);
                return Ok(());
            }
            Err(error) => {
                last_error = format!(
                    "Cannot activate the staged OpenClaw package at {}: {}",
                    target_package.display(),
                    error
                );
                if had_existing_package {
                    let _ = std::fs::rename(&backup_package, &target_package);
                }
            }
        }

        if attempt < 5 {
            tokio::time::sleep(std::time::Duration::from_millis(250 * (attempt + 1))).await;
        }
    }

    Err(format!(
        "OpenClaw was downloaded safely, but its current installation is locked. Close OpenClaw, Gateway, and any antivirus scan using {}, then retry. Last error: {}",
        target_prefix.display(),
        last_error
    ))
}

/// Remove only a broken npm package payload before reinstalling it. User data
/// lives under `~/.openclaw`, outside every npm prefix selected above.
fn remove_broken_openclaw_install(prefix: &std::path::Path) -> Result<(), String> {
    let node_modules = openclaw_node_modules_dir(prefix);
    let package_dir = node_modules.join("openclaw");
    if package_dir.exists() {
        std::fs::remove_dir_all(&package_dir).map_err(|error| {
            format!(
                "Cannot remove the incomplete OpenClaw package at {}: {}. Close running OpenClaw processes and retry.",
                package_dir.display(),
                error
            )
        })?;
    }

    if let Ok(entries) = std::fs::read_dir(&node_modules) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with(".openclaw-") {
                let path = entry.path();
                let result = if path.is_dir() {
                    std::fs::remove_dir_all(&path)
                } else {
                    std::fs::remove_file(&path)
                };
                result.map_err(|error| {
                    format!(
                        "Cannot remove the incomplete npm staging path {}: {}. Close running OpenClaw processes and retry.",
                        path.display(),
                        error
                    )
                })?;
            }
        }
    }

    let shim_dir = if cfg!(windows) {
        prefix.to_path_buf()
    } else {
        prefix.join("bin")
    };
    for shim in ["openclaw", "openclaw.cmd", "openclaw.ps1"] {
        let path = shim_dir.join(shim);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|error| {
                format!(
                    "Cannot remove the stale OpenClaw launcher at {}: {}. Close running OpenClaw processes and retry.",
                    path.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn install_openclaw(app: tauri::AppHandle) -> Result<String, String> {
    let step = "openclaw";
    let install_lock = OPENCLAW_INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _install_guard = install_lock.lock().await;

    emit_keyed(
        &app,
        step,
        "Checking for existing local OpenClaw...",
        "setup.openclaw.checkExisting",
        0.02,
    );
    let existing = crate::commands::system::detect_openclaw().await;
    if existing.installed {
        let detail = match (&existing.version, &existing.path) {
            (Some(version), Some(path)) => {
                format!("Using existing OpenClaw {} at {}", version, path)
            }
            (_, Some(path)) => format!("Using existing OpenClaw at {}", path),
            _ => "Using existing local OpenClaw".to_string(),
        };
        emit_keyed(&app, step, &detail, "setup.openclaw.useExisting", 1.0);
        return Ok(detail);
    }

    emit_keyed(
        &app,
        step,
        "No existing OpenClaw was found; installing a managed local OpenClaw for this computer...",
        "setup.openclaw.firstInstall",
        0.03,
    );

    // ① 定位 Node.js 二进制
    emit_keyed(
        &app,
        step,
        "Locating Node.js executable...",
        "setup.openclaw.locateNode",
        0.05,
    );
    let local_node = paths::local_node_path();
    let node_cmd = if local_node.exists() {
        let path = local_node.to_string_lossy().to_string();
        emit_keyed(
            &app,
            step,
            &format!("Using local Node.js: {}", path),
            "setup.openclaw.useLocalNode",
            0.05,
        );
        path
    } else {
        emit_keyed(
            &app,
            step,
            "Using system Node.js",
            "setup.openclaw.useSystemNode",
            0.05,
        );
        platform::bin_name("node")
    };

    // 检查 npm-cli.js
    let local_npm_cli = paths::local_npm_cli_path();
    let npm_cli = if local_npm_cli.exists() {
        emit_keyed(
            &app,
            step,
            &format!("Using local npm: {}", local_npm_cli.display()),
            "setup.openclaw.useLocalNpm",
            0.07,
        );
        Some(local_npm_cli.to_string_lossy().to_string())
    } else {
        emit_keyed(
            &app,
            step,
            "Using system npm",
            "setup.openclaw.useSystemNpm",
            0.07,
        );
        None
    };

    // ② 准备安装目录 — 装到用户 `~/.npmrc` 里的 npm prefix，这样
    // `~/.npm-global/bin/openclaw` 就是用户从 terminal 跑
    // `npm i -g openclaw` 时拿到的同一个 bin，JunQi 不再搞自己的一套
    // sandbox。如果读不到 `prefix=` 或者目录不可写，就退回到 JunQi 管理的
    // `~/.openclaw/global/`，保证装得上。
    let openclaw_prefix = pick_install_target(&app, step).await;
    emit_keyed(
        &app,
        step,
        &format!("Preparing install target {}...", openclaw_prefix.display()),
        "setup.openclaw.prepareDir",
        0.08,
    );
    std::fs::create_dir_all(&openclaw_prefix).ok();
    if !cfg!(windows) {
        remove_broken_openclaw_install(&openclaw_prefix)?;
    }

    // ③ npm install（CN 源优先，官方兜底，全程输出实时日志）
    emit_keyed(
        &app,
        step,
        "Preferring npmmirror.com (CN) for openclaw install; falls back to npmjs.org (official)...",
        "setup.openclaw.npmInstall",
        0.10,
    );

    npm_install_with_fallback(
        &app,
        step,
        &node_cmd,
        npm_cli.as_deref(),
        &openclaw_prefix,
        "openclaw",
        0.10,
        0.90,
    )
    .await?;

    // ④ 验证
    emit_keyed(
        &app,
        step,
        "Verifying openclaw installation...",
        "setup.openclaw.verify",
        0.92,
    );
    // `npm i -g <prefix>` 写出来的 bin 在 `<prefix>/bin/<name>`，部分
    // 环境下也可能落在 `<prefix>/node_modules/.bin/<name>`，优先前者
    // 后者兜底。`openclaw_prefix` 已经是 `pick_install_target` 选出来的
    // 真实落点（用户 npm prefix 或 JunQi sandbox），不要再回退到硬编码
    // 的 global 目录。
    let mut openclaw_bin = if cfg!(windows) {
        openclaw_prefix.join("openclaw.cmd")
    } else {
        openclaw_prefix
            .join("bin")
            .join(platform::bin_name("openclaw"))
    };
    if !openclaw_bin.exists() {
        let alt_bin = openclaw_prefix
            .join("node_modules")
            .join(".bin")
            .join(platform::bin_name("openclaw"));
        if !alt_bin.exists() {
            return Err("No executable found in openclaw install directory, please retry".into());
        }
        openclaw_bin = alt_bin;
    }

    let search_path = crate::commands::system::openclaw_search_path();
    let verified =
        crate::commands::system::validate_openclaw_binary(&openclaw_bin, &search_path).await;
    if !verified.installed {
        return Err(format!(
            "OpenClaw was installed but failed validation: {}",
            verified
                .error
                .unwrap_or_else(|| "unknown validation error".into())
        ));
    }
    crate::commands::system::persist_selected_openclaw_binary(&openclaw_bin)?;

    emit_keyed(
        &app,
        step,
        "openclaw installed successfully ✓",
        "setup.openclaw.done",
        1.0,
    );
    Ok("OpenClaw installed successfully".into())
}

/// 准备 Gateway — 在 install_openclaw 完成后由前端调用。
///
/// 输出 step="gateway" 的 setup-progress 事件，前端会拿这些 message
/// 当作实时状态文本展示。这一组文案与 "正在准备 OpenClaw Gateway…
/// 检测、连接并同步运行时状态…" 的形态保持一致——逐条细分、可读、
/// 进度平滑推进。
#[tauri::command]
pub async fn prepare_gateway(app: tauri::AppHandle) -> Result<String, String> {
    let step = "gateway";

    // ⓘ Stage 1: detect local runtime
    emit_keyed(
        &app,
        step,
        "Preparing OpenClaw Gateway...",
        "setup.gateway.preparing",
        0.05,
    );
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    emit_keyed(
        &app,
        step,
        "Detecting local runtime (Node.js / npm / openclaw binary)...",
        "setup.gateway.detectRuntime",
        0.12,
    );

    let node_ok = paths::local_node_path().exists();
    let openclaw_status = crate::commands::system::detect_openclaw().await;
    let oclaw_ok = openclaw_status.installed;
    let summary = format!(
        "Runtime check done: {} {}",
        if node_ok {
            "Node.js ✓,"
        } else {
            "Node.js ✗,"
        },
        if oclaw_ok {
            "openclaw ✓"
        } else {
            "openclaw ✗"
        },
    );
    emit_keyed(&app, step, &summary, "setup.gateway.runtimeSummary", 0.22);
    if !oclaw_ok {
        return Err(format!(
            "OpenClaw is not ready for Gateway startup: {}",
            openclaw_status
                .error
                .unwrap_or_else(|| "validation failed".into())
        ));
    }
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // ⓘ Stage 2: config port probing
    emit_keyed(
        &app,
        step,
        "Reading gateway port from ~/.openclaw/openclaw.json...",
        "setup.gateway.readPort",
        0.32,
    );
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let port = std::fs::read_to_string(paths::config_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|cfg| cfg.get("gateway")?.get("port")?.as_u64())
        .map(|v| v as u16)
        .unwrap_or(18789);
    emit_keyed(
        &app,
        step,
        &format!(
            "Target port = {} (source: openclaw.json, default 18789)",
            port
        ),
        "setup.gateway.portResolved",
        0.42,
    );
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // ⓘ Stage 3: probe existing Gateway process
    emit_keyed(
        &app,
        step,
        &format!(
            "Probing 127.0.0.1:{} for existing Gateway listener...",
            port
        ),
        "setup.gateway.probe",
        0.52,
    );

    let reachable = crate::commands::gateway::is_gateway_serving(port).await;
    if reachable {
        emit_keyed(
            &app,
            step,
            &format!(
                "Port {} already in use - assuming Gateway is running, skipping start",
                port
            ),
            "setup.gateway.alreadyUp",
            0.92,
        );
        emit_keyed(&app, step, "Gateway is ready ✓", "setup.gateway.ready", 1.0);
    } else {
        emit_keyed(
            &app,
            step,
            "No Gateway detected - the frontend launcher will start it",
            "setup.gateway.willStart",
            0.62,
        );
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        emit_keyed(
            &app,
            step,
            "Syncing runtime state (AGENTS / SESSIONS / HEALTH)...",
            "setup.gateway.syncState",
            0.78,
        );
        emit_keyed(
            &app,
            step,
            "Gateway prepared; starting service next...",
            "setup.gateway.preparedToStart",
            1.0,
        );
    }

    Ok(format!("Gateway prepared on port {}", port))
}

/// Install a package via winget (Windows only).
#[tauri::command]
pub async fn install_winget_package(package_id: String) -> Result<String, String> {
    if !package_id
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | '/'))
    {
        return Err("Invalid package ID".into());
    }

    #[cfg(not(windows))]
    {
        let _ = package_id;
        return Err("winget 仅在 Windows 上可用".into());
    }

    #[cfg(windows)]
    {
        let output = tokio::process::Command::new("winget")
            .args([
                "install",
                "-e",
                "--id",
                &package_id,
                "--accept-source-agreements",
                "--accept-package-agreements",
            ])
            .output()
            .await
            .map_err(|e| format!("执行 winget 失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            refresh_path_from_registry();
            Ok(format!("{}\n{}", stdout, stderr).trim().to_string())
        } else {
            Err(format!(
                "winget install 失败（退出码 {}）:\n{}\n{}",
                output.status.code().unwrap_or(-1),
                stdout,
                stderr
            ))
        }
    }
}
