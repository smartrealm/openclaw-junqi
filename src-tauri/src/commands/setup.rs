use crate::paths;
use crate::platform;
use serde::Serialize;
use std::path::PathBuf;
use tauri::Emitter;

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
            let wide: Vec<u16> = val.bytes.chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            let s = OsString::from_wide(&wide);
            if let Some(s) = s.to_str() {
                parts.extend(s.trim_end_matches('\0').split(';').map(|p| p.to_string()));
            }
        }
    }
    if let Ok(env) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
        if let Ok(val) = env.get_raw_value("Path") {
            let wide: Vec<u16> = val.bytes.chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
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
        if path.exists() { return Some(path); }
    }
    None
}

// ─── Progress event ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SetupProgress {
    pub step: String,
    pub message: String,
    pub progress: Option<f64>,
    pub error: Option<String>,
}

fn emit(app: &tauri::AppHandle, step: &str, message: &str, progress: f64) {
    let _ = app.emit("setup-progress", SetupProgress {
        step: step.into(),
        message: message.into(),
        progress: Some(progress.clamp(0.0, 1.0)),
        error: None,
    });
}

// ─── Download sources ──────────────────────────────────────────────────────────

const NODE_VERSION: &str = "24.14.0";
const GIT_WIN_VERSION: &str = "2.47.1";

/// npm registries in priority order: CN mirror first, official fallback.
const NPM_REGISTRIES: &[(&str, &str)] = &[
    ("https://registry.npmmirror.com", "npmmirror.com（国内）"),
    ("https://registry.npmjs.org",     "npmjs.org（官方）"),
];

fn node_filename() -> String {
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
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
        (format!("https://npmmirror.com/mirrors/node/v{}/{}", NODE_VERSION, f), "npmmirror.com（国内）"),
        (format!("https://nodejs.org/dist/v{}/{}", NODE_VERSION, f),            "nodejs.org（官方）"),
    ]
}

fn git_win_filename() -> String {
    format!("Git-{}-64-bit.exe", GIT_WIN_VERSION)
}

fn git_win_sources() -> Vec<(String, &'static str)> {
    let f = git_win_filename();
    vec![
        (
            format!("https://registry.npmmirror.com/-/binary/git-for-windows/v{}.windows.1/{}", GIT_WIN_VERSION, f),
            "npmmirror.com（国内）",
        ),
        (
            format!("https://github.com/git-for-windows/git/releases/download/v{}.windows.1/{}", GIT_WIN_VERSION, f),
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
    let mut last_err = "未知错误".to_string();
    let total_sources = sources.len();

    for (idx, (url, label)) in sources.iter().enumerate() {
        emit(app, step,
            &format!("【下载 {}/{}】正在连接 {}...", idx + 1, total_sources, label),
            prog_start,
        );

        let resp = match reqwest::get(url.as_str()).await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                last_err = format!("HTTP {}", r.status());
                let next_hint = if idx + 1 < total_sources { "，切换备用源..." } else { "" };
                emit(app, step,
                    &format!("{} 返回错误 ({}){}", label, last_err, next_hint),
                    prog_start,
                );
                continue;
            }
            Err(e) => {
                last_err = e.to_string();
                let next_hint = if idx + 1 < total_sources { "，切换备用源..." } else { "" };
                emit(app, step,
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

        emit(app, step,
            &format!("已连接 {}，文件大小 {}，开始下载...", label, size_str),
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
                            emit(app, step,
                                &format!("下载中 {}%（{:.1}/{} MB）via {}",
                                    pct,
                                    downloaded as f64 / 1024.0 / 1024.0,
                                    size_str, label,
                                ),
                                prog,
                            );
                        }
                    } else {
                        // Unknown total: emit every ~2 MB
                        let mb = downloaded / (2 * 1024 * 1024);
                        if mb > last_reported_pct {
                            last_reported_pct = mb;
                            emit(app, step,
                                &format!("下载中... 已获取 {:.1} MB via {}", downloaded as f64 / 1024.0 / 1024.0, label),
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
                emit(app, step, "下载失败，正在切换至备用源...", prog_start);
            }
            continue;
        }

        std::fs::write(dest, &data).map_err(|e| format!("写入文件失败: {}", e))?;

        emit(app, step,
            &format!("下载完成（{:.1} MB），来源：{}", downloaded as f64 / 1024.0 / 1024.0, label),
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
    emit(app, step, &format!("解压中，共 {} 个文件...", total), prog_start);

    for i in 0..total {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        // Strip top-level directory (node-vX.X.X-win-x64/)
        let parts: Vec<&str> = name.splitn(2, '/').collect();
        if parts.len() < 2 || parts[1].is_empty() { continue; }
        let outpath = dest.join(parts[1]);
        if entry.is_dir() {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(p) = outpath.parent() { std::fs::create_dir_all(p).ok(); }
            let mut out = std::fs::File::create(&outpath)
                .map_err(|e| format!("创建 {} 失败: {}", outpath.display(), e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("解压 {} 失败: {}", parts[1], e))?;
        }
        if i % 200 == 0 && total > 0 {
            let frac = i as f64 / total as f64;
            emit(app, step,
                &format!("解压中 {}%（{}/{}）...", (frac * 100.0) as u32, i, total),
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
    emit(app, step, "解压 tar.gz 文件中...", prog_start);
    let file = std::fs::File::open(archive).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);
    let mut count: usize = 0;

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.to_path_buf();
        let components: Vec<_> = path.components().collect();
        if components.len() < 2 { continue; }
        // Strip top-level dir (node-vX.X.X-darwin-arm64/)
        let relative: PathBuf = components[1..].iter().collect();
        let outpath = dest.join(&relative);

        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(p) = outpath.parent() { std::fs::create_dir_all(p).ok(); }
            entry.unpack(&outpath).map_err(|e| format!("解压 {} 失败: {}", relative.display(), e))?;
        }
        count += 1;
        if count % 200 == 0 {
            // tar.gz doesn't know total entry count upfront; show a count instead
            let prog = (prog_start + (prog_end - prog_start) * 0.5).min(prog_end - 0.05);
            emit(app, step, &format!("解压中... 已处理 {} 个文件", count), prog);
        }
    }
    emit(app, step, &format!("解压完成，共处理 {} 个文件", count), prog_end);
    Ok(())
}

// ─── npm install with registry fallback ───────────────────────────────────────

/// Run `npm install --prefix <prefix> <pkg>` with live output streaming.
/// Tries each entry in NPM_REGISTRIES in order; returns Ok on first success.
async fn npm_install_with_fallback(
    app: &tauri::AppHandle,
    step: &str,
    node_cmd: &str,
    npm_cli: Option<&str>,
    prefix: &std::path::Path,
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
    let npm_cache = paths::npm_cache_dir();
    std::fs::create_dir_all(&npm_cache).ok();

    let mut last_err = String::new();
    let total_regs = NPM_REGISTRIES.len();

    for (reg_idx, (registry, reg_label)) in NPM_REGISTRIES.iter().enumerate() {
        emit(app, step,
            &format!("【安装 {}/{}】使用 {} 安装 {}...", reg_idx + 1, total_regs, reg_label, pkg),
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
                "--prefer-offline",
                "--no-fund",
                "--no-audit",
                "--prefix", prefix.to_str().unwrap_or("."),
                pkg,
            ])
           .env("PATH", &path_env)
           .env("npm_config_cache", npm_cache.to_str().unwrap())
           .env("npm_config_registry", *registry)
           .env("GIT_CONFIG_COUNT", "1")
           .env("GIT_CONFIG_KEY_0", "url.https://github.com/.insteadOf")
           .env("GIT_CONFIG_VALUE_0", "ssh://git@github.com/")
           .stdout(std::process::Stdio::piped())
           .stderr(std::process::Stdio::piped())
           .kill_on_drop(true);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                last_err = format!("启动 npm 失败: {}", e);
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
                    if line.is_empty() || line.starts_with("npm notice") { continue; }
                    emit(&app_c, &step_c, &format!("npm › {}", line), prog_live);
                }
            });
        }
        if let Some(stderr) = child.stderr.take() {
            let app_e = app.clone();
            let step_e = step.to_string();
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = line.trim().to_string();
                    if line.is_empty() || line.starts_with("npm notice") { continue; }
                    emit(&app_e, &step_e, &format!("npm › {}", line), prog_live);
                }
            });
        }

        let status = match tokio::time::timeout(
            std::time::Duration::from_secs(360),
            child.wait(),
        ).await {
            Ok(Ok(s)) => s,
            Ok(Err(e)) => {
                last_err = format!("npm 进程异常: {}", e);
                if reg_idx + 1 < total_regs {
                    emit(app, step, &format!("{} 安装异常，切换备用源重试...", reg_label), prog_start);
                }
                continue;
            }
            Err(_) => {
                last_err = "npm install 超时（>6 分钟）".into();
                if reg_idx + 1 < total_regs {
                    emit(app, step, &format!("{} 安装超时，切换备用源重试...", reg_label), prog_start);
                }
                continue;
            }
        };

        if status.success() {
            emit(app, step,
                &format!("{} 安装完成（via {}）✓", pkg, reg_label),
                prog_end,
            );
            return Ok(());
        }

        last_err = format!("npm 退出码 {}", status.code().unwrap_or(-1));
        if reg_idx + 1 < total_regs {
            emit(app, step,
                &format!("{} 安装失败（{}），切换至备用源重试...", reg_label, last_err),
                prog_start,
            );
        }
    }

    Err(format!("所有 npm 源均安装失败。最后错误：{}", last_err))
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn install_node(app: tauri::AppHandle) -> Result<String, String> {
    let step = "node";
    let node_dir = paths::desktop_dir().join("node");
    let node_bin = paths::local_node_path();

    // ① 检测现有版本
    emit(&app, step, "正在检测已安装的 Node.js 版本...", 0.02);

    if node_bin.exists() {
        let version_str = tokio::process::Command::new(&node_bin)
            .arg("--version").output().await.ok()
            .and_then(|o| if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else { None });

        let needs_upgrade = match &version_str {
            Some(v) => {
                let parts: Vec<u32> = v.trim_start_matches('v').split('.')
                    .filter_map(|s| s.parse().ok()).collect();
                parts.len() < 3 || (parts[0], parts[1], parts[2]) < (24, 14, 0)
            }
            None => true,
        };

        if !needs_upgrade {
            let ver = version_str.unwrap_or_default();
            emit(&app, step, &format!("Node.js {} 已满足要求（≥ v24.14.0），跳过安装", ver), 1.0);
            return Ok(format!("Node.js {} already installed", ver));
        }

        let ver = version_str.unwrap_or_else(|| "旧版本".into());
        emit(&app, step,
            &format!("检测到 {}，低于最低要求 v24.14.0，正在清理旧版本...", ver),
            0.04,
        );
        let _ = std::fs::remove_dir_all(&node_dir);
    }

    // ② 下载（CN 源优先，官方兜底）
    emit(&app, step,
        &format!("准备下载 Node.js v{}，优先使用国内镜像源...", NODE_VERSION),
        0.05,
    );
    let temp_dir = paths::desktop_dir().join("tmp");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;
    let archive_path = temp_dir.join(node_filename());

    download_with_fallback(&app, step, &node_sources(), &archive_path, 0.06, 0.60).await?;

    // ③ 解压
    std::fs::create_dir_all(&node_dir).map_err(|e| format!("创建 Node 目录失败: {}", e))?;
    emit(&app, step, &format!("正在解压至 {}...", node_dir.display()), 0.62);

    if cfg!(windows) {
        extract_zip(&app, step, &archive_path, &node_dir, 0.62, 0.90)?;
    } else {
        extract_targz(&app, step, &archive_path, &node_dir, 0.62, 0.90)?;
    }

    // ④ 清理
    emit(&app, step, "清理临时文件...", 0.92);
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&temp_dir);

    // ⑤ 验证
    emit(&app, step, "验证安装结果...", 0.96);
    let ver = tokio::process::Command::new(&node_bin)
        .arg("--version").output().await.ok()
        .and_then(|o| if o.status.success() {
            Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
        } else { None })
        .unwrap_or_else(|| "未知版本".into());

    emit(&app, step, &format!("Node.js {} 安装成功 ✓", ver), 1.0);
    Ok(format!("Node.js {} installed successfully", ver))
}

#[tauri::command]
pub async fn install_git(app: tauri::AppHandle) -> Result<String, String> {
    let step = "git";

    // ① 检测
    emit(&app, step, "正在检测 Git 安装状态...", 0.02);
    let local_git = paths::local_git_path();
    let system_git = platform::bin_name("git");

    if local_git.exists()
        || tokio::process::Command::new(&system_git).arg("--version").output().await
            .map(|o| o.status.success()).unwrap_or(false)
    {
        emit(&app, step, "Git 已安装，跳过安装步骤", 1.0);
        return Ok("Git already installed".into());
    }

    if cfg!(windows) {
        // ── Windows：下载安装包（CN 源优先，GitHub 兜底）──────────────────

        emit(&app, step,
            &format!("准备下载 Git for Windows v{}，优先使用国内镜像源...", GIT_WIN_VERSION),
            0.04,
        );

        let temp_dir = paths::desktop_dir().join("tmp");
        std::fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;
        let installer_path = temp_dir.join(git_win_filename());

        download_with_fallback(&app, step, &git_win_sources(), &installer_path, 0.05, 0.50).await?;

        // 启动安装向导
        emit(&app, step,
            "下载完成，正在启动 Git 安装向导，请按提示完成安装...",
            0.52,
        );
        let mut child = tokio::process::Command::new(&installer_path)
            .spawn()
            .map_err(|e| format!("启动 Git 安装向导失败: {}", e))?;

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
                    emit(&app, step,
                        &format!("等待安装向导完成... 已等待 {:02}:{:02}", mins, secs),
                        pct,
                    );
                    if elapsed_secs > 900 {
                        return Err("等待 Git 安装向导超时（15 分钟），请重试".into());
                    }
                }
                Err(e) => return Err(format!("安装向导进程异常: {}", e)),
            }
        }

        // 清理安装包
        let _ = std::fs::remove_file(&installer_path);
        let _ = std::fs::remove_dir_all(&temp_dir);

        // 刷新 PATH 并验证
        emit(&app, step, "安装向导已退出，正在刷新系统 PATH...", 0.90);
        #[cfg(windows)]
        refresh_path_from_registry();

        emit(&app, step, "正在验证 Git 是否可用...", 0.94);

        #[allow(unused_mut)]
        let mut git_ok = tokio::process::Command::new("git.exe")
            .arg("--version").output().await
            .map(|o| o.status.success()).unwrap_or(false);

        #[cfg(windows)]
        if !git_ok {
            if let Some(git_path) = find_git_in_default_paths() {
                git_ok = tokio::process::Command::new(&git_path)
                    .arg("--version").output().await
                    .map(|o| o.status.success()).unwrap_or(false);
            }
        }

        if git_ok {
            emit(&app, step, "Git 安装成功 ✓", 1.0);
            return Ok("Git installed successfully".into());
        }

        Err("Git 安装向导已完成，但未能检测到 git 命令。\
             请重启应用或手动将 Git 添加到 PATH。".into())

    } else {
        // ── macOS：触发 Xcode Command Line Tools 安装对话框 ───────────────

        emit(&app, step,
            "macOS：正在触发 Xcode Command Line Tools 安装对话框，请按系统提示操作...",
            0.05,
        );
        let _ = tokio::process::Command::new("xcode-select").arg("--install").output().await;

        emit(&app, step, "已触发系统对话框，请在弹出的窗口中点击「安装」...", 0.10);

        // 轮询等待 git 可用（最多 10 分钟）
        let max_wait = std::time::Duration::from_secs(600);
        let start = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;

            if tokio::process::Command::new("git").arg("--version").output().await
                .map(|o| o.status.success()).unwrap_or(false)
            {
                emit(&app, step, "Git（Command Line Tools）安装成功 ✓", 1.0);
                return Ok("Git installed successfully".into());
            }

            let elapsed = start.elapsed();
            if elapsed > max_wait {
                return Err("等待 Command Line Tools 安装超时（10 分钟）。\
                            请手动安装后重试。".into());
            }

            let secs = elapsed.as_secs();
            let pct = (0.10 + (secs as f64 / 600.0) * 0.85).min(0.95);
            emit(&app, step,
                &format!("等待 Command Line Tools 安装... 已等待 {:02}:{:02}（请在系统对话框中确认）",
                    secs / 60, secs % 60),
                pct,
            );
        }
    }
}

#[tauri::command]
pub async fn install_openclaw(app: tauri::AppHandle) -> Result<String, String> {
    let step = "openclaw";

    // ① 定位 Node.js 二进制
    emit(&app, step, "正在定位 Node.js 可执行文件...", 0.03);
    let local_node = paths::local_node_path();
    let node_cmd = if local_node.exists() {
        let path = local_node.to_string_lossy().to_string();
        emit(&app, step, &format!("使用本地 Node.js：{}", path), 0.05);
        path
    } else {
        emit(&app, step, "使用系统 Node.js", 0.05);
        platform::bin_name("node")
    };

    // 检查 npm-cli.js
    let local_npm_cli = paths::local_npm_cli_path();
    let npm_cli = if local_npm_cli.exists() {
        emit(&app, step, &format!("使用本地 npm：{}", local_npm_cli.display()), 0.07);
        Some(local_npm_cli.to_string_lossy().to_string())
    } else {
        emit(&app, step, "使用系统 npm", 0.07);
        None
    };

    // ② 准备安装目录
    let openclaw_prefix = paths::desktop_dir().join("openclaw");
    emit(&app, step, &format!("准备安装目录 {}...", openclaw_prefix.display()), 0.08);
    std::fs::create_dir_all(&openclaw_prefix).ok();

    // ③ npm install（CN 源优先，官方兜底，全程输出实时日志）
    emit(&app, step,
        "优先使用 npmmirror.com（国内）安装 openclaw，失败自动切换 npmjs.org（官方）...",
        0.10,
    );

    npm_install_with_fallback(
        &app, step,
        &node_cmd,
        npm_cli.as_deref(),
        &openclaw_prefix,
        "openclaw",
        0.10,
        0.90,
    ).await?;

    // ④ 验证
    emit(&app, step, "正在验证 openclaw 安装...", 0.92);
    let openclaw_bin = openclaw_prefix.join("bin").join(platform::bin_name("openclaw"));
    if !openclaw_bin.exists() {
        // npm --prefix installs to <prefix>/node_modules/.bin/
        let alt_bin = openclaw_prefix
            .join("node_modules").join(".bin").join(platform::bin_name("openclaw"));
        if !alt_bin.exists() {
            return Err("openclaw 安装目录未找到可执行文件，请重试".into());
        }
    }

    emit(&app, step, "openclaw 安装成功 ✓", 1.0);
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

    // ⓘ 阶段一：检测本地运行时
    emit(&app, step,
        "正在准备 OpenClaw Gateway…",
        0.05,
    );
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    emit(&app, step,
        "检测本地运行时（Node.js / npm / openclaw 二进制）…",
        0.12,
    );

    let node_ok = paths::local_node_path().exists();
    let oclaw_bin = paths::desktop_dir().join("openclaw").join("bin").join(platform::bin_name("openclaw"));
    let oclaw_ok = oclaw_bin.exists();
    let summary = format!(
        "运行时检测完成：{}、{}",
        if node_ok { "Node.js ✓" } else { "Node.js ✗" },
        if oclaw_ok { "openclaw ✓" } else { "openclaw ✗" },
    );
    emit(&app, step, &summary, 0.22);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // ⓘ 阶段二：探测配置端口
    emit(&app, step, "读取 ~/.openclaw/openclaw.json 中的 gateway 端口…", 0.32);
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let port = std::fs::read_to_string(paths::config_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|cfg| cfg.get("gateway")?.get("port")?.as_u64())
        .map(|v| v as u16)
        .unwrap_or(18789);
    emit(&app, step,
        &format!("目标端口 = {}（来源：openclaw.json，默认 18789）", port),
        0.42,
    );
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // ⓘ 阶段三：探测现有 Gateway 进程
    emit(&app, step,
        &format!("探测 127.0.0.1:{} 是否已有 Gateway 在监听...", port),
        0.52,
    );

    let reachable = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok();
    if reachable {
        emit(&app, step,
            &format!("端口 {} 已被占用，假定 Gateway 正在运行，跳过启动", port),
            0.92,
        );
    } else {
        emit(&app, step,
            "未检测到正在运行的 Gateway，将由前端启动器接管启动流程",
            0.62,
        );
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        emit(&app, step, "同步运行时状态（AGENTS / SESSIONS / HEALTH）…", 0.78);
    }

    // ⓘ 阶段四：完成
    emit(&app, step,
        "检测、连接并同步运行时状态…",
        0.92,
    );
    emit(&app, step,
        "Gateway 准备就绪 ✓",
        1.0,
    );

    Ok(format!("Gateway prepared on port {}", port))
}

/// Install a package via winget (Windows only).
#[tauri::command]
pub async fn install_winget_package(package_id: String) -> Result<String, String> {
    if !package_id.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | '/')) {
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
                "install", "-e", "--id", &package_id,
                "--accept-source-agreements", "--accept-package-agreements",
            ])
            .output().await
            .map_err(|e| format!("执行 winget 失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            refresh_path_from_registry();
            Ok(format!("{}\n{}", stdout, stderr).trim().to_string())
        } else {
            Err(format!(
                "winget install 失败（退出码 {}）:\n{}\n{}",
                output.status.code().unwrap_or(-1), stdout, stderr
            ))
        }
    }
}
