//! Private shell integration used only by JunQi's embedded terminal.
//!
//! Kooky tracks the current directory through OSC 7. Merely parsing that
//! sequence in the renderer is not enough: stock zsh/bash/fish sessions do not
//! consistently emit it. These tiny, application-owned wrappers replay the
//! user's shell configuration and then emit OSC 7 without editing any user rc
//! file. If preparing a wrapper fails, callers receive a normal login shell.

use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use portable_pty::CommandBuilder;
use tauri::{AppHandle, Manager};

const INTEGRATION_DIR: &str = "terminal-shell";
// Keep this in the same order as the terminal Agent catalog. Each wrapper
// delegates to a real binary discovered after its own directory on PATH; it
// only adds lifecycle markers around that process.
const JUNQI_AGENT_SHIMS: [&str; 13] = [
    "claude",
    "codex",
    "gemini",
    "opencode",
    "amp",
    "cursor-agent",
    "copilot",
    "grok",
    "agy",
    "kimi",
    "pi",
    "kiro-cli",
    "droid",
];
#[cfg(any(windows, test))]
const POWERSHELL_LAUNCH_ARGS: [&str; 5] = [
    "-NoLogo",
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ShellKind {
    Zsh,
    Bash,
    Fish,
    PowerShell,
    Other,
}

fn integration_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn detect_shell_kind(program: &str) -> ShellKind {
    let basename = program
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(program)
        .to_ascii_lowercase();
    match basename.strip_suffix(".exe").unwrap_or(&basename) {
        "zsh" => ShellKind::Zsh,
        "bash" => ShellKind::Bash,
        "fish" => ShellKind::Fish,
        "pwsh" | "powershell" => ShellKind::PowerShell,
        _ => ShellKind::Other,
    }
}

fn login_env_value(name: &str) -> Option<String> {
    crate::platform::login_shell_env()
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
        .filter(|value| !value.is_empty())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn integration_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(INTEGRATION_DIR))
        .map_err(|error| format!("resolve terminal integration directory: {error}"))
}

/// A transparent, per-terminal executable shim. It resolves the first real
/// binary after its own directory, brackets an interactive run with an OSC 2
/// marker, and otherwise preserves the program's exit code and argv exactly.
#[cfg(unix)]
fn unix_agent_shim() -> &'static str {
    r#"#!/bin/sh
_junqi_slug="${0##*/}"
_junqi_self_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
_junqi_real=""
_junqi_old_ifs=$IFS
IFS=:
for _junqi_dir in $PATH; do
  [ "$_junqi_dir" = "$_junqi_self_dir" ] && continue
  [ -x "$_junqi_dir/$_junqi_slug" ] || continue
  _junqi_real="$_junqi_dir/$_junqi_slug"
  break
done
IFS=$_junqi_old_ifs

if [ -z "$_junqi_real" ]; then
  printf '%s is not installed.\n' "$_junqi_slug" >&2
  exit 127
fi

# Programmatic stdio brokers must remain byte-for-byte transparent.
if [ ! -t 0 ] && [ ! -t 1 ]; then
  exec "$_junqi_real" "$@"
fi

_junqi_run_agent() {
  if [ "$_junqi_slug" = "claude" ] && [ -n "${JUNQI_CLAUDE_SETTINGS:-}" ]; then
    "$_junqi_real" --settings "$JUNQI_CLAUDE_SETTINGS" "$@"
  else
    "$_junqi_real" "$@"
  fi
}

if [ -n "${JUNQI_SURFACE_ID:-}" ]; then
  printf '\033]2;junqi-agent:%s:running\a' "$_junqi_slug" > /dev/tty 2>/dev/null
  _junqi_run_agent "$@"
  _junqi_status=$?
  printf '\033]2;junqi-agent:%s:ended\a' "$_junqi_slug" > /dev/tty 2>/dev/null
  exit "$_junqi_status"
fi
_junqi_run_agent "$@"
exit $?
"#
}

fn prepare_agent_shims(app: &AppHandle) -> Result<PathBuf, String> {
    let _guard = integration_lock()
        .lock()
        .map_err(|_| "terminal integration lock poisoned".to_string())?;
    let root = integration_root(app)?.join("agent-bin");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    for slug in JUNQI_AGENT_SHIMS {
        write_if_changed(&root.join(slug), unix_agent_shim(), true)?;
    }
    Ok(root)
}

fn write_if_changed(path: &Path, contents: &str, executable: bool) -> Result<(), String> {
    let current = fs::read_to_string(path).ok();
    if current.as_deref() != Some(contents) {
        let parent = path.parent().ok_or("invalid terminal integration path")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temporary = parent.join(format!(
            ".{}.{}.tmp",
            path.file_name().and_then(OsStr::to_str).unwrap_or("shell"),
            std::process::id()
        ));
        fs::write(&temporary, contents).map_err(|error| error.to_string())?;
        #[cfg(windows)]
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary, path).map_err(|error| error.to_string())?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if executable { 0o700 } else { 0o600 };
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|error| error.to_string())?;
    }
    let _ = executable;
    Ok(())
}

fn zsh_wrapper() -> &'static str {
    r#"# JunQi private zsh integration. This file is generated by the app.
if [[ -n "${JUNQI_ORIGINAL_ZDOTDIR:-}" ]]; then
  export ZDOTDIR="$JUNQI_ORIGINAL_ZDOTDIR"
  unset JUNQI_ORIGINAL_ZDOTDIR
else
  unset ZDOTDIR
fi

# Replay the user chain after restoring their real ZDOTDIR. This wrapper is
# only the initial lookup target; it does not replace user configuration.
[[ -r "${ZDOTDIR:-$HOME}/.zshenv" ]] && source "${ZDOTDIR:-$HOME}/.zshenv"
[[ -r "${ZDOTDIR:-$HOME}/.zprofile" ]] && source "${ZDOTDIR:-$HOME}/.zprofile"
[[ -r "${ZDOTDIR:-$HOME}/.zshrc" ]] && source "${ZDOTDIR:-$HOME}/.zshrc"

autoload -Uz add-zsh-hook
_junqi_osc7_pwd() {
  local _s=$? _p="$PWD"
  _p=${_p//\%/%25}; _p=${_p// /%20}; _p=${_p//\#/%23}; _p=${_p//\?/%3F}
  printf '\e]7;file://%s%s\e\\' "${HOST:-localhost}" "$_p"
  return $_s
}
add-zsh-hook chpwd _junqi_osc7_pwd
_junqi_osc7_pwd
"#
}

fn bash_rc() -> &'static str {
    r#"# JunQi private bash integration. This file is generated by the app.
# Interactive non-login bash does not read a profile. Replay the same first
# login rc Bash would select; if none exists, load .bashrc once.
_junqi_login_rc_loaded=
for _junqi_rc in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [[ -r "$_junqi_rc" ]]; then
    source "$_junqi_rc"
    _junqi_login_rc_loaded=1
    break
  fi
done
unset _junqi_rc
if [[ -z "$_junqi_login_rc_loaded" && -r "$HOME/.bashrc" ]]; then
  source "$HOME/.bashrc"
fi
unset _junqi_login_rc_loaded

_junqi_osc7_pwd() {
  local _s=$? _p="$PWD"
  _p=${_p//\%/%25}; _p=${_p// /%20}; _p=${_p//\#/%23}; _p=${_p//\?/%3F}
  printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-localhost}" "$_p"
  return $_s
}
PROMPT_COMMAND="_junqi_osc7_pwd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
_junqi_osc7_pwd
"#
}

fn fish_vendor_config() -> &'static str {
    r#"# JunQi private fish integration. This file is generated by the app.
set -l __junqi_host (hostname)
function __junqi_emit_osc7 --on-event fish_prompt
  set -l __junqi_status $status
  set -l __junqi_path (string replace -a '%' '%25' -- "$PWD")
  set __junqi_path (string replace -a ' ' '%20' -- "$__junqi_path")
  set __junqi_path (string replace -a '#' '%23' -- "$__junqi_path")
  set __junqi_path (string replace -a '?' '%3F' -- "$__junqi_path")
  printf '\e]7;file://%s%s\e\\' "$__junqi_host" "$__junqi_path"
  return $__junqi_status
end
__junqi_emit_osc7
"#
}

#[cfg(any(windows, test))]
fn powershell_wrapper() -> &'static str {
    r#"# JunQi private PowerShell integration. This file is generated by the app.
$global:__JunQiOriginalPrompt = $function:prompt
if (-not $global:__JunQiOriginalPrompt) {
  $global:__JunQiOriginalPrompt = { "PS $($executionContext.SessionState.Path.CurrentLocation)> " }
}
function global:prompt {
  $junqiPrompt = & $global:__JunQiOriginalPrompt
  $junqiExitCode = $global:LASTEXITCODE
  try {
    $junqiLocation = Get-Location
    if ($junqiLocation.Provider.Name -eq 'FileSystem') {
      $junqiEsc = [char]27
      $junqiPath = $junqiLocation.ProviderPath
      if ($junqiPath.StartsWith('\\?\UNC\', [System.StringComparison]::OrdinalIgnoreCase)) {
        $junqiPath = '\\' + $junqiPath.Substring(8)
      } elseif ($junqiPath.StartsWith('\\?\')) {
        $junqiPath = $junqiPath.Substring(4)
      }
      $junqiUri = [System.Uri]::new($junqiPath).AbsoluteUri
      [Console]::Write("$junqiEsc]7;$junqiUri$junqiEsc\")
    }
  } catch {}
  $global:LASTEXITCODE = $junqiExitCode
  $junqiPrompt
}

function global:__JunQiInvokeAgent {
  param(
    [string]$Name,
    [Parameter(ValueFromRemainingArguments = $true)] [object[]]$Arguments
  )
  $junqiCommand = Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $junqiCommand) {
    Write-Error "$Name is not installed."
    $global:LASTEXITCODE = 127
    return
  }
  if (-not $env:JUNQI_SURFACE_ID) {
    & $junqiCommand.Source @Arguments
    return
  }
  $junqiEsc = [char]27
  $junqiBell = [char]7
  $junqiStatus = 1
  [Console]::Write("$junqiEsc]2;junqi-agent:$Name:running$junqiBell")
  try {
    if ($Name -eq "claude" -and $env:JUNQI_CLAUDE_SETTINGS) {
      & $junqiCommand.Source --settings $env:JUNQI_CLAUDE_SETTINGS @Arguments
    } else {
      & $junqiCommand.Source @Arguments
    }
    $junqiStatus = $LASTEXITCODE
  } finally {
    [Console]::Write("$junqiEsc]2;junqi-agent:$Name:ended$junqiBell")
    $global:LASTEXITCODE = $junqiStatus
  }
}
function global:claude { __JunQiInvokeAgent -Name "claude" @args }
function global:codex { __JunQiInvokeAgent -Name "codex" @args }
function global:gemini { __JunQiInvokeAgent -Name "gemini" @args }
function global:opencode { __JunQiInvokeAgent -Name "opencode" @args }
function global:amp { __JunQiInvokeAgent -Name "amp" @args }
function global:cursor-agent { __JunQiInvokeAgent -Name "cursor-agent" @args }
function global:copilot { __JunQiInvokeAgent -Name "copilot" @args }
function global:grok { __JunQiInvokeAgent -Name "grok" @args }
function global:agy { __JunQiInvokeAgent -Name "agy" @args }
function global:kimi { __JunQiInvokeAgent -Name "kimi" @args }
function global:pi { __JunQiInvokeAgent -Name "pi" @args }
function global:kiro-cli { __JunQiInvokeAgent -Name "kiro-cli" @args }
function global:droid { __JunQiInvokeAgent -Name "droid" @args }
"#
}

fn default_shell_command(cwd: &Path) -> CommandBuilder {
    let shell = crate::platform::default_shell_command();
    let mut command = CommandBuilder::new(&shell.program);
    for argument in &shell.args {
        command.arg(argument);
    }
    command.cwd(cwd);
    command
}

fn apply_terminal_environment(
    app: Option<&AppHandle>,
    command: &mut CommandBuilder,
    shell_id: &str,
    run_id: Option<&str>,
    agent_shim_dir: Option<&Path>,
) {
    let login_env = crate::platform::login_shell_env();
    for (key, value) in login_env {
        command.env(key, value);
    }
    let has_login_var = |name: &str| login_env.iter().any(|(key, _)| key == name);
    if !has_login_var("LANG") {
        command.env("LANG", "en_US.UTF-8");
    }
    if !has_login_var("LC_CTYPE") {
        command.env("LC_CTYPE", "en_US.UTF-8");
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("JUNQI_SURFACE_ID", shell_id);
    if let (Some(app), Some(run_id)) = (app, run_id) {
        if let Ok(hook_environment) =
            crate::commands::terminal_hooks::session_environment(app, shell_id, run_id)
        {
            for (key, value) in hook_environment {
                command.env(key, value);
            }
        }
    }
    if let Some(shim_dir) = agent_shim_dir {
        let separator = if cfg!(windows) { ";" } else { ":" };
        let inherited_path = login_env
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("PATH"))
            .map(|(_, value)| value.as_str())
            .unwrap_or_default();
        command.env(
            "PATH",
            format!(
                "{}{}{}",
                shim_dir.to_string_lossy(),
                separator,
                inherited_path
            ),
        );
    }
}

/// Bootstrap used exclusively by a JunQi-owned SSH workspace. It creates a
/// per-connection remote directory with lightweight agent wrappers, replays
/// the user's interactive shell configuration, then removes everything when
/// that remote shell exits. Nothing is written to the remote user's dotfiles.
fn remote_agent_bootstrap_script() -> &'static str {
    r#"_junqi_root=$(mktemp -d "${TMPDIR:-/tmp}/junqi-agent-markers.XXXXXX") || {
  printf 'junqi: could not create remote marker directory\n' >&2
  "${SHELL:-/bin/sh}" -l
  exit $?
}
_junqi_bin="$_junqi_root/bin"
mkdir -p "$_junqi_bin" || exit 1
trap 'rm -rf "$_junqi_root"' 0 HUP INT TERM

_junqi_write_agent_wrapper() {
  _junqi_slug="$1"
  cat > "$_junqi_bin/$_junqi_slug" <<'JUNQI_AGENT_WRAPPER'
#!/bin/sh
_junqi_slug="${0##*/}"
_junqi_self_dir=$(CDPATH= cd "$(dirname "$0")" && pwd)
_junqi_real=""
_junqi_old_ifs=$IFS
IFS=:
for _junqi_dir in $PATH; do
  [ "$_junqi_dir" = "$_junqi_self_dir" ] && continue
  [ -x "$_junqi_dir/$_junqi_slug" ] || continue
  _junqi_real="$_junqi_dir/$_junqi_slug"
  break
done
IFS=$_junqi_old_ifs

if [ -z "$_junqi_real" ]; then
  printf '\033]2;junqi-agent:%s:ended\a' "$_junqi_slug" > /dev/tty 2>/dev/null
  printf '%s is not installed.\n' "$_junqi_slug" >&2
  exit 127
fi

printf '\033]2;junqi-agent:%s:running\a' "$_junqi_slug" > /dev/tty 2>/dev/null
"$_junqi_real" "$@"
_junqi_status=$?
printf '\033]2;junqi-agent:%s:ended\a' "$_junqi_slug" > /dev/tty 2>/dev/null
exit "$_junqi_status"
JUNQI_AGENT_WRAPPER
  chmod 700 "$_junqi_bin/$_junqi_slug"
}

for _junqi_slug in claude codex gemini opencode amp cursor-agent copilot grok agy kimi pi kiro-cli droid; do
  _junqi_write_agent_wrapper "$_junqi_slug"
done
unset _junqi_slug

case "${SHELL:-}" in
  */zsh)
    mkdir -p "$_junqi_root/zsh"
    cat > "$_junqi_root/zsh/.zshrc" <<'JUNQI_ZSHRC'
if [[ -n "${JUNQI_REMOTE_ORIGINAL_ZDOTDIR:-}" ]]; then
  export ZDOTDIR="$JUNQI_REMOTE_ORIGINAL_ZDOTDIR"
else
  unset ZDOTDIR
fi
[[ -r "${ZDOTDIR:-$HOME}/.zshenv" ]] && source "${ZDOTDIR:-$HOME}/.zshenv"
[[ -r "${ZDOTDIR:-$HOME}/.zprofile" ]] && source "${ZDOTDIR:-$HOME}/.zprofile"
[[ -r "${ZDOTDIR:-$HOME}/.zshrc" ]] && source "${ZDOTDIR:-$HOME}/.zshrc"
export PATH="$JUNQI_AGENT_BIN:$PATH"
unset JUNQI_REMOTE_ORIGINAL_ZDOTDIR JUNQI_AGENT_BIN
JUNQI_ZSHRC
    JUNQI_REMOTE_ORIGINAL_ZDOTDIR="${ZDOTDIR:-}" JUNQI_AGENT_BIN="$_junqi_bin" ZDOTDIR="$_junqi_root/zsh" zsh -i
    ;;
  */bash)
    cat > "$_junqi_root/bashrc" <<'JUNQI_BASHRC'
_junqi_login_rc_loaded=
for _junqi_rc in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [[ -r "$_junqi_rc" ]]; then
    source "$_junqi_rc"
    _junqi_login_rc_loaded=1
    break
  fi
done
unset _junqi_rc
if [[ -z "$_junqi_login_rc_loaded" && -r "$HOME/.bashrc" ]]; then
  source "$HOME/.bashrc"
fi
unset _junqi_login_rc_loaded
export PATH="$JUNQI_AGENT_BIN:$PATH"
unset JUNQI_AGENT_BIN
JUNQI_BASHRC
    JUNQI_AGENT_BIN="$_junqi_bin" bash --rcfile "$_junqi_root/bashrc" -i
    ;;
  *)
    export PATH="$_junqi_bin:$PATH"
    "${SHELL:-/bin/sh}" -l
    ;;
esac
"#
}

fn ssh_workspace_remote_command() -> String {
    format!("sh -lc {}", shell_quote(remote_agent_bootstrap_script()))
}

fn normalized_ssh_destination(host: &str) -> Result<&str, String> {
    let destination = host.trim();
    if destination.is_empty()
        || destination.len() > 512
        || destination.chars().any(char::is_control)
    {
        return Err("invalid SSH destination".to_string());
    }
    Ok(destination)
}

/// Build a login-equivalent shell command with best-effort private integration.
/// Any filesystem failure falls back to the plain shell rather than preventing
/// a user from opening a terminal.
pub fn build_interactive_shell_command(
    app: &AppHandle,
    cwd: &Path,
    shell_id: &str,
    run_id: &str,
) -> CommandBuilder {
    let shell = crate::platform::default_shell_command();
    let agent_shim_dir = prepare_agent_shims(app).ok();

    #[cfg(windows)]
    {
        let mut command = match prepare_windows_integration(app, cwd, &shell.program) {
            Ok(Some(command)) => command,
            Ok(None) | Err(_) => default_shell_command(cwd),
        };
        apply_terminal_environment(
            Some(app),
            &mut command,
            shell_id,
            Some(run_id),
            agent_shim_dir.as_deref(),
        );
        return command;
    }

    #[cfg(all(not(unix), not(windows)))]
    {
        let mut command = default_shell_command(cwd);
        apply_terminal_environment(
            Some(app),
            &mut command,
            shell_id,
            Some(run_id),
            agent_shim_dir.as_deref(),
        );
        return command;
    }

    #[cfg(unix)]
    {
        let mut command = match prepare_unix_integration(app, cwd, &shell.program) {
            Ok(Some(command)) => command,
            Ok(None) | Err(_) => default_shell_command(cwd),
        };
        apply_terminal_environment(
            Some(app),
            &mut command,
            shell_id,
            Some(run_id),
            agent_shim_dir.as_deref(),
        );

        // ZDOTDIR and XDG_DATA_DIRS must be set after the login environment,
        // otherwise setup would overwrite this session-only integration.
        if detect_shell_kind(&shell.program) == ShellKind::Zsh {
            if let Ok(root) = prepare_zsh_integration(app) {
                if let Some(original) = login_env_value("ZDOTDIR") {
                    command.env("JUNQI_ORIGINAL_ZDOTDIR", original);
                } else {
                    command.env_remove("JUNQI_ORIGINAL_ZDOTDIR");
                }
                command.env("ZDOTDIR", root);
            }
        }
        if detect_shell_kind(&shell.program) == ShellKind::Fish {
            if let Ok(root) = prepare_fish_integration(app) {
                let existing = login_env_value("XDG_DATA_DIRS")
                    .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());
                command.env(
                    "XDG_DATA_DIRS",
                    format!("{}:{}", root.to_string_lossy(), existing),
                );
            }
        }
        command
    }
}

/// OpenSSH is executed directly with argv, never through a shell string. This
/// accepts ordinary `~/.ssh/config` aliases as well as `user@host`, while the
/// `--` prevents a host beginning with `-` being interpreted as an option.
pub fn build_ssh_command(
    app: &AppHandle,
    host: &str,
    shell_id: &str,
) -> Result<CommandBuilder, String> {
    let destination = normalized_ssh_destination(host)?;
    let program = crate::platform::resolve_spawn_program("ssh");
    if program.is_empty() {
        return Err("ssh executable is not available on PATH".to_string());
    }
    let mut command = CommandBuilder::new(program);
    command.arg("-tt");
    command.arg("--");
    command.arg(destination);
    // This is a JunQi-owned SSH workspace, never a user-typed `ssh` command.
    // A single quoted remote command lets the server's shell receive the
    // bootstrap as one argv value even though OpenSSH joins command arguments.
    command.arg(ssh_workspace_remote_command());
    let agent_shim_dir = prepare_agent_shims(app).ok();
    apply_terminal_environment(
        None,
        &mut command,
        shell_id,
        None,
        agent_shim_dir.as_deref(),
    );
    Ok(command)
}

#[cfg(windows)]
fn prepare_windows_integration(
    app: &AppHandle,
    cwd: &Path,
    shell_program: &str,
) -> Result<Option<CommandBuilder>, String> {
    if detect_shell_kind(shell_program) != ShellKind::PowerShell {
        return Ok(None);
    }
    let _guard = integration_lock()
        .lock()
        .map_err(|_| "terminal integration lock poisoned".to_string())?;
    let root = integration_root(app)?.join("powershell");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let script_path = root.join("junqi-profile.ps1");
    write_if_changed(&script_path, powershell_wrapper(), false)?;
    let quoted_path = script_path.to_string_lossy().replace('\'', "''");

    let mut command = CommandBuilder::new(shell_program);
    command.args(POWERSHELL_LAUNCH_ARGS);
    command.arg(format!(". '{}'", quoted_path));
    command.cwd(cwd);
    Ok(Some(command))
}

#[cfg(unix)]
fn prepare_unix_integration(
    app: &AppHandle,
    cwd: &Path,
    shell_program: &str,
) -> Result<Option<CommandBuilder>, String> {
    if detect_shell_kind(shell_program) != ShellKind::Bash {
        return Ok(None);
    }
    let launcher = prepare_bash_integration(app, shell_program)?;
    let mut command = CommandBuilder::new(launcher);
    command.cwd(cwd);
    Ok(Some(command))
}

#[cfg(unix)]
fn prepare_zsh_integration(app: &AppHandle) -> Result<PathBuf, String> {
    let _guard = integration_lock()
        .lock()
        .map_err(|_| "terminal integration lock poisoned".to_string())?;
    let root = integration_root(app)?.join("zsh");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    write_if_changed(&root.join(".zshrc"), zsh_wrapper(), false)?;
    Ok(root)
}

#[cfg(unix)]
fn prepare_bash_integration(app: &AppHandle, bash_program: &str) -> Result<PathBuf, String> {
    let _guard = integration_lock()
        .lock()
        .map_err(|_| "terminal integration lock poisoned".to_string())?;
    let root = integration_root(app)?.join("bash");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let rc_path = root.join("junqi-bashrc");
    let launcher_path = root.join("junqi-bash-launch");
    write_if_changed(&rc_path, bash_rc(), false)?;
    let launcher = format!(
        "#!/bin/sh\nexec {} --rcfile {} -i\n",
        shell_quote(bash_program),
        shell_quote(&rc_path.to_string_lossy()),
    );
    write_if_changed(&launcher_path, &launcher, true)?;
    Ok(launcher_path)
}

#[cfg(unix)]
fn prepare_fish_integration(app: &AppHandle) -> Result<PathBuf, String> {
    let _guard = integration_lock()
        .lock()
        .map_err(|_| "terminal integration lock poisoned".to_string())?;
    let root = integration_root(app)?.join("fish-data");
    let config_path = root.join("fish").join("vendor_conf.d").join("junqi.fish");
    write_if_changed(&config_path, fish_vendor_config(), false)?;
    Ok(root)
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::unix_agent_shim;
    use super::{
        bash_rc, detect_shell_kind, fish_vendor_config, normalized_ssh_destination,
        powershell_wrapper, remote_agent_bootstrap_script, shell_quote,
        ssh_workspace_remote_command, zsh_wrapper, ShellKind, POWERSHELL_LAUNCH_ARGS,
    };

    #[test]
    fn detects_supported_shells_by_program_basename() {
        assert_eq!(detect_shell_kind("/bin/zsh"), ShellKind::Zsh);
        assert_eq!(detect_shell_kind("bash"), ShellKind::Bash);
        assert_eq!(detect_shell_kind("/opt/homebrew/bin/fish"), ShellKind::Fish);
        assert_eq!(
            detect_shell_kind("C:\\Program Files\\PowerShell\\7\\pwsh.exe"),
            ShellKind::PowerShell
        );
        assert_eq!(
            detect_shell_kind("C:\\Windows\\POWERSHELL.EXE"),
            ShellKind::PowerShell
        );
        assert_eq!(detect_shell_kind("/bin/sh"), ShellKind::Other);
    }

    #[test]
    fn wrappers_replay_user_config_and_emit_osc7_without_writing_user_rc_files() {
        assert!(zsh_wrapper().contains("${ZDOTDIR:-$HOME}/.zshrc"));
        assert!(zsh_wrapper().contains("add-zsh-hook chpwd _junqi_osc7_pwd"));
        assert!(bash_rc().contains("$HOME/.bash_profile"));
        assert!(bash_rc().contains("PROMPT_COMMAND"));
        assert!(fish_vendor_config().contains("--on-event fish_prompt"));
        assert!(powershell_wrapper().contains("[char]27"));
        assert!(powershell_wrapper().contains("Provider.Name -eq 'FileSystem'"));
        assert!(powershell_wrapper().contains("StringComparison]::OrdinalIgnoreCase"));
        assert!(powershell_wrapper().contains("AbsoluteUri"));
        assert!(!powershell_wrapper().contains("`e"));
        assert!(powershell_wrapper().contains("__JunQiOriginalPrompt"));
        assert!(
            powershell_wrapper().find("$junqiPrompt = &").unwrap()
                < powershell_wrapper()
                    .find("$junqiLocation = Get-Location")
                    .unwrap()
        );
        assert!(POWERSHELL_LAUNCH_ARGS
            .windows(2)
            .any(|arguments| { arguments == ["-ExecutionPolicy", "Bypass"] }));
        for wrapper in [zsh_wrapper(), bash_rc(), fish_vendor_config()] {
            assert!(wrapper.contains("%25"));
            assert!(wrapper.contains("%20"));
            assert!(wrapper.contains("%23"));
            assert!(wrapper.contains("%3F"));
        }
    }

    #[test]
    fn shell_quote_preserves_single_quotes() {
        assert_eq!(shell_quote("/tmp/a b"), "'/tmp/a b'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn ssh_destination_rejects_control_characters_without_rejecting_config_aliases() {
        assert_eq!(
            normalized_ssh_destination(" dev@bastion "),
            Ok("dev@bastion")
        );
        assert_eq!(normalized_ssh_destination("build-prod"), Ok("build-prod"));
        assert!(normalized_ssh_destination("dev@host\ncommand").is_err());
        assert!(normalized_ssh_destination("\t").is_err());
    }

    #[test]
    fn ssh_workspace_bootstrap_is_ephemeral_and_marks_remote_agents() {
        let bootstrap = remote_agent_bootstrap_script();
        assert!(bootstrap.contains("mktemp -d"));
        assert!(bootstrap.contains("trap 'rm -rf \"$_junqi_root\"' 0 HUP INT TERM"));
        assert!(bootstrap.contains("for _junqi_slug in claude codex gemini opencode amp cursor-agent copilot grok agy kimi pi kiro-cli droid"));
        assert!(bootstrap.contains("junqi-agent:%s:running"));
        assert!(bootstrap.contains("junqi-agent:%s:ended"));
        assert!(bootstrap.contains("zsh -i"));
        assert!(bootstrap.contains("bash --rcfile"));
        let command = ssh_workspace_remote_command();
        assert!(command.starts_with("sh -lc '"));
        assert!(command.ends_with('\''));
    }

    #[cfg(unix)]
    #[test]
    fn agent_shim_only_marks_interactive_junqi_terminals() {
        let shim = unix_agent_shim();
        assert!(shim.contains("[ ! -t 0 ] && [ ! -t 1 ]"));
        assert!(shim.contains("JUNQI_SURFACE_ID"));
        assert!(shim.contains("junqi-agent:%s:running"));
        assert!(shim.contains("junqi-agent:%s:ended"));
        assert!(shim.contains("exit \"$_junqi_status\""));
        assert!(shim.contains("exec \"$_junqi_real\" \"$@\""));
    }
}
