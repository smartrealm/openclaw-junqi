//! Verified runtime downloads: mirror fallback, checksum verification,
//! on-disk caching, and archive extraction.

use super::*;

#[cfg(windows)]
pub(super) struct WindowsInstallProgress<'a> {
    pub(super) app: &'a tauri::AppHandle,
    pub(super) step: &'a str,
    pub(super) tool: &'a str,
    pub(super) started_at: std::time::Instant,
    pub(super) progress_start: f64,
    pub(super) progress_end: f64,
}

#[cfg(windows)]
impl<'a> WindowsInstallProgress<'a> {
    pub(super) fn new(
        app: &'a tauri::AppHandle,
        step: &'a str,
        tool: &'a str,
        progress_start: f64,
        progress_end: f64,
    ) -> Self {
        Self {
            app,
            step,
            tool,
            started_at: std::time::Instant::now(),
            progress_start,
            progress_end,
        }
    }

    pub(super) fn progress(&self) -> f64 {
        // Installer APIs do not expose a trustworthy percentage. Keep the
        // progress bar at the phase boundary and expose elapsed time through
        // the heartbeat text instead of presenting a fabricated completion
        // percentage that can look stuck or falsely complete.
        self.progress_start.min(self.progress_end)
    }

    pub(super) fn elapsed(&self) -> String {
        let seconds = self.started_at.elapsed().as_secs();
        format!("{:02}:{:02}", seconds / 60, seconds % 60)
    }

    pub(super) fn report_installer_wait(&self) {
        let elapsed = self.elapsed();
        emit_keyed_with_params(
            self.app,
            self.step,
            &format!("{} installer is running (elapsed {elapsed})", self.tool),
            "setup.windows.installerWaiting",
            &[("tool", self.tool), ("elapsed", &elapsed)],
            self.progress(),
        );
    }

    pub(super) fn report_admin_prompt(&self) {
        emit_keyed_with_params(
            self.app,
            self.step,
            &format!(
                "Waiting for Windows administrator approval before starting the {} installer…",
                self.tool
            ),
            "setup.windows.adminPrompt",
            &[("tool", self.tool)],
            self.progress_start,
        );
    }

    pub(super) fn report_package_manager_wait(&self) {
        let elapsed = self.elapsed();
        emit_keyed_with_params(
            self.app,
            self.step,
            &format!(
                "Windows Package Manager is processing {} (elapsed {elapsed})",
                self.tool
            ),
            "setup.windows.packageManagerWaiting",
            &[("tool", self.tool), ("elapsed", &elapsed)],
            self.progress(),
        );
    }
}

pub(super) struct TemporaryDirectory(pub(super) PathBuf);

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
/// Immutable description of one verified runtime download. The transaction
/// budget is deliberately separate because callers may share it with an
/// installer process and package-manager fallback.
#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
pub(super) struct DownloadRequest<'a> {
    pub(super) app: &'a tauri::AppHandle,
    pub(super) step: &'a str,
    pub(super) sources: &'a [(String, &'static str)],
    pub(super) destination: &'a Path,
    pub(super) expected_sha256: &'a str,
    pub(super) progress: std::ops::Range<f64>,
}

pub(super) fn compact_elapsed(duration: std::time::Duration) -> String {
    let seconds = duration.as_secs();
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let seconds = seconds % 60;
    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

pub(super) fn transfer_rate_mib_per_second(bytes: u64, elapsed: std::time::Duration) -> f64 {
    let seconds = elapsed.as_secs_f64().max(0.001);
    bytes as f64 / 1024.0 / 1024.0 / seconds
}

pub(super) async fn sha256_file(path: &Path) -> Result<(String, u64), String> {
    use tokio::io::AsyncReadExt;

    let mut file = tokio::fs::File::open(path).await.map_err(|error| {
        format!(
            "Failed to open cached runtime artifact {}: {error}",
            path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut size = 0_u64;
    let mut buffer = vec![0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).await.map_err(|error| {
            format!(
                "Failed to read cached runtime artifact {}: {error}",
                path.display()
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size = size.saturating_add(read as u64);
    }
    Ok((format!("{:x}", hasher.finalize()), size))
}

pub(super) fn runtime_download_cache_path(
    destination: &Path,
    expected_sha256: &str,
) -> Option<PathBuf> {
    let filename = destination.file_name()?.to_str()?;
    if filename.is_empty()
        || filename.contains(['/', '\\'])
        || expected_sha256.len() != 64
        || !expected_sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return None;
    }
    Some(
        paths::app_config_dir()
            .join("runtime-download-cache")
            .join(format!(
                "{}-{filename}",
                expected_sha256.to_ascii_lowercase()
            )),
    )
}

pub(super) async fn restore_verified_download_cache(
    cache: &Path,
    destination: &Path,
    expected_sha256: &str,
) -> Result<Option<u64>, String> {
    if !cache.is_file() {
        return Ok(None);
    }
    let (actual, size) = sha256_file(cache).await?;
    if size == 0 || !actual.eq_ignore_ascii_case(expected_sha256) {
        let _ = tokio::fs::remove_file(cache).await;
        return Ok(None);
    }
    tokio::fs::copy(cache, destination).await.map_err(|error| {
        format!(
            "Failed to restore verified runtime artifact cache {}: {error}",
            cache.display()
        )
    })?;
    Ok(Some(size))
}

pub(super) async fn persist_verified_download_cache(cache: &Path, source: &Path) {
    let Some(parent) = cache.parent() else {
        return;
    };
    if tokio::fs::create_dir_all(parent).await.is_err() || cache.is_file() {
        return;
    }
    let temporary = parent.join(format!(".cache-{}", uuid::Uuid::new_v4()));
    if tokio::fs::copy(source, &temporary).await.is_ok() {
        if tokio::fs::rename(&temporary, cache).await.is_err() {
            let _ = tokio::fs::remove_file(&temporary).await;
        }
    }
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
pub(super) async fn download_with_fallback(
    request: DownloadRequest<'_>,
    operation: &SetupOperation,
) -> Result<u64, String> {
    download_with_fallback_with_budget(request, DependencyInstallBudget::new(), operation).await
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
pub(super) async fn download_with_fallback_with_budget(
    request: DownloadRequest<'_>,
    budget: DependencyInstallBudget,
    operation: &SetupOperation,
) -> Result<u64, String> {
    operation.ensure_active()?;
    let DownloadRequest {
        app,
        step,
        sources,
        destination,
        expected_sha256,
        progress,
    } = request;
    let prog_start = progress.start;
    let prog_end = progress.end;
    let cache = runtime_download_cache_path(destination, expected_sha256);
    if let Some(cache) = cache.as_deref() {
        operation.ensure_active()?;
        match restore_verified_download_cache(cache, destination, expected_sha256).await {
            Ok(Some(bytes)) => {
                operation.ensure_active()?;
                record_timeline_note(
                    app,
                    step,
                    &format!(
                        "verified runtime download cache hit: {:.1} MB",
                        bytes as f64 / 1024.0 / 1024.0
                    ),
                );
                emit_coalesced(
                    app,
                    step,
                    &format!(
                        "已复用校验通过的下载缓存（{:.1} MB）",
                        bytes as f64 / 1024.0 / 1024.0
                    ),
                    "download-cache-hit",
                    prog_end,
                );
                return Ok(bytes);
            }
            Ok(None) => {}
            Err(error) => {
                record_timeline_note(
                    app,
                    step,
                    &format!("runtime download cache ignored: {error}"),
                );
                let _ = tokio::fs::remove_file(destination).await;
            }
        }
    }
    let client = reqwest::Client::builder()
        .connect_timeout(RUNTIME_NETWORK_TIMEOUT)
        .timeout(DOWNLOAD_SOURCE_TIMEOUT)
        .user_agent("JunQi Desktop runtime downloader")
        .build()
        .map_err(|error| format!("Failed to initialize downloader: {error}"))?;
    let mut last_error = "no download source responded".to_string();
    let download_run_id = uuid::Uuid::new_v4().simple().to_string();
    for (index, (url, label)) in sources.iter().enumerate() {
        operation.ensure_active()?;
        let log_slot = format!("download-{download_run_id}-{}", index + 1);
        let source_started = std::time::Instant::now();
        // A mirror that stalls or errors out must still leave a trace: without
        // this, hopping to the next source looks identical to a slow single
        // attempt in the timeline log.
        let note_source_failure = |reason: &str| {
            record_timeline_note(
                app,
                step,
                &format!(
                    "{label} failed after {:.1}s: {reason}",
                    source_started.elapsed().as_secs_f64()
                ),
            );
        };
        let attempt = match DownloadAttemptBudget::new(budget) {
            Ok(attempt) => attempt,
            Err(DownloadTimeout::Transaction) => {
                return Err(format!(
                    "下载 {} 超过 30 分钟总时限。最后错误：{}",
                    step, last_error
                ));
            }
            Err(_) => {
                unreachable!("a new download attempt cannot start with an expired source deadline")
            }
        };
        emit_coalesced(
            app,
            step,
            &format!(
                "【下载 {}/{}】正在连接 {}...",
                index + 1,
                sources.len(),
                label
            ),
            &log_slot,
            prog_start,
        );
        let (connect_timeout, connect_limit) = attempt.absolute_remaining().map_err(|timeout| {
            format!(
                "下载 {} 超过 {}。最后错误：{}",
                step,
                download_timeout_message(timeout),
                last_error
            )
        })?;
        let connection = tokio::select! {
            response = tokio::time::timeout(connect_timeout, client.get(url).send()) => response,
            _ = operation.cancelled() => return Err(SETUP_OPERATION_CANCELLED_MESSAGE.into()),
        };
        let mut response = match connection {
            Ok(result) => match result {
                Ok(response) => match response.error_for_status() {
                    Ok(response) => response,
                    Err(error) => {
                        last_error = format!("{label}: {error}");
                        note_source_failure(&error.to_string());
                        continue;
                    }
                },
                Err(error) => {
                    last_error = format!("{label}: {error}");
                    note_source_failure(&error.to_string());
                    continue;
                }
            },
            Err(_) => {
                if matches!(connect_limit, DownloadTimeout::Transaction) {
                    note_source_failure("30-minute transaction deadline exceeded while connecting");
                    return Err(format!(
                        "下载 {} 超过 30 分钟总时限。最后错误：{}",
                        step, last_error
                    ));
                }
                last_error = format!(
                    "{label}: connection exceeded {}",
                    download_timeout_message(connect_limit)
                );
                note_source_failure(&format!(
                    "connection exceeded {}",
                    download_timeout_message(connect_limit)
                ));
                continue;
            }
        };
        let header_elapsed = source_started.elapsed();
        let response_status = response.status();
        let total = response.content_length().unwrap_or(0);
        let response_detail = format!(
            "{label} response headers received in {:.2}s (HTTP {}, content-length={})",
            header_elapsed.as_secs_f64(),
            response_status.as_u16(),
            if total > 0 {
                format!("{:.1} MB", total as f64 / 1024.0 / 1024.0)
            } else {
                "unknown".to_string()
            },
        );
        record_timeline_note(app, step, &response_detail);
        emit_diagnostic(app, step, &response_detail, prog_start);
        let mut file = match tokio::fs::File::create(destination).await {
            Ok(file) => file,
            Err(error) => {
                return Err(format!(
                    "Failed to create {}: {error}",
                    destination.display()
                ));
            }
        };
        if let Err(error) = operation.ensure_active() {
            drop(file);
            let _ = tokio::fs::remove_file(destination).await;
            return Err(error);
        }
        let mut hasher = Sha256::new();
        let mut downloaded = 0_u64;
        let mut last_reported_percent = 0_u64;
        let mut stream_error = None;
        loop {
            let (chunk_timeout, chunk_limit) = match attempt.next_chunk_timeout() {
                Ok(timeout) => timeout,
                Err(DownloadTimeout::Transaction) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(destination).await;
                    return Err(format!(
                        "下载 {} 超过 30 分钟总时限。最后错误：{}",
                        step, last_error
                    ));
                }
                Err(timeout) => {
                    stream_error = Some(format!(
                        "{label}: exceeded {}",
                        download_timeout_message(timeout)
                    ));
                    break;
                }
            };
            let chunk_result = tokio::select! {
                chunk = tokio::time::timeout(chunk_timeout, next_download_chunk(&mut response)) => chunk,
                _ = operation.cancelled() => {
                    drop(file);
                    let _ = tokio::fs::remove_file(destination).await;
                    return Err(SETUP_OPERATION_CANCELLED_MESSAGE.into());
                }
            };
            let chunk = match chunk_result {
                Ok(Ok(Some(chunk))) => chunk,
                Ok(Ok(None)) => break,
                Ok(Err(error)) => {
                    stream_error = Some(error.to_string());
                    break;
                }
                Err(_) => {
                    if matches!(chunk_limit, DownloadTimeout::Transaction) {
                        drop(file);
                        let _ = tokio::fs::remove_file(destination).await;
                        return Err(format!(
                            "下载 {} 超过 30 分钟总时限。最后错误：{}",
                            step, last_error
                        ));
                    }
                    stream_error = Some(format!(
                        "{label}: exceeded {}",
                        download_timeout_message(chunk_limit)
                    ));
                    break;
                }
            };
            if chunk.is_empty() {
                continue;
            }
            use tokio::io::AsyncWriteExt;
            if let Err(error) = file.write_all(&chunk).await {
                return Err(format!(
                    "Failed to write {}: {error}",
                    destination.display()
                ));
            }
            if let Err(error) = operation.ensure_active() {
                drop(file);
                let _ = tokio::fs::remove_file(destination).await;
                return Err(error);
            }
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;

            let percent = downloaded
                .saturating_mul(100)
                .checked_div(total)
                .unwrap_or(downloaded / (5 * 1024 * 1024));
            if percent > last_reported_percent {
                last_reported_percent = percent;
                let fraction = if total > 0 {
                    (downloaded as f64 / total as f64).clamp(0.0, 1.0)
                } else {
                    0.5
                };
                let progress = prog_start + (prog_end - prog_start) * fraction;
                let elapsed = source_started.elapsed();
                let rate = transfer_rate_mib_per_second(downloaded, elapsed);
                let detail = if total > 0 {
                    format!(
                        "【下载 {}/{}】{}：{:.1}/{:.1} MB（{}%，{:.2} MB/s，已用时 {}）",
                        index + 1,
                        sources.len(),
                        label,
                        downloaded as f64 / 1024.0 / 1024.0,
                        total as f64 / 1024.0 / 1024.0,
                        (fraction * 100.0).round() as u64,
                        rate,
                        compact_elapsed(elapsed),
                    )
                } else {
                    format!(
                        "【下载 {}/{}】{}：已下载 {:.1} MB（{:.2} MB/s，已用时 {}）",
                        index + 1,
                        sources.len(),
                        label,
                        downloaded as f64 / 1024.0 / 1024.0,
                        rate,
                        compact_elapsed(elapsed),
                    )
                };
                emit_coalesced(app, step, &detail, &log_slot, progress);
            }
        }
        if let Some(error) = stream_error {
            last_error = format!("{label}: {error}");
            note_source_failure(&error);
            drop(file);
            let _ = tokio::fs::remove_file(destination).await;
            continue;
        }
        if downloaded == 0 {
            last_error = format!("{label}: empty response");
            note_source_failure("empty response");
            drop(file);
            let _ = tokio::fs::remove_file(destination).await;
            continue;
        }
        use tokio::io::AsyncWriteExt;
        if let Err(error) = file.flush().await {
            return Err(format!(
                "Failed to flush {}: {error}",
                destination.display()
            ));
        }
        drop(file);
        operation.ensure_active()?;
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            last_error = format!("{label}: SHA-256 mismatch");
            note_source_failure("SHA-256 mismatch");
            let _ = tokio::fs::remove_file(destination).await;
            continue;
        }
        let completed_elapsed = source_started.elapsed();
        record_timeline_note(
            app,
            step,
            &format!(
                "{label} succeeded after {:.1}s; downloaded {:.1} MB; average {:.2} MB/s",
                completed_elapsed.as_secs_f64(),
                downloaded as f64 / 1024.0 / 1024.0,
                transfer_rate_mib_per_second(downloaded, completed_elapsed),
            ),
        );
        emit_coalesced(
            app,
            step,
            &format!(
                "Download verified via {} ({:.1} MB)",
                label,
                total.max(downloaded) as f64 / 1024.0 / 1024.0
            ),
            &log_slot,
            prog_end,
        );
        if let Some(cache) = cache.as_deref() {
            persist_verified_download_cache(cache, destination).await;
        }
        return Ok(downloaded);
    }
    Err(format!("所有下载源均失败。最后错误：{last_error}"))
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
pub(super) fn extract_zip(
    app: &tauri::AppHandle,
    step: &str,
    archive: &Path,
    dest: &Path,
    strip_top_level: bool,
    progress: f64,
    operation: &SetupOperation,
) -> Result<(), String> {
    operation.ensure_active()?;
    let file =
        std::fs::File::open(archive).map_err(|error| format!("Failed to open archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Failed to read zip archive: {error}"))?;
    emit(
        app,
        step,
        &format!("Extracting {} files...", archive.len()),
        progress,
    );
    let total_entries = archive.len().max(1);
    let mut last_reported_percent = 0_usize;
    for index in 0..archive.len() {
        operation.ensure_active()?;
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(mut relative) = entry.enclosed_name() else {
            continue;
        };
        if strip_top_level {
            relative = relative.components().skip(1).collect();
            if relative.as_os_str().is_empty() {
                continue;
            }
        }
        let output = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut file = std::fs::File::create(&output)
                .map_err(|error| format!("Failed to create {}: {error}", output.display()))?;
            std::io::copy(&mut entry, &mut file)
                .map_err(|error| format!("Failed to extract {}: {error}", output.display()))?;
        }
        let percent = (index + 1) * 100 / total_entries;
        if percent >= last_reported_percent + 5 || index + 1 == total_entries {
            last_reported_percent = percent;
            emit(
                app,
                step,
                &format!(
                    "Extracting files: {}/{} ({}%)",
                    index + 1,
                    total_entries,
                    percent
                ),
                progress + (1.0 - progress) * (percent as f64 / 100.0) * 0.35,
            );
        }
    }
    Ok(())
}

pub(super) fn extract_tar_gz(
    app: &tauri::AppHandle,
    step: &str,
    archive: &Path,
    dest: &Path,
    progress: f64,
    operation: &SetupOperation,
) -> Result<(), String> {
    operation.ensure_active()?;
    let file =
        std::fs::File::open(archive).map_err(|error| format!("Failed to open archive: {error}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    emit(app, step, "Extracting Node.js runtime...", progress);
    let entries = archive
        .entries()
        .map_err(|error| format!("Failed to inspect Node.js archive: {error}"))?;
    let mut extracted = 0_usize;
    for entry in entries {
        operation.ensure_active()?;
        entry
            .map_err(|error| format!("Failed to read Node.js archive entry: {error}"))?
            .unpack_in(dest)
            .map_err(|error| format!("Failed to extract Node.js archive: {error}"))?;
        extracted += 1;
        if extracted.is_multiple_of(128) {
            emit(
                app,
                step,
                &format!("Extracting Node.js runtime: {extracted} archive entries processed"),
                progress,
            );
        }
    }
    Ok(())
}

#[cfg(any(windows, target_os = "macos"))]
pub(super) async fn extract_node_archive(
    app: &tauri::AppHandle,
    archive: &Path,
    stage_container: &Path,
    version: &str,
    platform: ManagedNodePlatform,
    operation: &SetupOperation,
) -> Result<PathBuf, String> {
    operation.ensure_active()?;
    match platform.archive_format {
        NodeArchiveFormat::Zip => {
            tokio::task::block_in_place(|| {
                extract_zip(app, "node", archive, stage_container, true, 0.65, operation)
            })?;
            Ok(stage_container.to_path_buf())
        }
        NodeArchiveFormat::TarGz => {
            tokio::task::block_in_place(|| {
                extract_tar_gz(app, "node", archive, stage_container, 0.65, operation)
            })?;
            let top_level = platform
                .extracted_root(version)
                .ok_or("The Node.js platform model did not provide an extracted root")?;
            let extracted = stage_container.join(top_level);
            if !extracted.is_dir() {
                return Err("Downloaded Node.js archive has an unexpected directory layout".into());
            }
            Ok(extracted)
        }
    }
}
