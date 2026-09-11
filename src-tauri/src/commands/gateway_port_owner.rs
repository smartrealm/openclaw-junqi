use crate::commands::process_control::{run_command_output_confirmed, ControlledOutputLimits};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::time::{Duration, Instant};
use sysinfo::{Pid, System};

const OWNER_INSPECTION_TIMEOUT: Duration = Duration::from_secs(5);
const GRACEFUL_EXIT_TIMEOUT: Duration = Duration::from_secs(5);
const FORCED_EXIT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRecoveryPortOwner {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub started_at: u64,
    pub likely_openclaw: bool,
    pub can_terminate: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRecoveryPortOwnerRequest {
    pub port: u16,
    pub pid: u32,
    pub started_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PortOwnerIdentity {
    pid: u32,
    process_name: String,
    started_at: u64,
    likely_openclaw: bool,
    same_user: bool,
}

fn unique_pid(pids: BTreeSet<u32>, port: u16) -> Result<Option<u32>, String> {
    match pids.len() {
        0 => Ok(None),
        1 => Ok(pids.into_iter().next()),
        count => Err(format!(
            "Gateway port {port} has {count} listening process owners; no process was selected"
        )),
    }
}

fn parse_lsof_listener_pids(output: &str) -> BTreeSet<u32> {
    output
        .lines()
        .filter_map(|line| line.strip_prefix('p'))
        .filter_map(|value| value.trim().parse::<u32>().ok())
        .filter(|pid| *pid > 1)
        .collect()
}

#[cfg(any(target_os = "linux", test))]
fn parse_ss_listener_pids(output: &str) -> BTreeSet<u32> {
    let mut pids = BTreeSet::new();
    for line in output.lines() {
        let mut remainder = line;
        while let Some(index) = remainder.find("pid=") {
            remainder = &remainder[index + 4..];
            let digits = remainder
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>();
            if let Ok(pid) = digits.parse::<u32>() {
                if pid > 1 {
                    pids.insert(pid);
                }
            }
            remainder = &remainder[digits.len()..];
        }
    }
    pids
}

#[cfg(any(windows, test))]
fn socket_address_port(address: &str) -> Option<u16> {
    address
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
}

#[cfg(any(windows, test))]
fn parse_windows_netstat_listener_pids(output: &str, port: u16) -> BTreeSet<u32> {
    output
        .lines()
        .filter_map(|line| {
            let columns = line.split_whitespace().collect::<Vec<_>>();
            if columns.len() < 5
                || !columns[0].eq_ignore_ascii_case("TCP")
                || !columns[3].eq_ignore_ascii_case("LISTENING")
                || socket_address_port(columns[1]) != Some(port)
            {
                return None;
            }
            columns[4].parse::<u32>().ok().filter(|pid| *pid > 1)
        })
        .collect()
}

async fn run_owner_probe(executable: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = tokio::process::Command::new(executable);
    command.args(args);
    run_command_output_confirmed(
        command,
        ControlledOutputLimits {
            timeout: OWNER_INSPECTION_TIMEOUT,
            stdout_bytes: 256 * 1024,
            stderr_bytes: 64 * 1024,
        },
    )
    .await
    .map_err(|error| format!("Could not inspect the Gateway port owner: {error}"))
}

#[cfg(target_os = "macos")]
async fn listener_pid(port: u16) -> Result<Option<u32>, String> {
    let port_filter = format!("-iTCP:{port}");
    let output = run_owner_probe(
        "/usr/sbin/lsof",
        &["-nP", "-a", port_filter.as_str(), "-sTCP:LISTEN", "-Fp"],
    )
    .await?;
    unique_pid(
        parse_lsof_listener_pids(&String::from_utf8_lossy(&output.stdout)),
        port,
    )
}

#[cfg(target_os = "linux")]
async fn listener_pid(port: u16) -> Result<Option<u32>, String> {
    let filter = format!("sport = :{port}");
    let output = run_owner_probe("ss", &["-H", "-ltnp", filter.as_str()]).await?;
    unique_pid(
        parse_ss_listener_pids(&String::from_utf8_lossy(&output.stdout)),
        port,
    )
}

#[cfg(windows)]
async fn listener_pid(port: u16) -> Result<Option<u32>, String> {
    let output = run_owner_probe("netstat.exe", &["-ano", "-p", "TCP"]).await?;
    unique_pid(
        parse_windows_netstat_listener_pids(&String::from_utf8_lossy(&output.stdout), port),
        port,
    )
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
async fn listener_pid(_port: u16) -> Result<Option<u32>, String> {
    Err("Gateway port-owner inspection is unavailable on this platform".to_string())
}

fn command_looks_like_openclaw_gateway(process: &sysinfo::Process) -> bool {
    let name = process.name().to_string_lossy().to_ascii_lowercase();
    let executable = process
        .exe()
        .and_then(|path| path.file_name())
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let arguments = process
        .cmd()
        .iter()
        .map(|argument| argument.to_string_lossy().to_ascii_lowercase())
        .collect::<Vec<_>>();
    let has_openclaw = name.contains("openclaw")
        || executable.contains("openclaw")
        || arguments.iter().any(|argument| {
            argument == "openclaw"
                || argument.ends_with("/openclaw")
                || argument.ends_with("\\openclaw.cmd")
                || argument.contains("/node_modules/openclaw/")
                || argument.contains("\\node_modules\\openclaw\\")
        });
    let has_gateway = arguments
        .iter()
        .any(|argument| argument == "gateway" || argument == "run");
    has_openclaw && has_gateway
}

fn inspect_process(pid: u32) -> Result<PortOwnerIdentity, String> {
    let mut system = System::new_all();
    system.refresh_all();
    let target_pid = Pid::from_u32(pid);
    let process = system
        .process(target_pid)
        .ok_or_else(|| format!("Gateway port owner {pid} exited before it could be inspected"))?;
    let current_pid = sysinfo::get_current_pid()
        .map_err(|error| format!("Could not identify the JunQi process: {error}"))?;
    let current = system
        .process(current_pid)
        .ok_or_else(|| "Could not inspect the JunQi process owner".to_string())?;
    let same_user = current.user_id().is_some()
        && process.user_id().is_some()
        && current.user_id() == process.user_id();
    let process_name = process
        .name()
        .to_string_lossy()
        .chars()
        .filter(|character| !character.is_control())
        .take(80)
        .collect::<String>()
        .trim()
        .to_string();
    Ok(PortOwnerIdentity {
        pid,
        process_name: if process_name.is_empty() {
            "Unknown process".to_string()
        } else {
            process_name
        },
        started_at: process.start_time(),
        likely_openclaw: command_looks_like_openclaw_gateway(process),
        same_user,
    })
}

pub async fn inspect_runtime_recovery_port_owner(
    port: u16,
) -> Result<Option<RuntimeRecoveryPortOwner>, String> {
    let Some(pid) = listener_pid(port).await? else {
        return if crate::commands::gateway_supervisor::is_port_available(port).await {
            Ok(None)
        } else {
            Err(format!(
                "Gateway port {port} is occupied, but its process owner could not be identified"
            ))
        };
    };
    let identity = inspect_process(pid)?;
    let current_pid = sysinfo::get_current_pid().ok().map(Pid::as_u32);
    Ok(Some(RuntimeRecoveryPortOwner {
        port,
        pid: identity.pid,
        process_name: identity.process_name,
        started_at: identity.started_at,
        likely_openclaw: identity.likely_openclaw,
        can_terminate: identity.same_user && identity.pid > 1 && current_pid != Some(identity.pid),
    }))
}

fn termination_is_permitted(
    requested: &RuntimeRecoveryPortOwnerRequest,
    observed: &PortOwnerIdentity,
    current_pid: Option<u32>,
) -> bool {
    requested.pid == observed.pid
        && requested.started_at == observed.started_at
        && requested.port > 0
        && observed.same_user
        && observed.pid > 1
        && current_pid != Some(observed.pid)
}

#[cfg(unix)]
fn request_graceful_exit(pid: u32) -> Result<(), String> {
    let pid = i32::try_from(pid).map_err(|_| "Gateway process PID is invalid".to_string())?;
    let result = unsafe { libc::kill(pid, libc::SIGTERM) };
    if result == 0 {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(())
        } else {
            Err(format!("Could not request Gateway process exit: {error}"))
        }
    }
}

#[cfg(windows)]
async fn request_graceful_exit(pid: u32) -> Result<(), String> {
    let pid = pid.to_string();
    let _ = run_owner_probe("taskkill.exe", &["/PID", pid.as_str(), "/T"]).await?;
    Ok(())
}

#[cfg(unix)]
fn force_exit(pid: u32) -> Result<(), String> {
    let pid = i32::try_from(pid).map_err(|_| "Gateway process PID is invalid".to_string())?;
    let result = unsafe { libc::kill(pid, libc::SIGKILL) };
    if result == 0 {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(())
        } else {
            Err(format!(
                "Could not force the Gateway process to exit: {error}"
            ))
        }
    }
}

#[cfg(windows)]
async fn force_exit(pid: u32) -> Result<(), String> {
    crate::commands::process_control::terminate_windows_process_tree(pid).await
}

async fn wait_for_expected_listener_exit(
    requested: &RuntimeRecoveryPortOwnerRequest,
    timeout: Duration,
) -> Result<bool, String> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        match listener_pid(requested.port).await? {
            None if crate::commands::gateway_supervisor::is_port_available(requested.port)
                .await =>
            {
                return Ok(true);
            }
            None => {
                return Err(format!(
                    "Gateway port {} is still occupied, but the new owner could not be identified",
                    requested.port
                ));
            }
            Some(pid) if pid != requested.pid => {
                return Err(format!(
                    "Gateway port {} changed owners while the previous process was stopping; the new process was not terminated",
                    requested.port
                ));
            }
            Some(_) => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    }
    Ok(false)
}

pub async fn terminate_runtime_recovery_port_owner(
    requested: &RuntimeRecoveryPortOwnerRequest,
) -> Result<(), String> {
    let observed_pid = listener_pid(requested.port)
        .await?
        .ok_or_else(|| "The Gateway port is already free; no process was terminated".to_string())?;
    let observed = inspect_process(observed_pid)?;
    let current_pid = sysinfo::get_current_pid().ok().map(Pid::as_u32);
    if !termination_is_permitted(requested, &observed, current_pid) {
        return Err(
            "The Gateway port owner changed or cannot be safely terminated; inspect it again"
                .to_string(),
        );
    }

    #[cfg(unix)]
    request_graceful_exit(observed.pid)?;
    #[cfg(windows)]
    request_graceful_exit(observed.pid).await?;

    if wait_for_expected_listener_exit(requested, GRACEFUL_EXIT_TIMEOUT).await? {
        return Ok(());
    }

    let repeated = inspect_process(observed.pid)?;
    if !termination_is_permitted(requested, &repeated, current_pid) {
        return Err("The Gateway process identity changed before forced exit".to_string());
    }
    #[cfg(unix)]
    force_exit(observed.pid)?;
    #[cfg(windows)]
    force_exit(observed.pid).await?;

    if wait_for_expected_listener_exit(requested, FORCED_EXIT_TIMEOUT).await? {
        Ok(())
    } else {
        Err(format!(
            "Gateway process {} did not release port {} after termination",
            observed.pid, requested.port
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTROLLED_LISTENER_PORT: &str = "JUNQI_CONTROLLED_LISTENER_PORT";

    #[test]
    fn parses_listener_owners_without_accepting_unrelated_rows() {
        assert_eq!(
            parse_lsof_listener_pids("p410\nf3\np410\n"),
            BTreeSet::from([410])
        );
        assert_eq!(
            parse_ss_listener_pids(
                "LISTEN 0 511 127.0.0.1:18789 0.0.0.0:* users:((\"node\",pid=512,fd=20))"
            ),
            BTreeSet::from([512])
        );
        assert_eq!(
            parse_windows_netstat_listener_pids(
                " TCP 127.0.0.1:18789 0.0.0.0:0 LISTENING 614\n TCP 127.0.0.1:18790 0.0.0.0:0 LISTENING 615",
                18_789,
            ),
            BTreeSet::from([614])
        );
    }

    #[test]
    fn termination_requires_the_same_process_generation_and_user() {
        let request = RuntimeRecoveryPortOwnerRequest {
            port: 18_789,
            pid: 700,
            started_at: 900,
        };
        let observed = PortOwnerIdentity {
            pid: 700,
            process_name: "node".to_string(),
            started_at: 900,
            likely_openclaw: true,
            same_user: true,
        };
        assert!(termination_is_permitted(&request, &observed, Some(701)));
        assert!(!termination_is_permitted(
            &request,
            &PortOwnerIdentity {
                started_at: 901,
                ..observed.clone()
            },
            Some(701),
        ));
        assert!(!termination_is_permitted(
            &request,
            &PortOwnerIdentity {
                same_user: false,
                ..observed
            },
            Some(701),
        ));
    }

    #[cfg(any(target_os = "macos", target_os = "linux", windows))]
    #[tokio::test]
    async fn inspection_identifies_a_listener_created_by_this_test_process() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let owner = inspect_runtime_recovery_port_owner(port)
            .await
            .unwrap()
            .expect("the controlled listener should expose its process owner");
        assert_eq!(owner.pid, std::process::id());
        assert_eq!(owner.port, port);
        assert!(!owner.can_terminate);
    }

    #[cfg(any(target_os = "macos", target_os = "linux", windows))]
    #[test]
    #[ignore = "仅由受控终止测试作为独立子进程启动"]
    fn controlled_listener_process() {
        let Ok(port) = std::env::var(CONTROLLED_LISTENER_PORT) else {
            return;
        };
        let listener = std::net::TcpListener::bind(format!("127.0.0.1:{port}")).unwrap();
        println!("controlled-listener-ready");
        std::io::Write::flush(&mut std::io::stdout()).unwrap();
        loop {
            std::thread::sleep(Duration::from_secs(60));
            std::hint::black_box(&listener);
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux", windows))]
    #[tokio::test]
    async fn termination_releases_a_controlled_listener() {
        use tokio::io::{AsyncBufReadExt, BufReader};

        let reservation = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = reservation.local_addr().unwrap().port();
        drop(reservation);

        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .arg("--ignored")
            .arg("--exact")
            .arg("commands::gateway_port_owner::tests::controlled_listener_process")
            .arg("--nocapture")
            .env(CONTROLLED_LISTENER_PORT, port.to_string())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut lines = BufReader::new(stdout).lines();
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let line = lines.next_line().await.unwrap().unwrap();
                if line.contains("controlled-listener-ready") {
                    break;
                }
            }
        })
        .await
        .unwrap();

        let owner = inspect_runtime_recovery_port_owner(port)
            .await
            .unwrap()
            .expect("the controlled listener should expose its process owner");
        assert_eq!(owner.pid, child.id().unwrap());
        assert!(owner.can_terminate);
        terminate_runtime_recovery_port_owner(&RuntimeRecoveryPortOwnerRequest {
            port,
            pid: owner.pid,
            started_at: owner.started_at,
        })
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .unwrap()
            .unwrap();
        assert!(crate::commands::gateway_supervisor::is_port_available(port).await);
    }
}
