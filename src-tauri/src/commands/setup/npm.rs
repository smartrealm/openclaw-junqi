//! npm-driven package installation: registry fallback, output redaction,
//! fetch metrics, and process supervision.

use super::*;

// ─── npm install with registry fallback ───────────────────────────────────────

pub(super) const NPM_SLOW_FETCH_THRESHOLD: std::time::Duration = std::time::Duration::from_secs(90);
pub(super) const NPM_DIAGNOSTIC_LINE_LIMIT: usize = 24;

pub(super) const NPM_NOISY_LOG_PREFIXES: &[&str] = &[
    "npm verbose",
    "npm sill",
    "npm timing",
    "npm notice",
    "npm http fetch",
];

pub(super) const NPM_SECRET_MARKERS: &[&str] = &[
    "_authtoken",
    "authorization",
    "bearer ",
    "password",
    "api_key",
    "apikey",
];

pub(super) fn npm_log_line_is_noisy(line: &str) -> bool {
    let lowercase = line.trim().to_ascii_lowercase();
    NPM_NOISY_LOG_PREFIXES
        .iter()
        .any(|prefix| lowercase.starts_with(prefix))
}

pub(super) fn npm_log_line_is_http_fetch(line: &str) -> bool {
    line.trim()
        .to_ascii_lowercase()
        .starts_with("npm http fetch")
}

#[derive(Default)]
pub(super) struct NpmStreamProgress {
    pub(super) milestone: AtomicUsize,
    pub(super) http_requests: AtomicUsize,
}

impl NpmStreamProgress {
    pub(super) fn observe(&self, line: &str) -> f64 {
        let lower = line.trim().to_ascii_lowercase();
        let candidate = if lower.contains("npm http fetch") {
            let requests = self.http_requests.fetch_add(1, Ordering::Relaxed) + 1;
            300 + requests.min(250)
        } else if lower.contains("preinstall")
            || lower.contains("postinstall")
            || lower.contains("node-gyp-build")
            || lower.contains("install script")
            || lower.contains("foreground script")
        {
            720
        } else if lower.starts_with("added ")
            || lower.starts_with("changed ")
            || lower.starts_with("removed ")
            || lower.contains("packages in")
        {
            880
        } else if lower.contains("reify")
            || lower.contains("extract")
            || lower.contains("unpack")
            || lower.contains("package tree")
            || lower.contains("staging")
        {
            620
        } else if lower.contains("resolv")
            || lower.contains("ideal tree")
            || lower.contains("idealtree")
            || lower.contains("fetch manifest")
        {
            220
        } else {
            self.milestone.load(Ordering::Relaxed)
        };
        let milestone = self
            .milestone
            .fetch_max(candidate, Ordering::Relaxed)
            .max(candidate);
        milestone as f64 / 1_000.0
    }

    pub(super) fn overall(&self, start: f64, end: f64) -> f64 {
        start + (end - start) * (self.milestone.load(Ordering::Relaxed) as f64 / 1_000.0)
    }
}

/// Keep npm's verbose stream available for inactivity detection without
/// forwarding internal chatter or credentials into the primary setup console.
pub(super) fn npm_log_line_for_display(line: &str) -> Option<String> {
    if npm_log_line_is_noisy(line) {
        return None;
    }
    npm_log_line_redacted(line)
}

/// Redact credentials/registry URLs from a retained npm diagnostic line.
/// Per-request HTTP lines stay only in the raw process artifact; the UI uses
/// a coalesced network summary instead.
pub(super) fn npm_log_line_redacted(line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let lowercase = line.to_ascii_lowercase();
    if NPM_SECRET_MARKERS
        .iter()
        .any(|marker| lowercase.contains(marker))
    {
        return Some("[authentication details redacted]".into());
    }

    let redacted = line
        .split_whitespace()
        .map(|token| {
            let contains_url_credentials = token
                .find("://")
                .and_then(|scheme_end| token[scheme_end + 3..].find('@'))
                .is_some();
            if contains_url_credentials {
                "[registry URL redacted]"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    const MAX_DISPLAY_CHARS: usize = 1_000;
    if redacted.chars().count() <= MAX_DISPLAY_CHARS {
        Some(redacted)
    } else {
        Some(
            redacted
                .chars()
                .take(MAX_DISPLAY_CHARS)
                .chain(std::iter::once('…'))
                .collect(),
        )
    }
}

pub(super) fn npm_fetch_duration_ms(line: &str) -> Option<u64> {
    if !line.to_ascii_lowercase().contains("npm http fetch") {
        return None;
    }
    line.split_whitespace().rev().find_map(|token| {
        token
            .strip_suffix("ms")
            .and_then(|value| value.parse::<u64>().ok())
    })
}

#[derive(Default)]
pub(super) struct NpmFetchMetrics {
    pub(super) requests: u64,
    pub(super) cache_hits: u64,
    pub(super) cache_misses: u64,
    pub(super) total_duration_ms: u128,
    pub(super) slowest_duration_ms: u64,
    pub(super) slow_requests: u64,
}

pub(super) type SharedNpmFetchMetrics = Arc<Mutex<NpmFetchMetrics>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct NpmFetchSnapshot {
    pub(super) requests: u64,
    pub(super) slowest_duration_ms: u64,
}

pub(super) fn npm_fetch_snapshot(metrics: &SharedNpmFetchMetrics) -> NpmFetchSnapshot {
    let metrics = metrics
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    NpmFetchSnapshot {
        requests: metrics.requests,
        slowest_duration_ms: metrics.slowest_duration_ms,
    }
}

pub(super) fn npm_install_activity_message(
    source_label: &str,
    elapsed: std::time::Duration,
    last_output_age: std::time::Duration,
    snapshot: NpmFetchSnapshot,
) -> String {
    let network = if snapshot.requests == 0 {
        "no network requests observed yet".to_string()
    } else {
        format!(
            "{} network requests completed, slowest {}ms",
            snapshot.requests, snapshot.slowest_duration_ms
        )
    };
    format!(
        "npm is still running via {source_label} (elapsed {}); {network}; last npm output {} ago; resolving dependencies, extracting packages, or running lifecycle scripts...",
        compact_elapsed(elapsed),
        compact_elapsed(last_output_age),
    )
}

pub(super) fn observe_npm_fetch(
    line: &str,
    source_label: &str,
    slow_fetch_tx: &tokio::sync::watch::Sender<Option<String>>,
    slow_fetch_triggered: &AtomicBool,
    metrics: &SharedNpmFetchMetrics,
) -> Option<u64> {
    let Some(duration_ms) = npm_fetch_duration_ms(line) else {
        return None;
    };
    let request_count = {
        let lowercase = line.to_ascii_lowercase();
        let mut metrics = metrics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        metrics.requests += 1;
        metrics.total_duration_ms += duration_ms as u128;
        metrics.slowest_duration_ms = metrics.slowest_duration_ms.max(duration_ms);
        if lowercase.contains("cache hit") {
            metrics.cache_hits += 1;
        } else if lowercase.contains("cache miss") {
            metrics.cache_misses += 1;
        }
        if duration_ms >= NPM_SLOW_FETCH_THRESHOLD.as_millis() as u64 {
            metrics.slow_requests += 1;
        }
        metrics.requests
    };
    if duration_ms < NPM_SLOW_FETCH_THRESHOLD.as_millis() as u64
        || slow_fetch_triggered.swap(true, Ordering::AcqRel)
    {
        return Some(request_count);
    }
    let reason = format!(
        "{} npm tarball request took {}ms (slow-source threshold: {}s)",
        source_label,
        duration_ms,
        NPM_SLOW_FETCH_THRESHOLD.as_secs()
    );
    let _ = slow_fetch_tx.send(Some(reason));
    Some(request_count)
}

pub(super) fn npm_fetch_summary(
    source_label: &str,
    metrics: &SharedNpmFetchMetrics,
) -> Option<String> {
    let metrics = metrics
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if metrics.requests == 0 {
        return None;
    }
    let average_ms = metrics.total_duration_ms / metrics.requests as u128;
    Some(format!(
        "npm network summary for {source_label}: requests={}, cache hits={}, cache misses={}, average={}ms, slowest={}ms, requests >= {}s={}",
        metrics.requests,
        metrics.cache_hits,
        metrics.cache_misses,
        average_ms,
        metrics.slowest_duration_ms,
        NPM_SLOW_FETCH_THRESHOLD.as_secs(),
        metrics.slow_requests,
    ))
}

pub(super) fn emit_npm_fetch_summary(
    app: &tauri::AppHandle,
    step: &str,
    source_label: &str,
    metrics: &SharedNpmFetchMetrics,
    log_slot: &str,
    progress: f64,
) {
    if let Some(summary) = npm_fetch_summary(source_label, metrics) {
        emit_coalesced(app, step, &summary, log_slot, progress);
    }
}

pub(super) type NpmDiagnostics = Arc<Mutex<Vec<String>>>;

pub(super) fn record_npm_diagnostic(diagnostics: &NpmDiagnostics, line: &str) {
    let mut lines = diagnostics
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if lines.last().is_some_and(|last| last == line) {
        return;
    }
    if lines.len() == NPM_DIAGNOSTIC_LINE_LIMIT {
        lines.remove(0);
    }
    lines.push(line.to_owned());
}

pub(super) fn npm_diagnostic_text(diagnostics: &NpmDiagnostics) -> String {
    diagnostics
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .join(" | ")
}

pub(super) enum NpmWaitResult {
    Exited(std::io::Result<std::process::ExitStatus>),
    DeadlineExceeded,
    SlowSource(String),
}

pub(super) struct NpmOutputTasks {
    pub(super) stdout: Option<tokio::task::JoinHandle<Result<(), String>>>,
    pub(super) stderr: Option<tokio::task::JoinHandle<Result<(), String>>>,
}

impl NpmOutputTasks {
    pub(super) async fn finish(self) -> Result<(), String> {
        let stdout = finish_npm_output_task("stdout", self.stdout).await;
        let stderr = finish_npm_output_task("stderr", self.stderr).await;
        match (stdout, stderr) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
            (Err(stdout_error), Err(stderr_error)) => {
                Err(format!("{stdout_error}; {stderr_error}"))
            }
        }
    }
}

pub(super) async fn finish_npm_output_task(
    stream: &str,
    task: Option<tokio::task::JoinHandle<Result<(), String>>>,
) -> Result<(), String> {
    let Some(mut task) = task else {
        return Ok(());
    };
    match tokio::time::timeout(PROCESS_REAP_TIMEOUT, &mut task).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(error))) => Err(format!("Failed to read npm {stream}: {error}")),
        Ok(Err(error)) => Err(format!("npm {stream} reader task failed: {error}")),
        Err(_) => {
            task.abort();
            Err(format!(
                "npm {stream} did not close within {} seconds after its process stopped",
                PROCESS_REAP_TIMEOUT.as_secs()
            ))
        }
    }
}

pub(super) async fn stop_npm_process(
    child: &mut tokio::process::Child,
    pid: Option<u32>,
    output: NpmOutputTasks,
) -> Result<(), String> {
    let process = terminate_process_tree_confirmed(child, pid).await;
    let output = output.finish().await;
    match (process, output) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(process_error), Ok(())) => Err(process_error),
        (Ok(()), Err(output_error)) => Err(output_error),
        (Err(process_error), Err(output_error)) => Err(format!("{process_error}; {output_error}")),
    }
}

#[cfg(test)]
pub(super) async fn wait_for_npm_process(
    child: &mut tokio::process::Child,
    deadline: std::time::Instant,
) -> NpmWaitResult {
    let (_slow_fetch_tx, mut slow_fetch_rx) = tokio::sync::watch::channel(None);
    wait_for_npm_process_with_slow_signal(child, &mut slow_fetch_rx, deadline).await
}

pub(super) async fn wait_for_npm_process_with_slow_signal(
    child: &mut tokio::process::Child,
    slow_fetch: &mut tokio::sync::watch::Receiver<Option<String>>,
    deadline: std::time::Instant,
) -> NpmWaitResult {
    let wait = child.wait();
    tokio::pin!(wait);
    let deadline_wait = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline));
    tokio::pin!(deadline_wait);
    let mut slow_fetch_open = true;
    loop {
        tokio::select! {
            biased;
            status = &mut wait => return NpmWaitResult::Exited(status),
            _ = &mut deadline_wait => return NpmWaitResult::DeadlineExceeded,
            changed = slow_fetch.changed(), if slow_fetch_open => {
                if changed.is_ok() {
                    if let Some(reason) = slow_fetch.borrow().clone() {
                        return NpmWaitResult::SlowSource(reason);
                    }
                } else {
                    slow_fetch_open = false;
                }
            }
        }
    }
}

/// Run `npm install -g <pinned-package>` against a user-writable global prefix
/// with live output streaming. The release contract is resolved once before
/// this function, so its registry order, version and Node.js requirement stay
/// aligned throughout a single installation attempt.
///
/// We deliberately use `-g` plus an `npm_config_prefix` env var rather than
/// `npm install --prefix <dir>`: `--prefix` is the project-local install
/// flag and produces non-standard bin layouts that diverge from a normal
/// global install. `-g` gives us the real global layout
/// (`<prefix>/bin/openclaw`, `<prefix>/lib/node_modules/openclaw/...`) and
/// respects whatever the user already has on `PATH` via `detect_openclaw`.
pub(super) struct NpmInstallRequest<'a> {
    pub(super) app: &'a tauri::AppHandle,
    pub(super) step: &'a str,
    pub(super) npm: &'a crate::commands::system::NpmExecutionContext,
    pub(super) global_prefix: &'a std::path::Path,
    pub(super) target: &'a npm_registry::OpenclawReleaseTarget,
    pub(super) force: bool,
    pub(super) progress: std::ops::Range<f64>,
}

pub(super) async fn npm_install_with_fallback(
    request: NpmInstallRequest<'_>,
) -> Result<(), String> {
    let NpmInstallRequest {
        app,
        step,
        npm,
        global_prefix,
        target,
        force,
        progress,
    } = request;
    let prog_start = progress.start;
    let prog_end = progress.end;
    let deadline = std::time::Instant::now() + DEPENDENCY_INSTALL_DEADLINE;
    let install_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::fs::create_dir_all(global_prefix).ok();
    let package_spec = target.package_spec();
    let sources = target.sources().to_vec();
    let mut last_err = String::new();
    let total_regs = sources.len();
    let registry_order = sources
        .iter()
        .map(npm_registry::NpmPackageSource::install_log_label)
        .collect::<Vec<_>>()
        .join(" -> ");
    let cache_directory = paths::configured_npm_cache_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "npm default cache".to_string());
    emit_diagnostic(
        app,
        step,
        &format!(
            "npm install context: platform={}/{}, node={}, npm-cli={}, prefix={}, cache={}, force={}",
            std::env::consts::OS,
            std::env::consts::ARCH,
            npm.node().display(),
            npm.npm_cli().display(),
            global_prefix.display(),
            cache_directory,
            force,
        ),
        prog_start,
    );
    emit_diagnostic(
        app,
        step,
        &format!(
            "npm network policy: fetch-retries=2, fetch-timeout=120000ms, slow-source-threshold={}s, output-silence-is-nonfatal=true, transaction-deadline={}s",
            NPM_SLOW_FETCH_THRESHOLD.as_secs(),
            DEPENDENCY_INSTALL_DEADLINE.as_secs(),
        ),
        prog_start,
    );
    emit(
        app,
        step,
        &format!(
            "npm registry order for this installation: {}; OpenClaw target = {}",
            registry_order,
            target.version(),
        ),
        prog_start,
    );
    emit(
        app,
        step,
        &format!(
            "npm cache for this installation: {}; registry selection is transaction-scoped and does not overwrite the user's npm configuration",
            cache_directory,
        ),
        prog_start,
    );
    emit(
        app,
        step,
        &format!("npm source diagnostics: {}", target.source_diagnostic()),
        prog_start,
    );

    for (reg_idx, source) in sources.into_iter().enumerate() {
        if deadline
            .checked_duration_since(std::time::Instant::now())
            .is_none()
        {
            return Err(format!(
                "npm 安装 {} 超过 30 分钟总时限；未再启动备用源",
                package_spec
            ));
        }
        let staging_prefix = global_prefix.join(format!(
            ".junqi-openclaw-stage-{}-{}-{}",
            std::process::id(),
            install_nonce,
            reg_idx + 1
        ));
        let _staging_cleanup = TemporaryDirectory(staging_prefix.clone());
        let install_prefix = staging_prefix.as_path();
        let npm_prefix_str = install_prefix.to_string_lossy().to_string();
        std::fs::create_dir_all(&staging_prefix).map_err(|error| {
            format!(
                "Cannot prepare the isolated OpenClaw installer at {}: {}",
                staging_prefix.display(),
                error
            )
        })?;
        let reg_label = source.install_log_label();
        let attempt_started = std::time::Instant::now();
        let npm_activity_log_slot = format!("npm-install-{install_nonce}-{}", reg_idx + 1);
        emit_coalesced(
            app,
            step,
            &format!(
                "【安装 {}/{}】使用 {} 安装 {}...",
                reg_idx + 1,
                total_regs,
                reg_label,
                package_spec
            ),
            &npm_activity_log_slot,
            prog_start,
        );

        let mut cmd = npm.command();

        cmd.args([
            "install",
            "-g",
            "--prefer-offline",
            "--loglevel=http",
            "--foreground-scripts",
            "--fetch-retries=2",
            "--fetch-retry-mintimeout=1000",
            "--fetch-retry-maxtimeout=10000",
            "--fetch-timeout=120000",
            "--no-fund",
            "--no-audit",
        ]);
        if force {
            // An explicit reinstall must not be short-circuited by npm's
            // existing-package metadata. Keep the current payload in place
            // until npm has successfully replaced it.
            cmd.arg("--force");
        }
        cmd.arg(&package_spec)
            .env("npm_config_prefix", &npm_prefix_str)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        source.apply_to_command(&mut cmd);
        crate::commands::system::apply_configured_npm_cache(&mut cmd);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                last_err = format!("Failed to spawn npm: {}", e);
                continue;
            }
        };
        let child_pid = child.id();
        let process_label = format!("npm-attempt-{}", reg_idx + 1);
        record_process_started(
            app,
            step,
            &process_label,
            child_pid,
            &format!("npm install via {reg_label}"),
        );
        let (slow_fetch_tx, mut slow_fetch_rx) = tokio::sync::watch::channel(None::<String>);
        let slow_fetch_triggered = Arc::new(AtomicBool::new(false));
        let fetch_metrics = Arc::new(Mutex::new(NpmFetchMetrics::default()));
        let diagnostics = Arc::new(Mutex::new(Vec::new()));
        let npm_progress = Arc::new(NpmStreamProgress::default());
        let last_output_seconds = Arc::new(AtomicU64::new(0));

        // Stream stdout to progress events so the user sees live npm output
        let stdout_task = child.stdout.take().map(|stdout| {
            let app_c = app.clone();
            let step_c = step.to_string();
            let slow_fetch_tx = slow_fetch_tx.clone();
            let slow_fetch_triggered = Arc::clone(&slow_fetch_triggered);
            let fetch_metrics = Arc::clone(&fetch_metrics);
            let source_label = reg_label.clone();
            let diagnostics = Arc::clone(&diagnostics);
            let process_label = process_label.clone();
            let npm_progress = Arc::clone(&npm_progress);
            let last_output_seconds = Arc::clone(&last_output_seconds);
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stdout).lines();
                while let Some(line) = lines
                    .next_line()
                    .await
                    .map_err(|error| format!("Failed to read npm stdout: {error}"))?
                {
                    record_process_output(&app_c, &step_c, &process_label, "stdout", &line);
                    last_output_seconds
                        .store(attempt_started.elapsed().as_secs(), Ordering::Release);
                    let progress =
                        prog_start + (prog_end - prog_start) * npm_progress.observe(&line);
                    observe_npm_fetch(
                        &line,
                        &source_label,
                        &slow_fetch_tx,
                        &slow_fetch_triggered,
                        &fetch_metrics,
                    );
                    if npm_log_line_is_http_fetch(&line) {
                        continue;
                    }
                    match npm_log_line_for_display(&line) {
                        Some(display_line) => {
                            record_npm_diagnostic(&diagnostics, &display_line);
                            emit(
                                &app_c,
                                &step_c,
                                &format!("npm › {}", display_line),
                                progress,
                            );
                        }
                        // Noisy lines (npm verbose/sill/timing/notice) are dropped from
                        // the primary progress stream, but a raw diagnostic console
                        // still needs them to show a slow-but-alive install is doing
                        // something, not just silently stuck.
                        None => {
                            if let Some(raw_line) = npm_log_line_redacted(&line) {
                                emit_diagnostic(
                                    &app_c,
                                    &step_c,
                                    &format!("npm » {}", raw_line),
                                    progress,
                                );
                            }
                        }
                    }
                }
                Ok(())
            })
        });
        let tar_warning_count = Arc::new(AtomicUsize::new(0));
        let stderr_task = child.stderr.take().map(|stderr| {
            let app_e = app.clone();
            let step_e = step.to_string();
            let tar_warning_count_e = Arc::clone(&tar_warning_count);
            let slow_fetch_tx = slow_fetch_tx.clone();
            let slow_fetch_triggered = Arc::clone(&slow_fetch_triggered);
            let fetch_metrics = Arc::clone(&fetch_metrics);
            let source_label = reg_label.clone();
            let diagnostics = Arc::clone(&diagnostics);
            let process_label = process_label.clone();
            let npm_progress = Arc::clone(&npm_progress);
            let last_output_seconds = Arc::clone(&last_output_seconds);
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stderr).lines();
                while let Some(line) = lines
                    .next_line()
                    .await
                    .map_err(|error| format!("Failed to read npm stderr: {error}"))?
                {
                    record_process_output(&app_e, &step_e, &process_label, "stderr", &line);
                    last_output_seconds
                        .store(attempt_started.elapsed().as_secs(), Ordering::Release);
                    let progress =
                        prog_start + (prog_end - prog_start) * npm_progress.observe(&line);
                    observe_npm_fetch(
                        &line,
                        &source_label,
                        &slow_fetch_tx,
                        &slow_fetch_triggered,
                        &fetch_metrics,
                    );
                    if npm_log_line_is_http_fetch(&line) {
                        continue;
                    }
                    match npm_log_line_for_display(&line) {
                        Some(display_line) => {
                            if display_line.contains("TAR_ENTRY_ERROR")
                                && display_line.contains("ENOENT")
                            {
                                let seen = tar_warning_count_e.fetch_add(1, Ordering::Relaxed);
                                // Preserve the first diagnostic but avoid flooding the
                                // setup UI with hundreds of identical npm warnings.
                                if seen > 0 {
                                    continue;
                                }
                            }
                            record_npm_diagnostic(&diagnostics, &display_line);
                            emit(
                                &app_e,
                                &step_e,
                                &format!("npm › {}", display_line),
                                progress,
                            );
                        }
                        None => {
                            if let Some(raw_line) = npm_log_line_redacted(&line) {
                                emit_diagnostic(
                                    &app_e,
                                    &step_e,
                                    &format!("npm » {}", raw_line),
                                    progress,
                                );
                            }
                        }
                    }
                }
                Ok(())
            })
        });
        let (heartbeat_tx, mut heartbeat_rx) = tokio::sync::watch::channel(false);
        let heartbeat_app = app.clone();
        let heartbeat_step = step.to_string();
        let heartbeat_label = reg_label.to_string();
        let heartbeat_progress = Arc::clone(&npm_progress);
        let heartbeat_fetch_metrics = Arc::clone(&fetch_metrics);
        let heartbeat_last_output_seconds = Arc::clone(&last_output_seconds);
        let heartbeat_log_slot = npm_activity_log_slot.clone();
        let heartbeat_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    changed = heartbeat_rx.changed() => {
                        if changed.is_err() || *heartbeat_rx.borrow() {
                            break;
                        }
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {
                        let elapsed = attempt_started.elapsed();
                        let last_output_age = std::time::Duration::from_secs(
                            elapsed.as_secs().saturating_sub(
                                heartbeat_last_output_seconds.load(Ordering::Acquire),
                            ),
                        );
                        emit_coalesced(
                            &heartbeat_app,
                            &heartbeat_step,
                            &npm_install_activity_message(
                                &heartbeat_label,
                                elapsed,
                                last_output_age,
                                npm_fetch_snapshot(&heartbeat_fetch_metrics),
                            ),
                            &heartbeat_log_slot,
                            heartbeat_progress.overall(prog_start, prog_end),
                        );
                    }
                }
            }
        });
        let wait_result =
            wait_for_npm_process_with_slow_signal(&mut child, &mut slow_fetch_rx, deadline).await;
        let _ = heartbeat_tx.send(true);
        let _ = heartbeat_task.await;
        let output = NpmOutputTasks {
            stdout: stdout_task,
            stderr: stderr_task,
        };
        let prog_live = npm_progress.overall(prog_start, prog_end);
        let status = match wait_result {
            NpmWaitResult::Exited(Ok(status)) => {
                if let Err(error) = output.finish().await {
                    record_process_finished(
                        app,
                        step,
                        &process_label,
                        child_pid,
                        status.code().map(i64::from),
                        attempt_started.elapsed(),
                    );
                    return Err(format!(
                        "npm exited, but its output streams did not finish cleanly: {error}"
                    ));
                }
                record_process_finished(
                    app,
                    step,
                    &process_label,
                    child_pid,
                    status.code().map(i64::from),
                    attempt_started.elapsed(),
                );
                emit_npm_fetch_summary(
                    app,
                    step,
                    &reg_label,
                    &fetch_metrics,
                    &npm_activity_log_slot,
                    prog_live,
                );
                if std::time::Instant::now() >= deadline {
                    return Err("npm install exceeded the 30-minute dependency deadline".into());
                }
                status
            }
            NpmWaitResult::Exited(Err(e)) => {
                let diagnostic = npm_diagnostic_text(&diagnostics);
                last_err = if diagnostic.is_empty() {
                    format!("npm process error: {e}")
                } else {
                    format!("npm process error: {e}; {diagnostic}")
                };
                let cleanup = stop_npm_process(&mut child, child_pid, output).await;
                record_process_finished(
                    app,
                    step,
                    &process_label,
                    child_pid,
                    None,
                    attempt_started.elapsed(),
                );
                emit_npm_fetch_summary(
                    app,
                    step,
                    &reg_label,
                    &fetch_metrics,
                    &npm_activity_log_slot,
                    prog_live,
                );
                if let Err(cleanup_error) = cleanup {
                    return Err(format!(
                        "{last_err}; process cleanup was not confirmed, so no fallback registry was started: {cleanup_error}"
                    ));
                }
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
            NpmWaitResult::SlowSource(reason) => {
                let diagnostic = npm_diagnostic_text(&diagnostics);
                last_err = if diagnostic.is_empty() {
                    reason.clone()
                } else {
                    format!("{reason}; {diagnostic}")
                };
                let cleanup = stop_npm_process(&mut child, child_pid, output).await;
                record_process_finished(
                    app,
                    step,
                    &process_label,
                    child_pid,
                    None,
                    attempt_started.elapsed(),
                );
                emit_npm_fetch_summary(
                    app,
                    step,
                    &reg_label,
                    &fetch_metrics,
                    &npm_activity_log_slot,
                    prog_live,
                );
                if let Err(cleanup_error) = cleanup {
                    return Err(format!(
                        "{last_err}; process cleanup was not confirmed, so no fallback registry was started: {cleanup_error}"
                    ));
                }
                if reg_idx + 1 < total_regs {
                    emit(
                        app,
                        step,
                        &format!(
                            "{} detected a slow transfer; switching to the fallback source immediately...",
                            reg_label
                        ),
                        prog_start,
                    );
                }
                continue;
            }
            NpmWaitResult::DeadlineExceeded => {
                let diagnostic = npm_diagnostic_text(&diagnostics);
                let base_error = "npm install exceeded the 30-minute dependency deadline";
                last_err = if diagnostic.is_empty() {
                    base_error.into()
                } else {
                    format!("{base_error}; {diagnostic}")
                };
                let cleanup = stop_npm_process(&mut child, child_pid, output).await;
                record_process_finished(
                    app,
                    step,
                    &process_label,
                    child_pid,
                    None,
                    attempt_started.elapsed(),
                );
                emit_npm_fetch_summary(
                    app,
                    step,
                    &reg_label,
                    &fetch_metrics,
                    &npm_activity_log_slot,
                    prog_live,
                );
                if let Err(cleanup_error) = cleanup {
                    return Err(format!(
                        "{last_err}; process cleanup was not confirmed, so no fallback registry was started: {cleanup_error}"
                    ));
                }
                return Err(last_err);
            }
        };

        if status.success() {
            emit(
                app,
                step,
                &format!(
                    "{} npm process completed in {}s; validating the staged package...",
                    reg_label,
                    attempt_started.elapsed().as_secs()
                ),
                prog_live,
            );
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
            let finalization = if cfg!(windows) {
                validate_staged_openclaw_install(&staging_prefix)?;
                validate_staged_openclaw_package(
                    &staging_prefix,
                    target.version(),
                    &NodeRuntimeRequirement::parse(
                        target.node_requirement(),
                        NodeRequirementSource::RegistryPackage,
                    )?,
                    npm.node(),
                )
                .await?;
                promote_staged_openclaw_install(&staging_prefix, global_prefix).await?
            } else {
                validate_staged_unix_openclaw_install(&staging_prefix)?;
                validate_staged_openclaw_package(
                    &staging_prefix,
                    target.version(),
                    &NodeRuntimeRequirement::parse(
                        target.node_requirement(),
                        NodeRequirementSource::RegistryPackage,
                    )?,
                    npm.node(),
                )
                .await?;
                promote_staged_unix_openclaw_install(&staging_prefix, global_prefix)?
            };
            if let PromotionFinalization::CleanupDeferred(warning) = finalization {
                emit(app, step, &warning, prog_live);
            }
            emit(
                app,
                step,
                &format!("{} installed (via {}) ✓", package_spec, reg_label),
                prog_end,
            );
            return Ok(());
        }

        if deadline
            .checked_duration_since(std::time::Instant::now())
            .is_none()
        {
            return Err(format!(
                "npm 安装 {} 超过 30 分钟总时限；最后错误：{}",
                package_spec, last_err
            ));
        }

        let diagnostic = npm_diagnostic_text(&diagnostics);
        last_err = if diagnostic.is_empty() {
            format!("npm 退出码 {}", status.code().unwrap_or(-1))
        } else {
            format!("npm 退出码 {}: {}", status.code().unwrap_or(-1), diagnostic)
        };
        emit(
            app,
            step,
            &format!(
                "{} npm process exited after {}s: {}",
                reg_label,
                attempt_started.elapsed().as_secs(),
                last_err
            ),
            prog_start,
        );
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npm_log_filter_hides_internal_and_per_request_network_noise() {
        assert_eq!(
            npm_log_line_for_display("npm verbose cli /usr/bin/node /usr/bin/npm"),
            None
        );
        assert_eq!(
            npm_log_line_for_display("npm http fetch GET 200 https://registry.npmjs.org/openclaw"),
            None
        );
        assert_eq!(
            npm_log_line_for_display("npm warn deprecated package@1.0.0"),
            Some("npm warn deprecated package@1.0.0".into())
        );
    }

    #[test]
    fn npm_log_line_redacted_keeps_noisy_lines_for_the_raw_diagnostic_console() {
        // The raw console must show verbose/sill/timing lines that the
        // primary progress stream drops, but never at the cost of leaking
        // credentials embedded in a registry URL.
        assert_eq!(
            npm_log_line_redacted("npm verbose cli /usr/bin/node /usr/bin/npm"),
            Some("npm verbose cli /usr/bin/node /usr/bin/npm".into())
        );
        assert_eq!(
            npm_log_line_redacted("npm timing reifyNode:node_modules/openclaw Completed in 45ms"),
            Some("npm timing reifyNode:node_modules/openclaw Completed in 45ms".into())
        );
        assert_eq!(
            npm_log_line_redacted("npm sill fetch https://user:secret@example.com/pkg"),
            Some("npm sill fetch [registry URL redacted]".into())
        );
        assert_eq!(
            npm_log_line_redacted("npm verbose authorization: Bearer secret-value"),
            Some("[authentication details redacted]".into())
        );
        assert!(npm_log_line_is_noisy("npm verbose cli ..."));
        assert!(npm_log_line_is_noisy("npm http fetch GET 200 ..."));
        assert!(npm_log_line_is_http_fetch("npm http fetch GET 200 ..."));
    }

    #[test]
    fn npm_fetch_duration_parser_reads_only_http_fetch_timings() {
        assert_eq!(
            npm_fetch_duration_ms(
                "npm http fetch GET 200 https://cdn.example.test/package.tgz 156841ms (cache miss)"
            ),
            Some(156_841)
        );
        assert_eq!(
            npm_fetch_duration_ms("npm warn deprecated package@1.0.0"),
            None
        );
    }

    #[test]
    fn npm_stream_progress_uses_monotonic_observed_milestones() {
        let progress = NpmStreamProgress::default();
        let resolving = progress.observe("npm sill idealTree buildDeps");
        let first_fetch = progress.observe("npm http fetch GET 200 https://example.test/a 20ms");
        let later_fetch = (0..30)
            .map(|index| progress.observe(&format!("npm http fetch GET 200 package-{index} 20ms")))
            .last()
            .unwrap();
        let lifecycle = progress.observe("> openclaw@2026.7.1-2 postinstall");
        let summary = progress.observe("added 309 packages in 5m");

        assert!(resolving < first_fetch);
        assert!(first_fetch < later_fetch);
        assert!(later_fetch < lifecycle);
        assert!(lifecycle < summary);
        assert_eq!(progress.observe("unrelated output"), summary);
    }

    #[test]
    fn slow_npm_fetch_signal_is_emitted_once_without_leaking_urls() {
        let (tx, rx) = tokio::sync::watch::channel(None::<String>);
        let triggered = AtomicBool::new(false);
        let metrics = Arc::new(Mutex::new(NpmFetchMetrics::default()));
        let line = "npm http fetch GET 200 https://user:secret@example.test/package.tgz 91000ms (cache miss)";

        observe_npm_fetch(
            line,
            "npmmirror.com (China mirror)",
            &tx,
            &triggered,
            &metrics,
        );
        observe_npm_fetch(
            line,
            "npmmirror.com (China mirror)",
            &tx,
            &triggered,
            &metrics,
        );

        let reason = rx.borrow().clone().expect("slow source signal");
        assert!(reason.contains("91000ms"));
        assert!(!reason.contains("example.test"));
        assert!(triggered.load(Ordering::Acquire));
        let summary = npm_fetch_summary("npmmirror.com (China mirror)", &metrics).unwrap();
        assert!(summary.contains("requests=2"));
        assert!(summary.contains("cache misses=2"));
        assert!(summary.contains("slowest=91000ms"));
        assert!(!summary.contains("example.test"));
    }

    #[test]
    fn npm_log_filter_redacts_credentials() {
        assert_eq!(
            npm_log_line_for_display("npm error authorization: Bearer secret-value"),
            Some("[authentication details redacted]".into())
        );
        assert_eq!(
            npm_log_line_for_display("request https://user:secret@example.com/package failed"),
            Some("request [registry URL redacted] failed".into())
        );
    }

    #[test]
    fn npm_log_filter_bounds_untrusted_output() {
        let output = npm_log_line_for_display(&"x".repeat(1_500)).expect("line remains visible");
        assert_eq!(output.chars().count(), 1_001);
        assert!(output.ends_with('…'));
    }

    #[test]
    fn npm_failure_diagnostics_are_bounded_and_already_redacted() {
        let diagnostics = Arc::new(Mutex::new(Vec::new()));
        for index in 0..(NPM_DIAGNOSTIC_LINE_LIMIT + 3) {
            let line =
                npm_log_line_for_display(&format!("npm error spawn git ENOENT {index}")).unwrap();
            record_npm_diagnostic(&diagnostics, &line);
        }
        let text = npm_diagnostic_text(&diagnostics);
        assert_eq!(text.split(" | ").count(), NPM_DIAGNOSTIC_LINE_LIMIT);
        assert!(text.contains("spawn git ENOENT"));
        assert!(!text.contains("secret"));

        let secret = npm_log_line_for_display("npm error authorization: Bearer secret").unwrap();
        record_npm_diagnostic(&diagnostics, &secret);
        assert!(!npm_diagnostic_text(&diagnostics).contains("secret"));
    }
    #[tokio::test]
    async fn npm_process_wait_returns_exit_status() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "process.exit(0)"])
            .spawn()
            .expect("Node.js is required by the desktop build");

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            wait_for_npm_process(
                &mut child,
                std::time::Instant::now() + std::time::Duration::from_secs(10),
            ),
        )
        .await
        .expect("process activity wait must finish within the test deadline");

        assert!(matches!(result, NpmWaitResult::Exited(Ok(status)) if status.success()));
    }

    #[tokio::test]
    async fn quiet_npm_process_can_finish_without_being_killed_for_output_silence() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "setTimeout(() => process.exit(0), 75)"])
            .spawn()
            .expect("Node.js is required by the desktop build");

        let result = wait_for_npm_process(
            &mut child,
            std::time::Instant::now() + std::time::Duration::from_secs(5),
        )
        .await;

        assert!(matches!(result, NpmWaitResult::Exited(Ok(status)) if status.success()));
    }

    #[tokio::test]
    async fn npm_process_wait_enforces_its_absolute_deadline() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "setTimeout(() => {}, 10000)"])
            .spawn()
            .expect("Node.js is required by the desktop build");

        let result = wait_for_npm_process(
            &mut child,
            std::time::Instant::now() + std::time::Duration::from_millis(30),
        )
        .await;

        assert!(matches!(result, NpmWaitResult::DeadlineExceeded));
        let pid = child.id();
        terminate_process_tree(&mut child, pid).await;
    }

    #[test]
    fn npm_activity_message_aggregates_network_and_quiet_status() {
        let message = npm_install_activity_message(
            "npmmirror.com",
            std::time::Duration::from_secs(525),
            std::time::Duration::from_secs(405),
            NpmFetchSnapshot {
                requests: 59,
                slowest_duration_ms: 17_596,
            },
        );

        assert!(message.contains("elapsed 08:45"));
        assert!(message.contains("59 network requests completed"));
        assert!(message.contains("slowest 17596ms"));
        assert!(message.contains("last npm output 06:45 ago"));
    }
}
