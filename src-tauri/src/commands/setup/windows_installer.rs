//! Windows elevated-installer plumbing: MSI command lines, process launch
//! and supervision, and winget package operations.
//!
//! Every item is `#[cfg(windows)]` or `#[cfg(any(windows, test))]`, so the
//! module compiles down to nothing on macOS and Linux release builds.

#[allow(unused_imports)]
use super::*;

#[cfg(windows)]
pub(super) fn platform_path(primary: &str, fallback: &str) -> Option<PathBuf> {
    let primary = platform::detect_path(primary);
    let path = if primary.is_empty() {
        platform::detect_path(fallback)
    } else {
        primary
    };
    (!path.is_empty()).then(|| PathBuf::from(path))
}

/// Structured MSI invocation keeps option tokens and path values separate
/// until the final ShellExecuteExW boundary. ShellExecuteExW accepts one
/// parameter string, so quoting every argument is tempting but makes the
/// native invocation diverge from Microsoft's documented `msiexec` form.
/// This type owns the canonical ordering and leaves switches unquoted.
#[cfg(any(windows, test))]
pub(super) struct WindowsMsiInvocation {
    pub(super) package: PathBuf,
    pub(super) verbose_log: PathBuf,
}

#[cfg(any(windows, test))]
impl WindowsMsiInvocation {
    pub(super) fn quiet_install(package: &Path, verbose_log: &Path) -> Self {
        Self {
            package: package.to_path_buf(),
            verbose_log: verbose_log.to_path_buf(),
        }
    }

    pub(super) fn arguments(&self) -> Vec<std::ffi::OsString> {
        vec![
            std::ffi::OsString::from("/i"),
            self.package.clone().into_os_string(),
            std::ffi::OsString::from("/qn"),
            std::ffi::OsString::from("/norestart"),
            std::ffi::OsString::from("/L*V"),
            self.verbose_log.clone().into_os_string(),
        ]
    }
}

/// Quote a single Windows command-line value only when its contents require
/// it. This is the standard backslash-before-quote encoding used by Windows
/// process creation APIs and preserves path boundaries without quoting option
/// switches such as `/i` and `/qn`.
#[cfg(any(windows, test))]
pub(super) fn quote_windows_command_line_value(value: &str) -> String {
    if !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return value.to_string();
    }

    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    let mut backslashes = 0_usize;
    for character in value.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }
        if character == '"' {
            quoted.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
        } else {
            quoted.extend(std::iter::repeat_n('\\', backslashes));
        }
        quoted.push(character);
        backslashes = 0;
    }
    quoted.extend(std::iter::repeat_n('\\', backslashes * 2));
    quoted.push('"');
    quoted
}

#[cfg(windows)]
pub(super) fn windows_installer_command_line(
    args: &[std::ffi::OsString],
) -> Result<Vec<u16>, String> {
    use std::os::windows::ffi::OsStrExt;

    let values = args
        .iter()
        .map(|arg| {
            let units = arg.as_os_str().encode_wide().collect::<Vec<_>>();
            if units.contains(&0) {
                return Err("Windows installer argument contains a NUL character".to_string());
            }
            String::from_utf16(&units)
                .map_err(|_| "Windows installer argument is not valid UTF-16".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let command_line = values
        .iter()
        .map(|value| quote_windows_command_line_value(value))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(command_line
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect())
}

#[cfg(windows)]
pub(super) fn windows_installer_display_command(
    executable: &Path,
    args: &[std::ffi::OsString],
) -> Result<String, WindowsInstallerFailure> {
    let parameters = windows_installer_command_line(args)
        .map_err(WindowsInstallerFailure::source_unavailable)?;
    let parameters = String::from_utf16(&parameters[..parameters.len().saturating_sub(1)])
        .map_err(|_| {
            WindowsInstallerFailure::source_unavailable(
                "Windows installer command line is not valid UTF-16",
            )
        })?;
    Ok(format!(
        "{} {}",
        quote_windows_command_line_value(&executable.display().to_string()),
        parameters
    ))
}

#[cfg(any(windows, test))]
#[derive(Debug)]
pub(super) enum WindowsInstallerFailure {
    SourceUnavailable(String),
    RuntimeUnavailable(String),
    InstallerFailed(String),
    Cancelled(String),
    CleanupIncomplete(String),
}

#[cfg(any(windows, test))]
impl WindowsInstallerFailure {
    pub(super) fn source_unavailable(message: impl Into<String>) -> Self {
        Self::SourceUnavailable(message.into())
    }

    pub(super) fn runtime_unavailable(message: impl Into<String>) -> Self {
        Self::RuntimeUnavailable(message.into())
    }

    pub(super) fn installer_failed(message: impl Into<String>) -> Self {
        Self::InstallerFailed(message.into())
    }

    pub(super) fn cancelled(message: impl Into<String>) -> Self {
        Self::Cancelled(message.into())
    }

    pub(super) fn cleanup_incomplete(message: impl Into<String>) -> Self {
        Self::CleanupIncomplete(message.into())
    }

    #[cfg(windows)]
    pub(super) fn with_context(self, context: impl Into<String>) -> Self {
        let context = context.into();
        match self {
            Self::SourceUnavailable(message) => {
                Self::SourceUnavailable(format!("{message}; {context}"))
            }
            Self::RuntimeUnavailable(message) => {
                Self::RuntimeUnavailable(format!("{message}; {context}"))
            }
            Self::InstallerFailed(message) => {
                Self::InstallerFailed(format!("{message}; {context}"))
            }
            Self::Cancelled(message) => Self::Cancelled(format!("{message}; {context}")),
            Self::CleanupIncomplete(message) => {
                Self::CleanupIncomplete(format!("{message}; {context}"))
            }
        }
    }

    pub(super) fn permits_package_manager_fallback(&self) -> bool {
        matches!(self, Self::SourceUnavailable(_))
    }

    pub(super) fn permits_runtime_channel_fallback(&self) -> bool {
        matches!(self, Self::RuntimeUnavailable(_))
    }

    pub(super) fn requires_runtime_recheck(&self) -> bool {
        matches!(self, Self::InstallerFailed(_))
    }

    #[cfg(windows)]
    pub(super) fn is_interrupted(&self) -> bool {
        matches!(self, Self::Cancelled(_) | Self::CleanupIncomplete(_))
    }

    pub(super) fn message(&self) -> &str {
        match self {
            Self::SourceUnavailable(message)
            | Self::RuntimeUnavailable(message)
            | Self::InstallerFailed(message)
            | Self::Cancelled(message)
            | Self::CleanupIncomplete(message) => message,
        }
    }

    #[cfg(windows)]
    pub(super) fn into_message(self) -> String {
        match self {
            Self::SourceUnavailable(message)
            | Self::RuntimeUnavailable(message)
            | Self::InstallerFailed(message)
            | Self::Cancelled(message)
            | Self::CleanupIncomplete(message) => message,
        }
    }

    #[cfg(windows)]
    pub(super) fn from_wait_error(operation: &str, error: ControlledProcessWaitError) -> Self {
        match error {
            ControlledProcessWaitError::Monitoring(message) => Self::installer_failed(message),
            ControlledProcessWaitError::Cancelled => Self::cancelled(format!(
                "{operation} was cancelled after JunQi stopped its process tree"
            )),
            ControlledProcessWaitError::TimedOut => {
                Self::installer_failed(format!("{operation} timed out after its allotted wait"))
            }
            ControlledProcessWaitError::CleanupIncomplete(message) => Self::cleanup_incomplete(
                format!(
                    "{operation} timed out and JunQi could not confirm that its process tree stopped: {message}. A fallback installer will not be started."
                ),
            ),
        }
    }

    #[cfg(windows)]
    pub(super) fn from_output_failure(error: ProcessOutputFailure) -> Self {
        match error {
            ProcessOutputFailure::Read(message) => Self::installer_failed(message),
            ProcessOutputFailure::DidNotClose(message) => Self::cleanup_incomplete(format!(
                "{message}. A fallback installer will not be started because a descendant process may still be running."
            )),
        }
    }
}

#[cfg(any(windows, test))]
pub(super) fn windows_installer_exit_succeeded(exit_code: u32) -> bool {
    // ERROR_SUCCESS_REBOOT_INITIATED (1641) and
    // ERROR_SUCCESS_REBOOT_REQUIRED (3010) are successful MSI outcomes.
    matches!(exit_code, 0 | 1641 | 3010)
}

#[cfg(any(windows, test))]
pub(super) fn windows_installer_exit_failure(
    tool: &str,
    exit_code: u32,
) -> WindowsInstallerFailure {
    let detail = match exit_code {
        1603 => "Windows Installer reported a fatal installation error",
        1618 => "another Windows Installer transaction is already running",
        1639 => "Windows Installer rejected an invalid command line; review the recorded elevated installer command",
        1638 => "another version of this product is already installed",
        _ => "the elevated installer reported a non-success result",
    };
    WindowsInstallerFailure::installer_failed(format!(
        "{tool} installer exited with code {exit_code}: {detail}"
    ))
}

/// Reconcile a completed elevated installer with the runtime contract it was
/// supposed to provide. Once an installer process has started, its failure is
/// never treated like a transport failure: Windows may publish PATH/registry
/// state after the parent exits, and starting winget immediately can race the
/// same MSI or display a second UAC prompt.
#[cfg(windows)]
pub(super) async fn reconcile_windows_installer_runtime<T, Verify, VerifyFuture>(
    app: &tauri::AppHandle,
    step: &str,
    tool: &str,
    installer_result: Result<(), WindowsInstallerFailure>,
    verify: Verify,
) -> Result<T, WindowsInstallerFailure>
where
    Verify: FnOnce() -> VerifyFuture,
    VerifyFuture: std::future::Future<Output = Result<T, WindowsInstallerFailure>>,
{
    match installer_result {
        Ok(()) => verify().await,
        Err(error) if error.requires_runtime_recheck() => {
            emit(
                app,
                step,
                &format!(
                    "{tool} installer result requires runtime verification before any fallback: {}",
                    error.message()
                ),
                0.93,
            );
            match verify().await {
                Ok(runtime) => {
                    emit(
                        app,
                        step,
                        &format!(
                            "{tool} runtime is ready despite the installer result; package-manager fallback was skipped"
                        ),
                        0.96,
                    );
                    Ok(runtime)
                }
                Err(verification_error) if verification_error.is_interrupted() => {
                    Err(verification_error)
                }
                Err(verification_error) => Err(error.with_context(format!(
                    "runtime verification failed: {}. JunQi did not start a second installer",
                    verification_error.into_message()
                ))),
            }
        }
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
pub(super) fn preserve_windows_installer_log(
    app: &tauri::AppHandle,
    path: &Path,
    tool: &str,
) -> Result<Option<PathBuf>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let destination = diagnostic_artifact_path(
        app,
        tool,
        &format!("{}-{}.log", tool.to_ascii_lowercase(), uuid::Uuid::new_v4()),
    )?;
    std::fs::copy(path, &destination).map_err(|error| {
        format!(
            "Failed to preserve the {tool} native installer log at {}: {error}",
            destination.display()
        )
    })?;
    Ok(Some(destination))
}

#[cfg(windows)]
pub(super) fn dependency_install_windows_failure(error: String) -> WindowsInstallerFailure {
    if error == DEPENDENCY_INSTALL_CANCELLED_MESSAGE {
        WindowsInstallerFailure::cancelled(error)
    } else {
        WindowsInstallerFailure::source_unavailable(error)
    }
}

#[cfg(any(windows, test))]
impl From<String> for WindowsInstallerFailure {
    fn from(message: String) -> Self {
        Self::source_unavailable(message)
    }
}

#[cfg(windows)]
pub(super) struct ElevatedWindowsProcess {
    pub(super) handle: isize,
    pub(super) pid: u32,
    pub(super) completed: bool,
    pub(super) exit_code: Option<u32>,
}

#[cfg(windows)]
impl ElevatedWindowsProcess {
    pub(super) fn raw_handle(&self) -> windows_sys::Win32::Foundation::HANDLE {
        self.handle as windows_sys::Win32::Foundation::HANDLE
    }

    pub(super) fn poll_exit_code(&mut self) -> Result<Option<u32>, String> {
        use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};

        match unsafe { WaitForSingleObject(self.raw_handle(), 0) } {
            WAIT_TIMEOUT => Ok(None),
            WAIT_OBJECT_0 => {
                let mut exit_code = 0_u32;
                if unsafe { GetExitCodeProcess(self.raw_handle(), &mut exit_code) } == 0 {
                    Err(format!(
                        "Could not read the elevated installer exit code: {}",
                        std::io::Error::last_os_error()
                    ))
                } else {
                    self.completed = true;
                    self.exit_code = Some(exit_code);
                    Ok(Some(exit_code))
                }
            }
            _ => Err(format!(
                "Failed while waiting for the elevated installer: {}",
                std::io::Error::last_os_error()
            )),
        }
    }

    pub(super) async fn terminate_and_reap(&mut self) -> Result<(), String> {
        let tree_termination = if self.pid == 0 {
            Err("The elevated installer did not expose a process ID for tree cleanup".into())
        } else {
            terminate_windows_process_tree(self.pid).await
        };
        let handle = self.handle;
        let root_reaped = tokio::task::spawn_blocking(move || {
            use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
            use windows_sys::Win32::System::Threading::{TerminateProcess, WaitForSingleObject};

            let handle = handle as windows_sys::Win32::Foundation::HANDLE;
            if unsafe { WaitForSingleObject(handle, 0) } == WAIT_TIMEOUT
                && unsafe { TerminateProcess(handle, 1) } == 0
            {
                return Err(format!(
                    "Failed to terminate the elevated installer process: {}",
                    std::io::Error::last_os_error()
                ));
            }
            match unsafe {
                WaitForSingleObject(handle, PROCESS_REAP_TIMEOUT.as_millis() as u32)
            } {
                WAIT_OBJECT_0 => Ok(()),
                WAIT_TIMEOUT => Err(format!(
                    "The elevated installer process did not exit within {} seconds after termination",
                    PROCESS_REAP_TIMEOUT.as_secs()
                )),
                _ => Err(format!(
                    "Failed while reaping the elevated installer process: {}",
                    std::io::Error::last_os_error()
                )),
            }
        })
        .await
        .map_err(|error| format!("Installer cleanup task failed: {error}"))?;

        match (tree_termination, root_reaped) {
            (Ok(()), Ok(())) => {
                self.completed = true;
                Ok(())
            }
            (Err(tree_error), Ok(())) if process_tree_was_already_gone(&tree_error) => {
                self.completed = true;
                Ok(())
            }
            (Err(tree_error), Ok(())) => Err(format!(
                "The elevated installer process exited, but its process-tree cleanup was not confirmed: {tree_error}"
            )),
            (Ok(()), Err(root_error)) => Err(root_error),
            (Err(tree_error), Err(root_error)) => Err(format!("{tree_error}; {root_error}")),
        }
    }
}

#[cfg(windows)]
impl Drop for ElevatedWindowsProcess {
    fn drop(&mut self) {
        if !self.completed {
            if self.pid != 0 {
                request_windows_process_tree_termination(self.pid);
            }
            if self.handle != 0 {
                unsafe {
                    let _ = windows_sys::Win32::System::Threading::TerminateProcess(
                        self.raw_handle(),
                        1,
                    );
                }
            }
        }
        if self.handle != 0 {
            unsafe {
                let _ = windows_sys::Win32::Foundation::CloseHandle(self.raw_handle());
            }
        }
    }
}

#[cfg(windows)]
pub(super) async fn launch_elevated_windows_process(
    executable: &Path,
    args: &[std::ffi::OsString],
    label: &str,
) -> Result<ElevatedWindowsProcess, WindowsInstallerFailure> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Threading::GetProcessId;
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let executable = executable.to_path_buf();
    let args = args.to_vec();
    let task_label = label.to_owned();
    tokio::task::spawn_blocking(move || {
        let mut executable_wide = executable.as_os_str().encode_wide().collect::<Vec<_>>();
        if executable_wide.contains(&0) {
            return Err(WindowsInstallerFailure::source_unavailable(format!(
                "Invalid {task_label} installer path"
            )));
        }
        executable_wide.push(0);
        let parameters = windows_installer_command_line(&args)
            .map_err(WindowsInstallerFailure::source_unavailable)?;
        let verb = "runas\0".encode_utf16().collect::<Vec<_>>();
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = executable_wide.as_ptr();
        info.lpParameters = parameters.as_ptr();
        info.nShow = SW_SHOWNORMAL;

        if unsafe { ShellExecuteExW(&mut info) } == 0 {
            let error = std::io::Error::last_os_error();
            return Err(if error.raw_os_error() == Some(1223) {
                WindowsInstallerFailure::cancelled(format!(
                    "{task_label} installation was cancelled at the Windows administrator prompt"
                ))
            } else {
                WindowsInstallerFailure::source_unavailable(format!(
                    "Failed to start elevated {task_label} installer: {error}"
                ))
            });
        }
        if info.hProcess.is_null() {
            return Err(WindowsInstallerFailure::source_unavailable(format!(
                "The elevated {task_label} installer did not return a process handle"
            )));
        }

        Ok(ElevatedWindowsProcess {
            handle: info.hProcess as isize,
            pid: unsafe { GetProcessId(info.hProcess) },
            completed: false,
            exit_code: None,
        })
    })
    .await
    .map_err(|error| {
        WindowsInstallerFailure::source_unavailable(format!(
            "{label} installer task failed: {error}"
        ))
    })?
}

#[cfg(windows)]
pub(super) async fn wait_for_elevated_windows_process(
    process: &mut ElevatedWindowsProcess,
    policy: ControlledProcessPolicy,
    progress: &WindowsInstallProgress<'_>,
    operation: &DependencyInstallOperation,
) -> Result<(), WindowsInstallerFailure> {
    let deadline = std::time::Instant::now() + policy.timeout;
    progress.report_installer_wait();
    loop {
        if operation.cancellation_requested() {
            let cleanup = process.terminate_and_reap().await;
            return match cleanup {
                Ok(()) => Err(WindowsInstallerFailure::cancelled(format!(
                    "{} installer was cancelled after JunQi stopped its process tree",
                    progress.tool
                ))),
                Err(error) => Err(WindowsInstallerFailure::cleanup_incomplete(format!(
                    "{} installer cancellation could not confirm process-tree cleanup: {error}",
                    progress.tool
                ))),
            };
        }
        match process.poll_exit_code() {
            Ok(Some(exit_code)) if windows_installer_exit_succeeded(exit_code) => return Ok(()),
            Ok(Some(exit_code)) => {
                return Err(windows_installer_exit_failure(progress.tool, exit_code));
            }
            Ok(None) => {}
            Err(error) => {
                let cleanup = process.terminate_and_reap().await;
                return match cleanup {
                    Ok(()) => Err(WindowsInstallerFailure::installer_failed(error)),
                    Err(cleanup_error) => Err(WindowsInstallerFailure::cleanup_incomplete(
                        format!("{error}; {cleanup_error}"),
                    )),
                };
            }
        }

        let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) else {
            let cleanup = process.terminate_and_reap().await;
            return match cleanup {
                Ok(()) => Err(WindowsInstallerFailure::installer_failed(format!(
                    "{} installer timed out after {} seconds",
                    progress.tool,
                    policy.timeout.as_secs()
                ))),
                Err(error) => Err(WindowsInstallerFailure::cleanup_incomplete(format!(
                    "{} installer timed out after {} seconds; {error}",
                    progress.tool,
                    policy.timeout.as_secs()
                ))),
            };
        };

        let sleep_for = remaining.min(policy.heartbeat_interval);
        tokio::select! {
            _ = tokio::time::sleep(sleep_for) => {}
            _ = operation.cancelled() => {}
        }
        if sleep_for == policy.heartbeat_interval {
            progress.report_installer_wait();
        }
    }
}

#[cfg(windows)]
pub(super) async fn run_windows_installer(
    executable: &Path,
    args: &[std::ffi::OsString],
    policy: ControlledProcessPolicy,
    progress: WindowsInstallProgress<'_>,
    operation: &DependencyInstallOperation,
) -> Result<(), WindowsInstallerFailure> {
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let invocation = windows_installer_display_command(executable, args)?;
    emit_diagnostic(
        progress.app,
        progress.step,
        &format!(
            "Launching elevated {} installer: {invocation}",
            progress.tool
        ),
        progress.progress(),
    );
    record_timeline_note(
        progress.app,
        progress.step,
        &format!("elevated installer command: {invocation}"),
    );
    progress.report_admin_prompt();
    let started = std::time::Instant::now();
    let mut process = launch_elevated_windows_process(executable, args, progress.tool).await?;
    record_process_started(
        progress.app,
        progress.step,
        progress.tool,
        Some(process.pid),
        "elevated Windows installer",
    );
    // ShellExecuteExW may be blocked by the Windows UAC dialog. A cancel
    // request is retained by the coordinator while that OS call is pending;
    // once it yields a process handle, this wait immediately terminates and
    // reaps the installer tree instead of allowing setup to continue.
    let result =
        wait_for_elevated_windows_process(&mut process, policy, &progress, operation).await;
    record_process_finished(
        progress.app,
        progress.step,
        progress.tool,
        Some(process.pid),
        process.exit_code.map(i64::from),
        started.elapsed(),
    );
    result.map_err(|error| error.with_context(format!("installer command: {invocation}")))
}

#[cfg(windows)]
pub(super) fn collect_process_output<R>(
    reader: R,
    app: tauri::AppHandle,
    step: String,
    process: String,
    stream: &'static str,
    progress: f64,
) -> tokio::task::JoinHandle<Result<Vec<u8>, std::io::Error>>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};

        const CAPTURE_LIMIT: usize = 1024 * 1024;
        let mut bytes = Vec::new();
        let mut reader = BufReader::new(reader);
        let mut line = Vec::new();
        loop {
            line.clear();
            let read = reader.read_until(b'\n', &mut line).await?;
            if read == 0 {
                break;
            }
            let remaining = CAPTURE_LIMIT.saturating_sub(bytes.len());
            bytes.extend_from_slice(&line[..line.len().min(remaining)]);
            let output = String::from_utf8_lossy(&line);
            record_process_output(&app, &step, &process, stream, &output);
            let display = crate::commands::diagnostic_output::sanitize_diagnostic_line(&output);
            if !display.is_empty() {
                emit_diagnostic(
                    &app,
                    &step,
                    &format!("winget {stream} › {display}"),
                    progress,
                );
            }
        }
        Ok(bytes)
    })
}

#[cfg(windows)]
pub(super) async fn finish_process_output(
    stream: &str,
    task: Option<tokio::task::JoinHandle<Result<Vec<u8>, std::io::Error>>>,
) -> Result<Vec<u8>, ProcessOutputFailure> {
    let Some(mut task) = task else {
        return Ok(Vec::new());
    };
    match tokio::time::timeout(PROCESS_REAP_TIMEOUT, &mut task).await {
        Ok(Ok(Ok(bytes))) => Ok(bytes),
        Ok(Ok(Err(error))) => Err(ProcessOutputFailure::Read(format!(
            "Failed to read installer {stream}: {error}"
        ))),
        Ok(Err(error)) => Err(ProcessOutputFailure::Read(format!(
            "Installer {stream} reader task failed: {error}"
        ))),
        Err(_) => {
            task.abort();
            Err(ProcessOutputFailure::DidNotClose(format!(
                "Installer {stream} did not close within {} seconds after the process exited",
                PROCESS_REAP_TIMEOUT.as_secs()
            )))
        }
    }
}

#[cfg(windows)]
#[derive(Debug)]
pub(super) enum ProcessOutputFailure {
    Read(String),
    DidNotClose(String),
}

/// `Child::kill_on_drop` only reaches the winget launcher. Keep a separate
/// cancellation guard for its installer descendants so an IPC task cancelled
/// during app shutdown cannot leave a package operation behind.
#[cfg(windows)]
pub(super) struct WindowsChildTreeCancellationGuard {
    pub(super) pid: Option<u32>,
    pub(super) armed: bool,
}

#[cfg(windows)]
impl WindowsChildTreeCancellationGuard {
    pub(super) fn new(pid: Option<u32>) -> Self {
        Self { pid, armed: true }
    }

    pub(super) fn disarm(&mut self) {
        self.armed = false;
    }
}

#[cfg(windows)]
impl Drop for WindowsChildTreeCancellationGuard {
    fn drop(&mut self) {
        if self.armed {
            if let Some(pid) = self.pid {
                request_windows_process_tree_termination(pid);
            }
        }
    }
}

#[cfg(windows)]
pub(super) async fn ensure_winget_package(
    app: &tauri::AppHandle,
    step: &str,
    tool: &str,
    package_id: &str,
    budget: DependencyInstallBudget,
    operation: &DependencyInstallOperation,
) -> Result<(), WindowsInstallerFailure> {
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let winget = platform::detect_path("winget");
    if winget.is_empty() {
        return Err(WindowsInstallerFailure::source_unavailable(
            "Windows Package Manager (winget) is unavailable. Install the dependency with its standard system installer or select an explicit portable runtime directory in JunQi.",
        ));
    }
    // `winget upgrade` is not an installation contract: it exits successfully
    // when the package is absent, already current, or owned by another source.
    // That was the reason a machine could remain on Node.js 20 after JunQi had
    // reported a successful LTS operation. Use one idempotent, forced install
    // and let the caller validate the resulting executable contract before any
    // channel fallback is considered.
    let progress = WindowsInstallProgress::new(app, step, tool, 0.62, 0.92);
    let install = run_winget_package_command(
        &winget,
        package_id,
        budget.process_policy(&format!("winget install for {package_id}"))?,
        &progress,
        operation,
    )
    .await?;
    // Persist winget's own output regardless of outcome: a successful-but-slow
    // install still needs its "Downloading"/"Installing" lines to see where
    // the time went, and they would otherwise only surface on failure.
    let diagnostic = windows_package_manager_output(&install);
    if !diagnostic.is_empty() {
        record_timeline_note(
            app,
            step,
            &format!("winget install {package_id} output: {diagnostic}"),
        );
    }
    if install.status.success() {
        return Ok(());
    }
    Err(WindowsInstallerFailure::source_unavailable(
        if diagnostic.is_empty() {
            format!("winget could not install {package_id}")
        } else {
            format!("winget could not install {package_id}: {diagnostic}")
        },
    ))
}

#[cfg(windows)]
pub(super) fn windows_package_manager_output(output: &std::process::Output) -> String {
    let raw = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout).trim(),
        String::from_utf8_lossy(&output.stderr).trim()
    );
    crate::commands::diagnostic_output::sanitize_diagnostic_text(raw.trim(), 1_200)
}

#[cfg(windows)]
pub(super) async fn run_winget_package_command(
    winget: &str,
    package_id: &str,
    policy: ControlledProcessPolicy,
    progress: &WindowsInstallProgress<'_>,
    operation: &DependencyInstallOperation,
) -> Result<std::process::Output, WindowsInstallerFailure> {
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let mut command = tokio::process::Command::new(winget);
    command.args([
        "install",
        "-e",
        "--id",
        package_id,
        "--force",
        "--source",
        "winget",
        "--silent",
        "--disable-interactivity",
        "--accept-source-agreements",
        "--accept-package-agreements",
    ]);
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    let mut child = command.spawn().map_err(|error| {
        WindowsInstallerFailure::source_unavailable(format!(
            "Failed to run winget install for {package_id}: {error}"
        ))
    })?;
    let pid = child.id();
    let started = std::time::Instant::now();
    let process_label = format!("winget-{package_id}");
    record_process_started(
        progress.app,
        progress.step,
        &process_label,
        pid,
        &format!("winget install {package_id}"),
    );
    let mut cancellation_guard = WindowsChildTreeCancellationGuard::new(pid);
    let stdout_task = child.stdout.take().map(|stdout| {
        collect_process_output(
            stdout,
            progress.app.clone(),
            progress.step.to_owned(),
            process_label.clone(),
            "stdout",
            progress.progress(),
        )
    });
    let stderr_task = child.stderr.take().map(|stderr| {
        collect_process_output(
            stderr,
            progress.app.clone(),
            progress.step.to_owned(),
            process_label.clone(),
            "stderr",
            progress.progress(),
        )
    });
    let status = wait_for_controlled_child(&mut child, policy, Some(operation), || {
        progress.report_package_manager_wait();
    })
    .await;
    let stdout = finish_process_output("stdout", stdout_task).await;
    let stderr = finish_process_output("stderr", stderr_task).await;
    record_process_finished(
        progress.app,
        progress.step,
        &process_label,
        pid,
        status
            .as_ref()
            .ok()
            .and_then(|status| status.code())
            .map(i64::from),
        started.elapsed(),
    );

    // A root winget process can exit while an installer descendant still owns
    // one of its inherited pipes. Treat that as incomplete cleanup before
    // looking at the root status; otherwise a timeout would be downgraded to a
    // retryable failure and `winget install` could race the live descendant.
    if let Err(ProcessOutputFailure::DidNotClose(message)) = &stdout {
        return Err(WindowsInstallerFailure::from_output_failure(
            ProcessOutputFailure::DidNotClose(message.clone()),
        ));
    }
    if let Err(ProcessOutputFailure::DidNotClose(message)) = &stderr {
        return Err(WindowsInstallerFailure::from_output_failure(
            ProcessOutputFailure::DidNotClose(message.clone()),
        ));
    }
    let status = status.map_err(|error| {
        WindowsInstallerFailure::from_wait_error(&format!("winget install for {package_id}"), error)
    })?;
    let stdout = stdout.map_err(WindowsInstallerFailure::from_output_failure)?;
    let stderr = stderr.map_err(WindowsInstallerFailure::from_output_failure)?;
    if status.success() {
        cancellation_guard.disarm();
    }
    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_prelaunch_source_failures_allow_package_manager_fallback() {
        let source_unavailable =
            WindowsInstallerFailure::source_unavailable("download source unavailable");
        assert!(source_unavailable.permits_package_manager_fallback());

        let installer_failed = windows_installer_exit_failure("Node.js", 1603);
        assert!(!installer_failed.permits_package_manager_fallback());
        assert!(installer_failed.requires_runtime_recheck());

        let runtime_unavailable =
            WindowsInstallerFailure::runtime_unavailable("runtime not visible");
        assert!(!runtime_unavailable.permits_package_manager_fallback());
        assert!(runtime_unavailable.permits_runtime_channel_fallback());

        let cleanup_incomplete =
            WindowsInstallerFailure::cleanup_incomplete("tree termination was not confirmed");
        assert!(!cleanup_incomplete.permits_package_manager_fallback());
        assert!(matches!(
            cleanup_incomplete,
            WindowsInstallerFailure::CleanupIncomplete(message)
                if message == "tree termination was not confirmed"
        ));

        let cancelled = WindowsInstallerFailure::cancelled("administrator prompt declined");
        assert!(!cancelled.permits_package_manager_fallback());
        assert!(matches!(
            cancelled,
            WindowsInstallerFailure::Cancelled(message)
                if message == "administrator prompt declined"
        ));
    }

    #[test]
    fn windows_installer_success_codes_include_reboot_outcomes() {
        assert!(windows_installer_exit_succeeded(0));
        assert!(windows_installer_exit_succeeded(1641));
        assert!(windows_installer_exit_succeeded(3010));
        assert!(!windows_installer_exit_succeeded(1603));
        assert!(!windows_installer_exit_succeeded(1618));
    }

    #[test]
    fn windows_msi_command_line_keeps_switches_canonical_and_quotes_paths() {
        let invocation = WindowsMsiInvocation::quiet_install(
            Path::new(r"C:\Users\Jun Qi\AppData\Local\Temp\node-v24.18.0-x64.msi"),
            Path::new(r"C:\Users\Jun Qi\AppData\Local\Temp\node-msi.log"),
        );
        let command_line = invocation
            .arguments()
            .iter()
            .map(|argument| quote_windows_command_line_value(&argument.to_string_lossy()))
            .collect::<Vec<_>>()
            .join(" ");

        assert_eq!(
            command_line,
            r#"/i "C:\Users\Jun Qi\AppData\Local\Temp\node-v24.18.0-x64.msi" /qn /norestart /L*V "C:\Users\Jun Qi\AppData\Local\Temp\node-msi.log""#,
        );
    }

    #[test]
    fn windows_command_line_quote_escapes_embedded_quotes_and_trailing_slashes() {
        assert_eq!(quote_windows_command_line_value(""), "\"\"");
        let value = "C:\\path with space\\\"quoted\"\\";
        assert_eq!(
            quote_windows_command_line_value(value),
            "\"C:\\path with space\\\\\\\"quoted\\\"\\\\\"",
        );
    }

    #[test]
    fn windows_installer_invalid_command_line_is_actionable() {
        let error = windows_installer_exit_failure("Node.js", 1639);
        assert!(error.message().contains("1639"));
        assert!(error.message().contains("invalid command line"));
        assert!(error.requires_runtime_recheck());
    }

    #[test]
    fn windows_installer_busy_error_retains_actionable_exit_code() {
        let error = windows_installer_exit_failure("Node.js", 1618);
        assert!(error.message().contains("1618"));
        assert!(error.message().contains("already running"));
        assert!(error.requires_runtime_recheck());
    }
}
