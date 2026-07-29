//! Generic npm process driver: output redaction, fetch metrics, live progress,
//! and process supervision. Carries no knowledge of any particular package.

use super::*;

// ─── npm install with registry fallback ───────────────────────────────────────

pub(super) const NPM_SLOW_FETCH_THRESHOLD: std::time::Duration = std::time::Duration::from_secs(90);
pub(super) const NPM_DIAGNOSTIC_LINE_LIMIT: usize = 24;

pub(super) const NPM_NOISY_LOG_PREFIXES: &[&str] = &[
    "npm verbose",
    "npm sill",
    "npm timing",
    "npm notice",
    NPM_HTTP_LOG_PREFIX,
];

/// npm reports every per-request HTTP outcome under this prefix, using a
/// separate verb per outcome (`fetch` for a transfer, `cache` for a cache
/// hit). Matching the family rather than one verb keeps a fully cached
/// install from flooding the console with hundreds of per-package rows.
pub(super) const NPM_HTTP_LOG_PREFIX: &str = "npm http ";

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

pub(super) fn npm_log_line_is_http_telemetry(line: &str) -> bool {
    line.trim()
        .to_ascii_lowercase()
        .starts_with(NPM_HTTP_LOG_PREFIX)
}

#[derive(Default)]
pub(super) struct NpmStreamProgress {
    pub(super) milestone: AtomicUsize,
    pub(super) http_requests: AtomicUsize,
}

impl NpmStreamProgress {
    pub(super) fn observe(&self, line: &str) -> f64 {
        let lower = line.trim().to_ascii_lowercase();
        let candidate = if npm_log_line_is_http_telemetry(&lower) {
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
    if !npm_log_line_is_http_telemetry(line) {
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
    Cancelled,
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
    wait_for_npm_process_with_slow_signal(child, &mut slow_fetch_rx, deadline, None).await
}

async fn wait_for_npm_cancellation(cancellation: Option<&SetupOperationCancellation>) {
    match cancellation {
        Some(cancellation) => cancellation.cancelled().await,
        None => std::future::pending::<()>().await,
    }
}

pub(super) async fn wait_for_npm_process_with_slow_signal(
    child: &mut tokio::process::Child,
    slow_fetch: &mut tokio::sync::watch::Receiver<Option<String>>,
    deadline: std::time::Instant,
    cancellation: Option<&SetupOperationCancellation>,
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
            _ = wait_for_npm_cancellation(cancellation) => return NpmWaitResult::Cancelled,
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
        assert!(npm_log_line_is_http_telemetry("npm http fetch GET 200 ..."));
    }

    #[test]
    fn npm_http_telemetry_covers_every_per_request_verb() {
        // A fully cached install reports `npm http cache`, never
        // `npm http fetch`. Both are per-request rows the console must drop in
        // favour of the coalesced network summary.
        assert!(npm_log_line_is_http_telemetry(
            "npm http cache openclaw@https://registry.example.test/openclaw.tgz 0ms (cache hit)"
        ));
        assert!(npm_log_line_is_noisy(
            "npm http cache openclaw@https://registry.example.test/openclaw.tgz 0ms (cache hit)"
        ));
        assert!(!npm_log_line_is_http_telemetry(
            "npm warn deprecated package@1.0.0"
        ));
    }

    #[test]
    fn npm_fetch_duration_parser_reads_only_http_timings() {
        assert_eq!(
            npm_fetch_duration_ms(
                "npm http fetch GET 200 https://cdn.example.test/package.tgz 156841ms (cache miss)"
            ),
            Some(156_841)
        );
        assert_eq!(
            npm_fetch_duration_ms(
                "npm http cache openclaw@https://registry.example.test/openclaw.tgz 0ms (cache hit)"
            ),
            Some(0)
        );
        assert_eq!(
            npm_fetch_duration_ms("npm warn deprecated package@1.0.0"),
            None
        );
    }

    #[test]
    fn npm_fetch_metrics_count_cache_hits_from_cached_installs() {
        // A cache-hit-only install used to report requests=0: its rows never
        // matched the fetch-only parser, so the summary claimed no network
        // activity at all.
        let (tx, _rx) = tokio::sync::watch::channel(None::<String>);
        let triggered = AtomicBool::new(false);
        let metrics = Arc::new(Mutex::new(NpmFetchMetrics::default()));

        observe_npm_fetch(
            "npm http cache openclaw@https://registry.example.test/openclaw.tgz 0ms (cache hit)",
            "npmmirror.com (China mirror)",
            &tx,
            &triggered,
            &metrics,
        );

        let summary = npm_fetch_summary("npmmirror.com (China mirror)", &metrics).unwrap();
        assert!(summary.contains("requests=1"), "{summary}");
        assert!(summary.contains("cache hits=1"), "{summary}");
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

    #[tokio::test]
    async fn npm_process_wait_stops_on_scoped_setup_cancellation() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "setTimeout(() => {}, 10000)"])
            .spawn()
            .expect("Node.js is required by the desktop build");
        let cancellation = SetupOperationCancellation::new();
        cancellation.request();
        let (_slow_fetch_tx, mut slow_fetch_rx) = tokio::sync::watch::channel(None);

        let result = wait_for_npm_process_with_slow_signal(
            &mut child,
            &mut slow_fetch_rx,
            std::time::Instant::now() + std::time::Duration::from_secs(5),
            Some(&cancellation),
        )
        .await;

        assert!(matches!(result, NpmWaitResult::Cancelled));
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
