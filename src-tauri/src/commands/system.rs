use crate::commands::node_runtime::{NodeRequirementSource, NodeRuntimeRequirement};
use crate::paths;
use crate::platform;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;

const RUNTIME_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
// A binary that was just written to disk by an installer/npm (Node, npm, Git,
// or the OpenClaw JS entry) is unscanned by Windows Defender's on-access
// scanner; its first execution here can stall well past 10s before producing
// any output. RUNTIME_PROBE_TIMEOUT stays tight for probes against arbitrary,
// already-established project environments (get_terminal_env); checks that
// specifically validate a runtime we may have just installed need cold-start
// headroom instead of misreading "still being scanned" as "broken".
const FRESH_INSTALL_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

// A single Node smoke run can time out on a perfectly valid install while
// Windows Defender is still scanning freshly written files. Retrying a few
// times keeps that transient scan from being misread as a corrupt package,
// which upstream would otherwise "repair" with a full reinstall. A genuinely
// broken entry fails fast (non-zero exit), so the retries only add latency in
// the transient case they exist to survive.
const OPENCLAW_SMOKE_PROBE_ATTEMPTS: usize = 3;
const OPENCLAW_SMOKE_PROBE_RETRY_BACKOFF: std::time::Duration =
    std::time::Duration::from_millis(750);

#[derive(Debug, Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub home_dir: String,
    pub desktop_dir: String,
}

#[derive(Debug, Serialize)]
pub struct GitStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<RuntimeToolSource>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<RuntimeToolSource>,
}

/// Immutable npm process contract for one selected Node.js distribution.
///
/// npm must always run through the `npm-cli.js` bundled with the Node.js
/// executable selected by JunQi. Resolving `npm` from PATH can combine a
/// compatible Node.js executable with an unrelated npm shim, which changes
/// both the effective prefix and npmrc lookup. This context centralizes that
/// relationship and gives every npm operation the same stable working
/// directory and child PATH.
#[derive(Debug, Clone)]
pub(crate) struct NpmExecutionContext {
    node: PathBuf,
    npm_cli: PathBuf,
    search_path: String,
    working_dir: Option<PathBuf>,
}

impl NpmExecutionContext {
    pub(crate) fn for_node(node: &Path) -> Result<Self, String> {
        let npm_cli = npm_cli_for_node(node).ok_or_else(|| {
            format!(
                "Selected Node.js runtime at {} does not provide a bundled npm CLI",
                node.display()
            )
        })?;
        Ok(Self {
            node: node.to_path_buf(),
            npm_cli,
            search_path: search_path_with_executable_parent(node, &openclaw_search_path()),
            working_dir: stable_openclaw_working_dir().filter(|path| path.is_dir()),
        })
    }

    pub(crate) fn npm_cli(&self) -> &Path {
        &self.npm_cli
    }

    pub(crate) fn node(&self) -> &Path {
        &self.node
    }

    /// Build a command that invokes the selected Node.js executable and its
    /// bundled npm CLI. Callers add npm arguments and explicit per-operation
    /// settings such as registry, cache, or global prefix afterwards.
    pub(crate) fn command(&self) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(&self.node);
        command.arg(&self.npm_cli).env("PATH", &self.search_path);
        if let Some(working_dir) = &self.working_dir {
            command.current_dir(working_dir);
        }
        platform::configure_background_command(&mut command);
        command
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeToolSource {
    System,
    Custom,
}

/// The resolved process program for an OpenClaw invocation.
///
/// npm installs command shims, not Node entry scripts. Resolve and validate
/// the package entry before constructing any command so no caller can pass a
/// `.cmd` shim to Node by mistake.
#[derive(Debug, Clone)]
pub(crate) enum NativeOpenclawLaunchSpec {
    NodeScript { node: PathBuf, entry: PathBuf },
    Executable { program: PathBuf },
}

/// A native OpenClaw process contract resolved once from the selected runtime.
#[derive(Debug, Clone)]
pub(crate) struct NativeOpenclawRuntime {
    launch: NativeOpenclawLaunchSpec,
    package_dir: Option<PathBuf>,
    npm_prefix: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NativeOpenclawRuntimeIdentity {
    pub node: Option<PathBuf>,
    pub package_dir: Option<PathBuf>,
    pub executable: Option<PathBuf>,
    pub npm_prefix: Option<PathBuf>,
}

/// The complete process contract for one native OpenClaw invocation.
///
/// Commands must not independently reconstruct this environment: doing so
/// makes a desktop launch directory, a PATH change, or a storage migration
/// affect only some OpenClaw operations. The context owns those invariants and
/// lets callers override only their explicit Gateway working directory.
#[derive(Debug, Clone)]
pub(crate) struct OpenclawCommandContext {
    state_dir: PathBuf,
    config_path: PathBuf,
    working_dir: Option<PathBuf>,
    search_path: String,
    locale: String,
    npm_prefix: Option<PathBuf>,
    npm_cache_dir: Option<PathBuf>,
}

impl OpenclawCommandContext {
    /// Standard context for maintenance commands such as update, repair,
    /// doctor, and config validation. A GUI process can start at a drive root
    /// on Windows, so never inherit its working directory.
    pub(crate) fn maintenance() -> Result<Self, String> {
        let locations = paths::effective_runtime_locations()?;
        Ok(Self::for_runtime_locations(locations))
    }

    /// Context for a specific state/config pair, including storage migration
    /// service operations. It retains the same stable maintenance directory.
    pub(crate) fn for_paths(state_dir: PathBuf, config_path: PathBuf) -> Self {
        Self::with_working_dir(
            state_dir,
            config_path,
            stable_openclaw_working_dir(),
            paths::configured_npm_prefix(),
            paths::configured_npm_cache_dir(),
        )
    }

    /// Build a command context from one resolved runtime-location snapshot.
    ///
    /// Maintenance operations may run while storage setup persists a new
    /// bootstrap. Keeping the npm values in the same snapshot as state and
    /// config prevents one process from combining the old package location
    /// with the new state location.
    fn for_runtime_locations(locations: paths::EffectiveRuntimeLocations) -> Self {
        Self::with_working_dir(
            locations.state_dir,
            locations.config_path,
            stable_openclaw_working_dir(),
            locations.npm_prefix,
            locations.npm_cache_dir,
        )
    }

    fn with_working_dir(
        state_dir: PathBuf,
        config_path: PathBuf,
        working_dir: Option<PathBuf>,
        npm_prefix: Option<PathBuf>,
        npm_cache_dir: Option<PathBuf>,
    ) -> Self {
        let locale = configured_openclaw_locale(&config_path);
        Self {
            state_dir,
            config_path,
            working_dir,
            search_path: openclaw_search_path(),
            locale,
            npm_prefix,
            npm_cache_dir,
        }
    }

    /// BUG-WIN-CWD-01: state_dir (data directory) and Gateway's working directory
    /// must be decoupled.  `realpathSync('C:')` fires when cwd lands on a
    /// drive root.  Using `stable_openclaw_working_dir()` guarantees a non-root user
    /// home regardless of where JunQi's own process was launched from, while
    /// OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH still point at the user's chosen
    /// data directory (F: or any other drive).  This separates data location
    /// from runtime cwd without relying on the unpredictable parent cwd.
    pub(crate) fn managed_gateway(state_dir: PathBuf, config_path: PathBuf) -> Self {
        Self::with_working_dir(
            state_dir,
            config_path,
            stable_openclaw_working_dir(),
            paths::configured_npm_prefix(),
            paths::configured_npm_cache_dir(),
        )
    }

    pub(crate) fn with_search_path(mut self, search_path: impl Into<String>) -> Self {
        self.search_path = search_path.into();
        self
    }

    fn apply(&self, command: &mut tokio::process::Command) {
        if let Some(working_dir) = self.working_dir.as_ref().filter(|path| path.is_dir()) {
            command.current_dir(working_dir);
        }
        command
            .env("PATH", &self.search_path)
            .env("OPENCLAW_STATE_DIR", &self.state_dir)
            .env("OPENCLAW_CONFIG_PATH", &self.config_path)
            .env("OPENCLAW_LOCALE", &self.locale)
            .env("OPENCLAW_NO_RESPAWN", "1")
            .env("NO_COLOR", "1");
        if openclaw_debug_enabled() {
            command.env("OPENCLAW_DEBUG", "1");
        }
        // Keep package-manager child operations on the same user-selected
        // npm installation as the OpenClaw entry point. These are process
        // scoped and never rewrite the user's npmrc.
        if let Some(prefix) = &self.npm_prefix {
            command.env("npm_config_prefix", prefix);
        }
        if let Some(cache) = &self.npm_cache_dir {
            command.env("npm_config_cache", cache);
        }
        platform::configure_background_command(command);
    }
}

fn openclaw_debug_enabled() -> bool {
    cfg!(debug_assertions)
        || std::env::var("JUNQI_OPENCLAW_DEBUG")
            .ok()
            .is_some_and(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
}

fn stable_openclaw_working_dir() -> Option<PathBuf> {
    paths::stable_openclaw_working_dir()
}

/// Bootstrap locale used only when a Gateway config has no locale of its own.
/// Once persisted, `env.vars.OPENCLAW_LOCALE` is the Gateway's source of truth;
/// wizard display text is never translated in the JunQi webview.
pub(crate) fn managed_openclaw_locale() -> &'static str {
    openclaw_locale_for_application_language(&crate::commands::app_settings::application_language())
}

/// Read the Gateway-owned locale from its config. The application language is
/// only a bootstrap value for a config that has not declared one yet.
pub(crate) fn configured_openclaw_locale(config_path: &Path) -> String {
    std::fs::read_to_string(config_path)
        .ok()
        .and_then(|raw| crate::commands::config::parse_openclaw_config(&raw).ok())
        .and_then(|config| {
            config
                .get("env")
                .and_then(|env| env.get("vars"))
                .and_then(|vars| vars.get("OPENCLAW_LOCALE"))
                .and_then(|locale| locale.as_str())
                .map(str::trim)
                .filter(|locale| !locale.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| managed_openclaw_locale().to_string())
}

fn openclaw_locale_for_application_language(language: &str) -> &'static str {
    match language {
        "zh" => "zh-CN",
        "zh-TW" => "zh-TW",
        _ => "en-US",
    }
}

impl NativeOpenclawRuntime {
    pub(crate) fn command(&self, context: &OpenclawCommandContext) -> tokio::process::Command {
        let mut command = match &self.launch {
            NativeOpenclawLaunchSpec::NodeScript { node, entry } => {
                let mut command = tokio::process::Command::new(node);
                command.arg(entry);
                command
            }
            NativeOpenclawLaunchSpec::Executable { program } => {
                tokio::process::Command::new(program)
            }
        };
        context.apply(&mut command);
        if let NativeOpenclawLaunchSpec::NodeScript { node, .. } = &self.launch {
            command.env(
                "PATH",
                search_path_with_executable_parent(node, &context.search_path),
            );
        }
        if let Some(prefix) = &self.npm_prefix {
            command.env("npm_config_prefix", prefix);
        }
        command
    }

    pub(crate) fn identity(&self) -> NativeOpenclawRuntimeIdentity {
        let (node, executable) = match &self.launch {
            NativeOpenclawLaunchSpec::NodeScript { node, .. } => (Some(node.clone()), None),
            NativeOpenclawLaunchSpec::Executable { program } => (None, Some(program.clone())),
        };
        NativeOpenclawRuntimeIdentity {
            node,
            package_dir: self.package_dir.clone(),
            executable,
            npm_prefix: self.npm_prefix.clone(),
        }
    }

    /// Persist the exact launch plan only while a runtime relocation is
    /// pending. Recovery uses it to stop a pre-existing official service when
    /// the candidate Node/npm locations are intentionally not usable yet.
    pub(crate) fn gateway_service_launch_contract(
        &self,
    ) -> paths::NativeGatewayServiceLaunchContract {
        let (node, entry, executable) = match &self.launch {
            NativeOpenclawLaunchSpec::NodeScript { node, entry } => {
                (Some(node.clone()), Some(entry.clone()), None)
            }
            NativeOpenclawLaunchSpec::Executable { program } => (None, None, Some(program.clone())),
        };
        paths::NativeGatewayServiceLaunchContract {
            node,
            entry,
            executable,
            package_dir: self.package_dir.clone(),
            npm_prefix: self.npm_prefix.clone(),
        }
    }

    /// A platform-neutral launch plan for terminal integration. The terminal
    /// renderer receives this value rather than resolving a fresh PATH Node.
    pub(crate) fn launcher_spec(&self) -> NativeOpenclawLaunchSpec {
        self.launch.clone()
    }

    pub(crate) fn npm_prefix(&self) -> Option<&Path> {
        self.npm_prefix.as_deref()
    }
}

/// Reconstruct a service-only runtime from a memento captured while the
/// previous environment was verified. This deliberately avoids current
/// bootstrap discovery: a candidate portable Node/npm prefix may not exist
/// yet, but the old service must still be stopped safely before recovery can
/// restore that previous layout.
pub(crate) fn native_openclaw_runtime_from_gateway_service_launch_contract(
    contract: &paths::NativeGatewayServiceLaunchContract,
) -> Result<NativeOpenclawRuntime, String> {
    let launch = match (&contract.node, &contract.entry, &contract.executable) {
        (Some(node), Some(entry), None) if node.is_file() && entry.is_file() => {
            NativeOpenclawLaunchSpec::NodeScript {
                node: node.clone(),
                entry: entry.clone(),
            }
        }
        (None, None, Some(program)) if program.is_file() => NativeOpenclawLaunchSpec::Executable {
            program: program.clone(),
        },
        _ => {
            return Err(
                "The previous OpenClaw service launch contract is incomplete or no longer exists"
                    .to_string(),
            )
        }
    };
    let package_dir = contract.package_dir.clone().or_else(|| match &launch {
        NativeOpenclawLaunchSpec::NodeScript { entry, .. } => entry.parent().map(Path::to_path_buf),
        NativeOpenclawLaunchSpec::Executable { .. } => None,
    });
    Ok(NativeOpenclawRuntime {
        launch,
        package_dir,
        npm_prefix: contract.npm_prefix.clone(),
    })
}

pub(crate) fn native_openclaw_runtime(
    binary: PathBuf,
    node: &NodeStatus,
) -> Result<NativeOpenclawRuntime, String> {
    if !node.available {
        return Err("A compatible Node.js runtime is not available".to_string());
    }
    let node = node
        .path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            "The compatible Node.js runtime did not report an executable path".to_string()
        })?;
    let package_dir = openclaw_package_dir(&binary);
    let npm_prefix = npm_prefix_for_openclaw_binary(&binary, cfg!(windows));
    Ok(NativeOpenclawRuntime {
        launch: resolve_native_openclaw_launch(binary, node)?,
        package_dir,
        npm_prefix,
    })
}

/// Resolve the selected native OpenClaw executable and a compatible Node.js
/// runtime without changing the machine. Mutating workflows call setup's
/// ensure helper first, then construct this same context from its result.
pub(crate) async fn resolve_compatible_native_openclaw_runtime(
) -> Result<NativeOpenclawRuntime, String> {
    let binary = resolve_openclaw_binary_async().await.ok_or_else(|| {
        "OpenClaw is not installed; official CLI operations are unavailable".to_string()
    })?;
    compatible_native_openclaw_runtime(binary).await
}

pub(crate) async fn compatible_native_openclaw_runtime(
    binary: PathBuf,
) -> Result<NativeOpenclawRuntime, String> {
    let requirement = node_requirement_for_openclaw_binary(&binary)?;
    let node = check_node_for_requirement(&requirement).await?;
    if !node.available {
        return Err(format!(
            "OpenClaw requires Node.js {}; no compatible runtime was found",
            requirement.expression()
        ));
    }
    native_openclaw_runtime(binary, &node)
}

#[derive(Debug, Clone, Serialize)]
pub struct NpmStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<String>,
    pub reason: Option<String>,
}

impl NpmStatus {
    fn available(version: String, path: PathBuf) -> Self {
        Self {
            available: true,
            version: Some(version),
            path: Some(path.to_string_lossy().into_owned()),
            source: Some("selected-node".into()),
            reason: None,
        }
    }

    fn unavailable(path: Option<PathBuf>, reason: impl Into<String>) -> Self {
        Self {
            available: false,
            version: None,
            path: path.map(|path| path.to_string_lossy().into_owned()),
            source: Some("selected-node".into()),
            reason: Some(reason.into()),
        }
    }
}

/// The Node.js and npm pair selected for one OpenClaw requirement.
///
/// Consumers must use this value as a unit. Resolving Node from one PATH entry
/// and npm from another is not a supported runtime configuration.
#[derive(Debug, Clone)]
pub(crate) struct NodeRuntimeContract {
    node: NodeStatus,
    npm: NpmStatus,
}

/// Candidate Node.js runtimes for a single OpenClaw requirement. An explicit
/// user-selected runtime is represented as the only candidate, so it can never
/// silently fall through to a system PATH entry.
struct NodeRequirementCandidates {
    compatible: Vec<NodeStatus>,
    fallback: NodeStatus,
}

impl NodeRequirementCandidates {
    fn into_preferred_node(self) -> NodeStatus {
        let Self {
            compatible,
            fallback,
        } = self;
        compatible.into_iter().next().unwrap_or(fallback)
    }
}

/// Select the first compatible Node.js+npm pair. If every compatible system
/// Node has a damaged bundled npm, retain the first one so the caller can
/// report its concrete diagnostic instead of silently mixing npm from PATH.
#[derive(Default)]
struct NodeRuntimeCandidateSelection {
    first_incomplete: Option<NodeRuntimeContract>,
}

impl NodeRuntimeCandidateSelection {
    fn consider(&mut self, candidate: NodeRuntimeContract) -> Option<NodeRuntimeContract> {
        if candidate.npm.available {
            return Some(candidate);
        }
        if self.first_incomplete.is_none() {
            self.first_incomplete = Some(candidate);
        }
        None
    }

    fn finish(self) -> Option<NodeRuntimeContract> {
        self.first_incomplete
    }
}

impl NodeRuntimeContract {
    pub(crate) async fn resolve(requirement: &NodeRuntimeRequirement) -> Result<Self, String> {
        let NodeRequirementCandidates {
            compatible,
            fallback,
        } = node_requirement_candidates(requirement).await?;
        let mut selection = NodeRuntimeCandidateSelection::default();
        for node in compatible {
            let candidate = Self::from_node(node).await;
            if let Some(selected) = selection.consider(candidate) {
                return Ok(selected);
            }
        }
        if let Some(incomplete) = selection.finish() {
            return Ok(incomplete);
        }
        Ok(Self::from_node(fallback).await)
    }

    pub(crate) async fn from_node(node: NodeStatus) -> Self {
        let npm = check_npm_for_node(&node).await;
        Self { node, npm }
    }

    pub(crate) fn node(&self) -> &NodeStatus {
        &self.node
    }

    pub(crate) fn npm(&self) -> &NpmStatus {
        &self.npm
    }

    pub(crate) fn into_statuses(self) -> (NodeStatus, NpmStatus) {
        (self.node, self.npm)
    }
}

#[derive(Debug, Serialize)]
pub struct OpenclawStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<String>,
    pub binary_found: bool,
    pub version_ok: bool,
    pub package_valid: bool,
    pub gateway_command_ok: bool,
    pub relocation_required: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct OpenclawBinarySelection {
    path: String,
}

/// Identity of an OpenClaw payload that already passed the Node smoke probe.
///
/// The fields are all cheap, filesystem-only reads. A match means the exact
/// same package that verified before is still on disk, so the expensive Node
/// probe can be skipped. Any real install/upgrade changes the version or the
/// entry file's size/mtime, which invalidates the cache and forces a fresh
/// probe. Node selection is deliberately excluded: OpenClaw being installed is
/// a property of the package, not of whichever Node happens to be selected —
/// Node compatibility is enforced separately on the runtime-start path.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
struct OpenclawVerifiedRuntime {
    path: String,
    version: String,
    entry_len: u64,
    entry_mtime_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeRuntimeProbe {
    exec_path: String,
    version: String,
}

fn parse_node_runtime_probe(output: &[u8]) -> Option<(String, String)> {
    let probe: NodeRuntimeProbe = serde_json::from_slice(output).ok()?;
    let exec_path = probe.exec_path.trim();
    let version = probe.version.trim();
    (!exec_path.is_empty() && !version.is_empty()).then(|| (exec_path.into(), version.into()))
}

/// Resolve a PATH candidate through Node itself before locating bundled npm.
/// Version managers commonly expose a shim as `node`; `process.execPath`
/// points at the actual distribution whose `node_modules/npm` belongs to it.
async fn resolve_node_runtime(node_path: &str) -> Option<(String, String)> {
    let mut command = tokio::process::Command::new(node_path);
    command
        .args([
            "-p",
            "JSON.stringify({execPath: process.execPath, version: process.version})",
        ])
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    let output = tokio::time::timeout(FRESH_INSTALL_PROBE_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;

    output.status.success().then_some(())?;
    parse_node_runtime_probe(&output.stdout)
}

/// Verify the npm CLI that belongs to an already selected Node.js executable.
///
/// This is deliberately separate from PATH discovery. A machine may expose an
/// old `npm.cmd` before the compatible Node.js selected for OpenClaw; invoking
/// that shim would mix two runtimes and can install OpenClaw into the wrong
/// prefix. The selected Node's bundled npm CLI is the only acceptable npm
/// contract for managed installation.
pub(crate) async fn check_npm_for_node(node: &NodeStatus) -> NpmStatus {
    let Some(node_path) = node.path.as_deref().filter(|path| !path.trim().is_empty()) else {
        return NpmStatus::unavailable(
            None,
            "The selected Node.js runtime did not report an executable path",
        );
    };
    let context = match NpmExecutionContext::for_node(Path::new(node_path)) {
        Ok(context) => context,
        Err(_) => {
            return NpmStatus::unavailable(
                None,
                "The selected Node.js runtime does not include its bundled npm CLI",
            );
        }
    };
    let npm_cli = context.npm_cli().to_path_buf();

    let mut command = context.command();
    command.arg("--version").kill_on_drop(true);
    match tokio::time::timeout(FRESH_INSTALL_PROBE_TIMEOUT, command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if version.is_empty() {
                NpmStatus::unavailable(
                    Some(npm_cli),
                    "The selected Node.js runtime returned an empty npm version",
                )
            } else {
                NpmStatus::available(version, npm_cli)
            }
        }
        Ok(Ok(_)) => NpmStatus::unavailable(
            Some(npm_cli),
            "The selected Node.js runtime could not execute its bundled npm CLI",
        ),
        Ok(Err(error)) => NpmStatus::unavailable(
            Some(npm_cli),
            format!("Failed to start npm from the selected Node.js runtime: {error}"),
        ),
        Err(_) => NpmStatus::unavailable(
            Some(npm_cli),
            "The selected Node.js runtime timed out while checking its bundled npm CLI",
        ),
    }
}

/// Apply the user's explicit npm cache choice to a child npm/OpenClaw process.
/// When no override exists, leave the variable unset so npm resolves the
/// active user's native cache location itself.
pub(crate) fn apply_configured_npm_cache(command: &mut tokio::process::Command) {
    if let Some(cache) = paths::configured_npm_cache_dir() {
        command.env("npm_config_cache", cache);
    }
}

fn npm_openclaw_entry(binary: &Path) -> Option<PathBuf> {
    if binary
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return None;
    }
    let entry = openclaw_package_dir(binary)?.join("openclaw.mjs");
    entry.is_file().then_some(entry)
}

fn resolve_native_openclaw_launch(
    binary: PathBuf,
    node: PathBuf,
) -> Result<NativeOpenclawLaunchSpec, String> {
    if let Some(entry) = npm_openclaw_entry(&binary) {
        return Ok(NativeOpenclawLaunchSpec::NodeScript {
            node,
            entry: path_for_node_argument(&entry),
        });
    }
    if is_npm_command_shim(&binary) {
        return Err(format!(
            "OpenClaw npm shim cannot be resolved to its JavaScript entry point: {}. Reinstall or re-detect OpenClaw after changing npm's global prefix.",
            binary.display()
        ));
    }
    Ok(NativeOpenclawLaunchSpec::Executable { program: binary })
}

fn is_npm_command_shim(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("ps1")
        })
}

/// Normalize a path for use as a Node.js process argument. Windows verbatim
/// (`\\?\`) prefixes break Node's fs/path handling, so they are stripped the
/// same way for every Node invocation (gateway entrypoint, probes).
pub(crate) fn path_for_node_argument(path: &Path) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(strip_windows_verbatim_prefix(&path.to_string_lossy()))
    } else {
        path.to_path_buf()
    }
}

/// Locate the npm CLI shipped with the exact Node.js executable selected for
/// an installation. This avoids mixing a compatible Node.js with an unrelated
/// `npm` shim from PATH after a system upgrade or a custom portable runtime.
pub(crate) fn npm_cli_for_node(node: &Path) -> Option<PathBuf> {
    let bin_dir = node.parent()?;
    let direct = bin_dir
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    if direct.is_file() {
        return Some(direct);
    }
    let unix_global = bin_dir
        .parent()?
        .join("lib")
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    unix_global.is_file().then_some(unix_global)
}

#[tauri::command]
pub async fn get_platform_info() -> Result<PlatformInfo, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let ma_dir = paths::desktop_dir();

    Ok(PlatformInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        home_dir: home.to_string_lossy().to_string(),
        desktop_dir: ma_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn check_node() -> Result<NodeStatus, String> {
    let requirement = installed_openclaw_node_requirement().await?;
    check_node_for_requirement(&requirement).await
}

pub(crate) async fn check_node_for_requirement(
    requirement: &NodeRuntimeRequirement,
) -> Result<NodeStatus, String> {
    Ok(node_requirement_candidates(requirement)
        .await?
        .into_preferred_node())
}

async fn node_requirement_candidates(
    requirement: &NodeRuntimeRequirement,
) -> Result<NodeRequirementCandidates, String> {
    paths::validate_runtime_overrides()?;
    // An explicit portable runtime is the user's choice and must not drift to
    // whichever Node.js happens to be first on PATH. A missing or incompatible
    // selected runtime is reported as such so recovery can repair that exact
    // location instead of silently changing environments.
    if let Some(configured) = paths::configured_node_path() {
        let path_str = configured.to_string_lossy().to_string();
        let runtime = resolve_node_runtime(&path_str).await;
        let (path_str, version) = match runtime {
            Some((resolved_path, version)) => (resolved_path, Some(version)),
            None => (path_str, None),
        };
        let node = NodeStatus {
            available: version
                .as_ref()
                .is_some_and(|version| requirement.supports(version)),
            version,
            path: Some(path_str),
            source: Some(RuntimeToolSource::Custom),
        };
        return Ok(NodeRequirementCandidates {
            compatible: node.available.then_some(node.clone()).into_iter().collect(),
            fallback: node,
        });
    }

    // System Node.js may have multiple installations on PATH. Evaluate every
    // candidate so an obsolete version-manager shim cannot hide a compatible
    // system Node.js that appears later in PATH.
    let candidates = platform::detect_paths("node");
    let candidates = if candidates.is_empty() {
        vec![platform::bin_name("node")]
    } else {
        candidates
    };
    let mut compatible = Vec::new();
    let mut detected_incompatible = None;
    for system_node in candidates {
        let runtime = resolve_node_runtime(&system_node).await;
        let (system_path, system_version) = match runtime {
            Some((resolved_path, version)) => (resolved_path, Some(version)),
            None => (system_node, None),
        };
        let node = NodeStatus {
            available: system_version
                .as_ref()
                .is_some_and(|version| requirement.supports(version)),
            version: system_version,
            path: Some(system_path),
            source: Some(RuntimeToolSource::System),
        };
        if node.available {
            compatible.push(node);
            continue;
        }
        if node.version.is_some() && detected_incompatible.is_none() {
            detected_incompatible = Some(node);
        }
    }

    let fallback = detected_incompatible.unwrap_or(NodeStatus {
        available: false,
        version: None,
        path: None,
        source: None,
    });
    Ok(NodeRequirementCandidates {
        compatible,
        fallback,
    })
}

#[tauri::command]
pub async fn check_openclaw() -> Result<OpenclawStatus, String> {
    Ok(detect_openclaw().await)
}

pub(crate) fn openclaw_search_path() -> String {
    // Prefer locations selected by setup or reported by npm. Generic PATH is
    // retained as the final discovery surface; do not infer a user profile or
    // an installation directory from a machine-specific directory pattern.
    let mut path_parts = vec![
        paths::configured_node_path()
            .filter(|path| path.is_file())
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        paths::configured_git_path()
            .filter(|path| path.is_file())
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        // The setup guide persists a user-selected prefix. Search its exact
        // npm shim directory before any heuristic so restarts keep using the
        // location the user approved.
        paths::configured_npm_prefix()
            .map(|prefix| paths::npm_bin_dir_for_prefix(&prefix))
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        // Tier 1: user's actual npm prefix (read from `~/.npmrc`). This is
        // the canonical `npm i -g openclaw` bin dir the user finds on PATH.
        paths::user_npm_bin_dir()
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_default(),
    ];
    for env_key in [
        "OPENCLAW_HOME",
        "PNPM_HOME",
        "BUN_INSTALL",
        "VOLTA_HOME",
        "CARGO_HOME",
    ] {
        if let Ok(value) = std::env::var(env_key) {
            let base = std::path::PathBuf::from(value);
            path_parts.push(base.to_string_lossy().to_string());
            path_parts.push(base.join("bin").to_string_lossy().to_string());
        }
    }
    if let Ok(existing) = std::env::var("PATH") {
        path_parts.push(existing);
    }
    path_parts.join(if cfg!(windows) { ";" } else { ":" })
}

/// Put the parent directory of a resolved executable ahead of a child PATH.
/// Node's npm CLI and OpenClaw plugins can spawn `node` by name; retaining the
/// original PATH order would otherwise let an older version-manager shim take
/// over after JunQi had already selected a compatible Node.js executable.
pub(crate) fn search_path_with_executable_parent(executable: &Path, base: &str) -> String {
    let Some(parent) = executable
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    else {
        return base.to_string();
    };
    let entries = std::iter::once(parent.to_path_buf()).chain(std::env::split_paths(base));
    std::env::join_paths(entries)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| {
            let separator = if cfg!(windows) { ";" } else { ":" };
            format!("{}{}{}", parent.display(), separator, base)
        })
}

pub(crate) fn validate_openclaw_binary_override() -> Result<(), String> {
    let Some(raw) = std::env::var_os("OPENCLAW_BIN").filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let path = PathBuf::from(raw);
    if !path.is_absolute() || path.parent().is_none_or(|parent| parent == path) {
        return Err("OPENCLAW_BIN must be an absolute non-root path".into());
    }
    if !is_valid_openclaw_candidate(&path) {
        return Err(format!(
            "OPENCLAW_BIN does not point to a complete OpenClaw installation: {}",
            path.display()
        ));
    }
    if let Some(checkout) = paths::runtime_location_overrides()?.openclaw_git_dir {
        let package = openclaw_package_dir(&path)
            .ok_or("OPENCLAW_BIN is not inside the selected OpenClaw Git checkout")?;
        if !paths::paths_refer_to_same_location(&package, &checkout) {
            return Err(format!(
                "OPENCLAW_BIN ({}) conflicts with OPENCLAW_GIT_DIR ({})",
                path.display(),
                checkout.display()
            ));
        }
    } else if let Some(prefix) = paths::configured_npm_prefix() {
        let installed_prefix = npm_prefix_for_openclaw_binary(&path, cfg!(windows))
            .ok_or("OPENCLAW_BIN is not inside the selected npm prefix")?;
        if !paths::paths_refer_to_same_location(&installed_prefix, &prefix) {
            return Err(format!(
                "OPENCLAW_BIN ({}) conflicts with the selected npm prefix ({})",
                path.display(),
                prefix.display()
            ));
        }
    }
    Ok(())
}

fn openclaw_binary_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["openclaw.cmd", "openclaw.exe", "openclaw"]
    } else {
        &["openclaw"]
    }
}

fn is_legacy_brand_wrapper(path: &Path) -> bool {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    canonical
        .to_string_lossy()
        .to_lowercase()
        .contains(&format!("{}{}", "cla", "wx"))
}

fn is_valid_openclaw_candidate(path: &Path) -> bool {
    path.exists() && !is_legacy_brand_wrapper(path) && has_openclaw_package_contract(path)
}

/// Read a previously verified launcher as a candidate only.
///
/// The persisted file is a convenience record, not an npm configuration
/// authority. npm's effective prefix can change in a global config file that
/// JunQi does not own, so prefix ownership is checked later against the npm
/// CLI paired with each visible Node.js runtime.
fn read_saved_openclaw_binary() -> Option<PathBuf> {
    for selection_path in paths::openclaw_binary_selection_read_paths() {
        let Ok(raw) = std::fs::read_to_string(selection_path) else {
            continue;
        };
        let Ok(selection) = serde_json::from_str::<OpenclawBinarySelection>(&raw) else {
            continue;
        };
        let path = PathBuf::from(selection.path);
        if is_valid_openclaw_candidate(&path) {
            return Some(path);
        }
    }
    None
}

pub(crate) fn persist_selected_openclaw_binary(path: &Path) -> Result<(), String> {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if !is_valid_openclaw_candidate(&canonical) {
        return Err(format!(
            "Refusing to persist invalid OpenClaw binary: {}",
            path.display()
        ));
    }

    let selection_path = paths::openclaw_binary_selection_path();
    if let Some(parent) = selection_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create OpenClaw runtime dir: {}", e))?;
    }
    let payload = serde_json::to_string_pretty(&OpenclawBinarySelection {
        path: canonical.to_string_lossy().to_string(),
    })
    .map_err(|e| format!("Failed to serialize OpenClaw binary selection: {}", e))?;
    std::fs::write(&selection_path, payload)
        .map_err(|e| format!("Failed to write OpenClaw binary selection: {}", e))
}

/// Build the cache identity for an installed OpenClaw payload. Returns `None`
/// for installs without a resolvable `openclaw.mjs` entry (e.g. an executable
/// package), which fall back to the live smoke probe unconditionally.
fn openclaw_runtime_signature(binary: &Path) -> Option<OpenclawVerifiedRuntime> {
    let canonical = std::fs::canonicalize(binary).unwrap_or_else(|_| binary.to_path_buf());
    let metadata = read_openclaw_package_metadata(binary)?;
    let entry = npm_openclaw_entry(binary)?;
    let entry_meta = std::fs::metadata(&entry).ok()?;
    let entry_mtime_ms = entry_meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as u64)?;
    Some(OpenclawVerifiedRuntime {
        path: canonical.to_string_lossy().to_string(),
        version: metadata.version,
        entry_len: entry_meta.len(),
        entry_mtime_ms,
    })
}

fn read_verified_openclaw_runtime() -> Option<OpenclawVerifiedRuntime> {
    let raw = std::fs::read_to_string(paths::openclaw_verified_runtime_path()).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Record that a payload passed the Node smoke probe. Best-effort: a failure to
/// write the cache only costs an extra probe on the next launch, so errors are
/// swallowed rather than surfaced to the caller.
fn persist_verified_openclaw_runtime(signature: &OpenclawVerifiedRuntime) {
    let path = paths::openclaw_verified_runtime_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(payload) = serde_json::to_string_pretty(signature) {
        let _ = std::fs::write(&path, payload);
    }
}

/// Cheaply confirm the payload at `binary` still matches the last verified one.
fn openclaw_runtime_matches_verified_cache(binary: &Path) -> bool {
    match openclaw_runtime_signature(binary) {
        Some(current) => read_verified_openclaw_runtime().is_some_and(|saved| saved == current),
        None => false,
    }
}

/// A storage migration that changes npm's global prefix is incomplete until
/// OpenClaw has been installed and validated at the new target. Returning an
/// old saved binary during that window would silently undo the user's choice.
pub(crate) fn ensure_openclaw_relocation_complete() -> Result<(), String> {
    if paths::openclaw_relocation_required() {
        return Err(
            "OpenClaw's npm location changed. Complete the pending installation in the setup guide before continuing."
                .into(),
        );
    }
    Ok(())
}

/// Ask the bundled npm CLI of one specific Node.js runtime for its effective
/// global prefix. This is intentionally not an `npm` PATH lookup: a computer
/// can expose several Node.js/npm installations with incompatible prefixes.
pub(crate) async fn npm_global_prefix_for_node(node: &NodeStatus) -> Option<PathBuf> {
    let node_path = node.path.as_deref().map(Path::new)?;
    npm_global_prefix_for_node_path(node_path).await
}

async fn npm_global_prefix_for_node_path(node: &Path) -> Option<PathBuf> {
    let context = NpmExecutionContext::for_node(node).ok()?;
    let mut command = context.command();
    command
        .args(["config", "get", "prefix"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(std::time::Duration::from_secs(10), command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    normalize_npm_prefix(&String::from_utf8_lossy(&output.stdout))
}

fn normalize_npm_prefix(raw: &str) -> Option<PathBuf> {
    let value = raw.trim().trim_matches(['"', '\'']);
    if value.is_empty() || matches!(value, "null" | "undefined") {
        return None;
    }
    let path = if value == "~" {
        platform::home_dir()?
    } else if value.starts_with("~/") || value.starts_with("~\\") {
        platform::home_dir()?.join(value[2..].trim_start_matches(['/', '\\']))
    } else {
        PathBuf::from(value)
    };
    path.is_absolute().then_some(path)
}

/// Collect global npm prefixes from every visible Node.js installation. The
/// custom portable Node choice is exclusive; otherwise Windows PATH candidates
/// are all considered so an old version-manager shim cannot hide an existing
/// package installed by a later system Node.js release.
async fn npm_reported_global_prefixes() -> Vec<PathBuf> {
    let node_paths = if let Some(configured) = paths::configured_node_path() {
        vec![configured]
    } else {
        platform::detect_paths("node")
            .into_iter()
            .map(PathBuf::from)
            .collect()
    };
    let mut prefixes: Vec<PathBuf> = Vec::new();
    for node in node_paths {
        let Some(prefix) = npm_global_prefix_for_node_path(&node).await else {
            continue;
        };
        if !prefixes
            .iter()
            .any(|known| paths::paths_refer_to_same_location(known, &prefix))
        {
            prefixes.push(prefix);
        }
    }
    prefixes
}

#[derive(Debug)]
enum AuthoritativeOpenclawResolution {
    Resolved(PathBuf, String),
    Blocked,
    NotConfigured,
}

fn openclaw_binary_in_npm_prefix(prefix: &Path) -> Option<PathBuf> {
    let bin_dir = paths::npm_bin_dir_for_prefix(prefix);
    openclaw_binary_names()
        .iter()
        .map(|name| bin_dir.join(name))
        .find(|candidate| is_valid_openclaw_candidate(candidate))
}

/// Resolve sources whose location is explicitly selected by the user or by
/// JunQi. A missing package in one of these locations is a hard stop: falling
/// through to a stale npm installation would violate that selection.
fn resolve_authoritative_openclaw_binary() -> AuthoritativeOpenclawResolution {
    if paths::validate_runtime_overrides().is_err() || paths::openclaw_relocation_required() {
        return AuthoritativeOpenclawResolution::Blocked;
    }

    if let Some(raw) = std::env::var_os("OPENCLAW_BIN").filter(|value| !value.is_empty()) {
        let explicit = PathBuf::from(raw);
        if !is_valid_openclaw_candidate(&explicit) {
            return AuthoritativeOpenclawResolution::Blocked;
        }
        let overrides = match paths::runtime_location_overrides() {
            Ok(overrides) => overrides,
            Err(_) => return AuthoritativeOpenclawResolution::Blocked,
        };
        if overrides.openclaw_git_dir.is_none() {
            if let Some(prefix) = paths::configured_npm_prefix() {
                let Some(installed_prefix) =
                    npm_prefix_for_openclaw_binary(&explicit, cfg!(windows))
                else {
                    return AuthoritativeOpenclawResolution::Blocked;
                };
                if !paths::paths_refer_to_same_location(&installed_prefix, &prefix) {
                    return AuthoritativeOpenclawResolution::Blocked;
                }
            }
        }
        return AuthoritativeOpenclawResolution::Resolved(explicit, "OPENCLAW_BIN".into());
    }

    if let Some(checkout) = paths::runtime_location_overrides()
        .ok()
        .and_then(|overrides| overrides.openclaw_git_dir)
    {
        let entry = checkout.join("openclaw.mjs");
        return if is_valid_openclaw_candidate(&entry) {
            AuthoritativeOpenclawResolution::Resolved(entry, "OPENCLAW_GIT_DIR".into())
        } else {
            AuthoritativeOpenclawResolution::Blocked
        };
    }

    if let Some(prefix) = paths::configured_npm_prefix() {
        return openclaw_binary_in_npm_prefix(&prefix)
            .map(|binary| {
                AuthoritativeOpenclawResolution::Resolved(binary, "configured-npm-prefix".into())
            })
            .unwrap_or(AuthoritativeOpenclawResolution::Blocked);
    }

    AuthoritativeOpenclawResolution::NotConfigured
}

/// An npm-owned launcher can only be reused when it belongs to an npm prefix
/// reported by the same Node.js+npm pairs used for discovery. If probing is
/// unavailable altogether, retain a verified saved launcher as a recovery
/// candidate; it will still undergo the normal Node syntax smoke check.
fn npm_binary_matches_effective_prefixes(binary: &Path, prefixes: &[PathBuf]) -> bool {
    let Some(saved_prefix) = npm_prefix_for_openclaw_binary(binary, cfg!(windows)) else {
        return true;
    };
    prefixes.is_empty()
        || prefixes
            .iter()
            .any(|effective| paths::paths_refer_to_same_location(&saved_prefix, effective))
}

fn resolve_openclaw_binary_from_effective_prefixes(
    prefixes: &[PathBuf],
    saved: Option<PathBuf>,
) -> Option<(PathBuf, String)> {
    for prefix in prefixes {
        if let Some(binary) = openclaw_binary_in_npm_prefix(prefix) {
            return Some((binary, "npm-effective-prefix".into()));
        }
    }

    let saved = saved?;
    npm_binary_matches_effective_prefixes(&saved, prefixes).then(|| {
        let source = if npm_prefix_for_openclaw_binary(&saved, cfg!(windows)).is_some() {
            "saved-selection:effective-npm-prefix"
        } else {
            "saved-selection:external"
        };
        (saved, source.into())
    })
}

fn resolve_openclaw_binary_from_search_path(
    effective_prefixes: &[PathBuf],
) -> Option<(PathBuf, String)> {
    let search_path = openclaw_search_path();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let candidates = search_path
        .split(separator)
        .filter(|part| !part.trim().is_empty())
        .flat_map(|part| {
            let dir = PathBuf::from(part);
            openclaw_binary_names()
                .iter()
                .map(move |name| dir.join(name))
        })
        .filter(|path| path.exists())
        .collect::<Vec<_>>();

    let mut seen = HashSet::new();
    candidates.into_iter().find_map(|path| {
        let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        let marker = canonical.to_string_lossy().to_lowercase();
        (seen.insert(marker)
            && is_valid_openclaw_candidate(&path)
            && npm_binary_matches_effective_prefixes(&path, effective_prefixes))
        .then_some((path, "PATH".into()))
    })
}

/// Resolve OpenClaw through one canonical precedence chain.
///
/// Dynamic npm locations are always queried before the persisted launcher.
/// This prevents a saved binary from masking a later `npm config set prefix`
/// change in globalconfig, userconfig, an environment override, or a Node
/// version manager. Each prefix probe runs the npm CLI bundled with its own
/// Node.js executable, never an unrelated `npm` found through PATH.
pub(crate) async fn resolve_openclaw_binary_with_source_async() -> Option<(PathBuf, String)> {
    match resolve_authoritative_openclaw_binary() {
        AuthoritativeOpenclawResolution::Resolved(path, source) => return Some((path, source)),
        AuthoritativeOpenclawResolution::Blocked => return None,
        AuthoritativeOpenclawResolution::NotConfigured => {}
    }
    let prefixes = npm_reported_global_prefixes().await;
    resolve_openclaw_binary_from_effective_prefixes(&prefixes, read_saved_openclaw_binary())
        .or_else(|| resolve_openclaw_binary_from_search_path(&prefixes))
}

pub(crate) async fn resolve_openclaw_binary_async() -> Option<PathBuf> {
    resolve_openclaw_binary_with_source_async()
        .await
        .map(|(path, _)| path)
}

pub(crate) async fn detect_openclaw() -> OpenclawStatus {
    if let Err(error) = paths::validate_runtime_overrides() {
        return OpenclawStatus {
            installed: false,
            version: None,
            path: None,
            source: None,
            binary_found: false,
            version_ok: false,
            package_valid: false,
            gateway_command_ok: false,
            relocation_required: paths::openclaw_relocation_required(),
            error: Some(error),
        };
    }
    if let Err(error) = validate_openclaw_binary_override() {
        return OpenclawStatus {
            installed: false,
            version: None,
            path: None,
            source: None,
            binary_found: false,
            version_ok: false,
            package_valid: false,
            gateway_command_ok: false,
            relocation_required: paths::openclaw_relocation_required(),
            error: Some(error),
        };
    }
    let search_path = openclaw_search_path();
    let (path, source) = match resolve_openclaw_binary_with_source_async().await {
        Some(resolved) => resolved,
        None => {
            let relocation_required = paths::openclaw_relocation_required();
            return OpenclawStatus {
                installed: false,
                version: None,
                path: None,
                source: None,
                binary_found: false,
                version_ok: false,
                package_valid: false,
                gateway_command_ok: false,
                relocation_required,
                error: Some(
                    if relocation_required {
                        "OpenClaw needs to be installed in the selected npm location before it can run"
                    } else {
                        "OpenClaw binary was not found on JunQi's search path"
                    }
                    .into(),
                ),
            };
        }
    };
    let _ = persist_selected_openclaw_binary(&path);
    let mut status = validate_openclaw_binary(&path, &search_path).await;
    status.source = Some(source);
    status
}

pub(crate) async fn validate_openclaw_binary(path: &Path, _search_path: &str) -> OpenclawStatus {
    let path_string = path_for_display(path);
    let package_version = read_openclaw_pkg_version(path);
    let package_valid = has_openclaw_package_contract(path);
    // The package metadata is the authoritative version source. Running a
    // Windows `.cmd` shim through a generic process probe is unreliable and
    // was the original source of the `node ... openclaw.cmd` EISDIR failure.
    // The actual launcher contract is validated structurally, then runtime
    // commands resolve the package's `openclaw.mjs` entry through Node.
    let version = package_version;
    let version_ok = version.is_some();
    let entry_smoke_ok = if package_valid {
        // An unchanged payload that already passed the smoke probe stays
        // verified without re-running Node. This is the load-bearing guard
        // against a transient Windows Defender scan flipping a healthy install
        // to "corrupt" and triggering an unwanted reinstall.
        if openclaw_runtime_matches_verified_cache(path) {
            true
        } else if validate_openclaw_entry_with_selected_node(path).await {
            if let Some(signature) = openclaw_runtime_signature(path) {
                persist_verified_openclaw_runtime(&signature);
            }
            true
        } else {
            false
        }
    } else {
        false
    };
    let gateway_command_ok = package_valid && entry_smoke_ok && !is_legacy_brand_wrapper(path);
    let installed = version_ok && package_valid && gateway_command_ok;
    let mut errors = Vec::new();
    if version.is_none() {
        errors.push("OpenClaw package version is missing or invalid".to_string());
    }
    if !package_valid {
        errors.push(
            "OpenClaw package contract is incomplete (package.json, engines.node, and openclaw.mjs are required)"
                .to_string(),
        );
    }
    if package_valid && !entry_smoke_ok {
        errors.push("OpenClaw JavaScript entry failed the selected Node.js syntax check".into());
    }
    if is_legacy_brand_wrapper(path) {
        errors.push("OpenClaw path resolves to a legacy wrapper".to_string());
    }
    OpenclawStatus {
        installed,
        version,
        path: Some(path_string),
        source: None,
        binary_found: true,
        version_ok,
        package_valid,
        gateway_command_ok,
        relocation_required: paths::openclaw_relocation_required(),
        error: if installed {
            None
        } else {
            Some(errors.join("; "))
        },
    }
}

pub(crate) async fn validate_openclaw_entry_with_node(binary: &Path, node_path: &Path) -> bool {
    let Some(entry) = npm_openclaw_entry(binary) else {
        return !is_npm_command_shim(binary);
    };
    let mut command = tokio::process::Command::new(node_path);
    command
        .arg("--check")
        .arg(path_for_node_argument(&entry))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    let syntax_ok = tokio::time::timeout(FRESH_INSTALL_PROBE_TIMEOUT, command.output())
        .await
        .ok()
        .and_then(Result::ok)
        .is_some_and(|output| output.status.success());
    if !syntax_ok {
        return false;
    }

    // `node --check` does not resolve imports. A bounded `--version` run
    // verifies the packaged dependency graph without starting a Gateway or
    // inheriting the desktop process's drive-root cwd.
    let smoke_root = std::env::temp_dir().join(format!(
        "junqi-openclaw-smoke-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    if std::fs::create_dir_all(&smoke_root).is_err() {
        return false;
    }
    let config = smoke_root.join("openclaw.json");
    let mut smoke = tokio::process::Command::new(node_path);
    smoke
        .arg(path_for_node_argument(&entry))
        .arg("--version")
        .env("OPENCLAW_STATE_DIR", &smoke_root)
        .env("OPENCLAW_CONFIG_PATH", &config)
        .env("OPENCLAW_NO_RESPAWN", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = paths::stable_openclaw_working_dir().filter(|path| path.is_dir()) {
        smoke.current_dir(cwd);
    }
    platform::configure_background_command(&mut smoke);
    let result = tokio::time::timeout(FRESH_INSTALL_PROBE_TIMEOUT, smoke.output())
        .await
        .ok()
        .and_then(Result::ok)
        .is_some_and(|output| {
            output.status.success()
                && parse_openclaw_version(&String::from_utf8_lossy(&output.stdout)).is_some()
        });
    let _ = std::fs::remove_dir_all(smoke_root);
    result
}

/// Validate the complete file payload declared by newer OpenClaw npm packages.
///
/// OpenClaw's post-install inventory is generated with the published package.
/// Verifying it after an install or update catches interrupted extractions that
/// can leave `package.json` and the launcher intact while a lazy-loaded module
/// is missing. Older package versions do not publish this optional inventory,
/// so their existing package and executable checks remain the compatibility
/// contract.
pub(crate) fn validate_openclaw_package_payload(binary: &Path) -> Result<(), String> {
    if !has_openclaw_package_contract(binary) {
        return Err(format!(
            "OpenClaw package contract is incomplete for {}",
            binary.display()
        ));
    }
    let package_dir = openclaw_package_dir(binary).ok_or_else(|| {
        format!(
            "OpenClaw package directory could not be resolved for {}",
            binary.display()
        )
    })?;
    let inventory_path = package_dir.join("dist").join("postinstall-inventory.json");
    if !inventory_path.exists() {
        return Ok(());
    }

    let raw = std::fs::read_to_string(&inventory_path).map_err(|error| {
        format!(
            "OpenClaw package inventory could not be read at {}: {error}",
            inventory_path.display()
        )
    })?;
    let entries = serde_json::from_str::<Vec<String>>(&raw).map_err(|error| {
        format!(
            "OpenClaw package inventory is invalid at {}: {error}",
            inventory_path.display()
        )
    })?;
    if entries.is_empty() {
        return Err(format!(
            "OpenClaw package inventory is empty at {}",
            inventory_path.display()
        ));
    }

    for entry in entries {
        let relative = Path::new(&entry);
        let safe_relative = !entry.trim().is_empty()
            && !relative.is_absolute()
            && relative
                .components()
                .all(|component| matches!(component, std::path::Component::Normal(_)));
        if !safe_relative {
            return Err(format!(
                "OpenClaw package inventory contains an unsafe path: {entry}"
            ));
        }

        let expected = package_dir.join(relative);
        if !expected.is_file() {
            return Err(format!(
                "OpenClaw package inventory is incomplete: missing {}",
                expected.display()
            ));
        }
    }

    Ok(())
}

/// Check an installed package before it becomes a Gateway runtime. This keeps
/// expensive full-inventory validation out of routine discovery while making
/// install and update promotion fail closed on incomplete package payloads.
pub(crate) async fn validate_openclaw_runtime_payload(
    binary: &Path,
    node_path: &Path,
) -> Result<(), String> {
    validate_openclaw_package_payload(binary)?;
    if !validate_openclaw_entry_with_node(binary, node_path).await {
        return Err(format!(
            "OpenClaw JavaScript entry failed the selected Node.js smoke check for {}",
            binary.display()
        ));
    }
    // Install/update just proved this exact payload runs. Seed the cache so the
    // first post-install detection — the moment most likely to hit a Defender
    // scan — skips the smoke probe instead of risking a false-negative reinstall.
    if let Some(signature) = openclaw_runtime_signature(binary) {
        persist_verified_openclaw_runtime(&signature);
    }
    Ok(())
}

async fn validate_openclaw_entry_with_selected_node(binary: &Path) -> bool {
    let requirement = match required_node_requirement_for_openclaw_binary(binary) {
        Ok(requirement) => requirement,
        Err(_) => return false,
    };
    for attempt in 1..=OPENCLAW_SMOKE_PROBE_ATTEMPTS {
        let last_attempt = attempt == OPENCLAW_SMOKE_PROBE_ATTEMPTS;
        // Node resolution itself can transiently fail while a just-installed
        // runtime is still being scanned, so it retries alongside the probe.
        let node = match check_node_for_requirement(&requirement).await {
            Ok(node) if node.available => node,
            _ => {
                if last_attempt {
                    return false;
                }
                tokio::time::sleep(OPENCLAW_SMOKE_PROBE_RETRY_BACKOFF).await;
                continue;
            }
        };
        let Some(node_path) = node.path.map(PathBuf::from) else {
            return false;
        };
        if validate_openclaw_entry_with_node(binary, &node_path).await {
            return true;
        }
        if last_attempt {
            return false;
        }
        tokio::time::sleep(OPENCLAW_SMOKE_PROBE_RETRY_BACKOFF).await;
    }
    false
}

fn path_text_for_display(raw: &str, windows: bool) -> String {
    if !windows {
        return raw.to_string();
    }
    strip_windows_verbatim_prefix(raw)
}

fn strip_windows_verbatim_prefix(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest);
    }
    raw.strip_prefix(r"\\?\").unwrap_or(raw).to_string()
}

pub(crate) fn display_path_text(raw: &str) -> String {
    path_text_for_display(raw, cfg!(windows))
}

pub(crate) fn path_for_display(path: &Path) -> String {
    display_path_text(&path.to_string_lossy())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OpenclawPackageMetadata {
    version: String,
    node_requirement: Option<String>,
}

fn read_openclaw_package_metadata_file(package_json: &Path) -> Option<OpenclawPackageMetadata> {
    let raw = std::fs::read_to_string(package_json).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    if value.get("name").and_then(|name| name.as_str()) != Some("openclaw") {
        return None;
    }
    let version = value
        .get("version")
        .and_then(|version| version.as_str())
        .filter(|version| !version.trim().is_empty())?
        .to_string();
    let node_requirement = value
        .get("engines")
        .and_then(|engines| engines.get("node"))
        .and_then(|node| node.as_str())
        .map(str::trim)
        .filter(|requirement| !requirement.is_empty())
        .map(str::to_string);
    Some(OpenclawPackageMetadata {
        version,
        node_requirement,
    })
}

fn parse_openclaw_version(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if !trimmed.to_lowercase().contains("openclaw") {
        return None;
    }
    trimmed
        .split_whitespace()
        .find(|part| {
            part.trim_start_matches('v')
                .chars()
                .next()
                .is_some_and(|ch| ch.is_ascii_digit())
        })
        .map(|part| part.trim_start_matches('v').to_string())
}

fn is_openclaw_package_dir(dir: &Path) -> bool {
    read_openclaw_package_metadata_file(&dir.join("package.json")).is_some()
}

/// Validate the files needed to execute the official npm installation. Merely
/// finding a version in package.json is insufficient: a partial extraction can
/// leave that file and a shim behind while the JavaScript entry or Node
/// contract is missing.
pub(crate) fn has_openclaw_package_contract(binary: &Path) -> bool {
    if !binary.is_file() {
        return false;
    }
    let Some(package_dir) = openclaw_package_dir(binary) else {
        return false;
    };
    let Some(metadata) = read_openclaw_package_metadata_file(&package_dir.join("package.json"))
    else {
        return false;
    };
    let Some(requirement) = metadata.node_requirement else {
        return false;
    };
    package_dir.join("openclaw.mjs").is_file()
        && NodeRuntimeRequirement::parse(requirement, NodeRequirementSource::InstalledPackage)
            .is_ok()
}

/// Resolve the physical `openclaw` package root from a selected executable.
///
/// npm can expose the same package through a Windows prefix shim, a
/// `node_modules/.bin` shim, or a Unix symlink. The resolver starts from both
/// the visible binary and its canonical target, then verifies `package.json`
/// instead of assuming a user-specific global prefix.
pub(crate) fn openclaw_package_dir(binary: &Path) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(binary).unwrap_or_else(|_| binary.to_path_buf());
    for candidate in [binary.to_path_buf(), canonical] {
        let mut dir = candidate.parent();
        for _ in 0..8 {
            let Some(current) = dir else {
                break;
            };
            if is_openclaw_package_dir(current) {
                return Some(current.to_path_buf());
            }
            // npm's Windows shim is `<prefix>/openclaw.cmd`, while the
            // documented Unix prefix is `<prefix>/bin/openclaw` with the
            // package under `<prefix>/lib/node_modules/openclaw`.
            for relative in [
                Path::new("node_modules").join("openclaw"),
                Path::new("lib").join("node_modules").join("openclaw"),
            ] {
                let nested = current.join(relative);
                if is_openclaw_package_dir(&nested) {
                    return Some(nested);
                }
            }
            dir = current.parent();
        }
    }
    None
}

/// Derive the npm global prefix owning an installed OpenClaw package. The
/// structure is validated through `openclaw_package_dir`; `windows` only
/// selects npm's documented shim layout, never a hard-coded filesystem path.
pub(crate) fn npm_prefix_for_openclaw_binary(binary: &Path, windows: bool) -> Option<PathBuf> {
    if !binary.is_file() {
        return None;
    }
    let package_dir = openclaw_package_dir(binary)?;
    let node_modules = package_dir.parent()?;
    if node_modules.file_name().and_then(|name| name.to_str())? != "node_modules" {
        return None;
    }
    let layout_root = node_modules.parent()?.to_path_buf();
    if windows {
        return Some(layout_root);
    }
    if layout_root.file_name().and_then(|name| name.to_str()) == Some("lib") {
        return layout_root.parent().map(Path::to_path_buf);
    }
    Some(layout_root)
}

fn read_openclaw_package_metadata(bin: &Path) -> Option<OpenclawPackageMetadata> {
    let package_dir = openclaw_package_dir(bin)?;
    read_openclaw_package_metadata_file(&package_dir.join("package.json"))
}

fn read_openclaw_pkg_version(bin: &Path) -> Option<String> {
    read_openclaw_package_metadata(bin).map(|metadata| metadata.version)
}

pub(crate) fn node_requirement_for_openclaw_binary(
    binary: &Path,
) -> Result<NodeRuntimeRequirement, String> {
    let Some(metadata) = read_openclaw_package_metadata(binary) else {
        return Ok(NodeRuntimeRequirement::fallback());
    };
    let Some(expression) = metadata.node_requirement else {
        return Ok(NodeRuntimeRequirement::fallback());
    };
    NodeRuntimeRequirement::parse(expression, NodeRequirementSource::InstalledPackage)
}

/// Read the package contract from a concrete installed OpenClaw binary.
/// Installation and update flows use this strict form after npm completes so
/// an incomplete or unexpected package can never inherit JunQi's legacy
/// fallback range and be reported as valid.
pub(crate) fn required_node_requirement_for_openclaw_binary(
    binary: &Path,
) -> Result<NodeRuntimeRequirement, String> {
    let metadata = read_openclaw_package_metadata(binary).ok_or_else(|| {
        format!(
            "Installed OpenClaw package metadata is unavailable for {}",
            binary.display()
        )
    })?;
    let expression = metadata.node_requirement.ok_or_else(|| {
        format!(
            "Installed OpenClaw package {} does not declare engines.node",
            metadata.version
        )
    })?;
    NodeRuntimeRequirement::parse(expression, NodeRequirementSource::InstalledPackage)
}

pub(crate) fn openclaw_package_version_for_binary(binary: &Path) -> Result<String, String> {
    read_openclaw_package_metadata(binary)
        .map(|metadata| metadata.version)
        .ok_or_else(|| {
            format!(
                "Installed OpenClaw package metadata is unavailable for {}",
                binary.display()
            )
        })
}

pub(crate) async fn installed_openclaw_node_requirement() -> Result<NodeRuntimeRequirement, String>
{
    let Some(binary) = resolve_openclaw_binary_async().await else {
        return Ok(NodeRuntimeRequirement::fallback());
    };
    node_requirement_for_openclaw_binary(&binary)
}

async fn get_git_version(git_path: &str) -> Option<String> {
    let mut command = tokio::process::Command::new(git_path);
    command.arg("--version").kill_on_drop(true);
    platform::configure_background_command(&mut command);
    let output = tokio::time::timeout(FRESH_INSTALL_PROBE_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    let expanded = if path.starts_with("~/") || path == "~" {
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        if path == "~" {
            home
        } else {
            home.join(&path[2..])
        }
    } else {
        PathBuf::from(&path)
    };

    // Create directory if it doesn't exist
    if !expanded.exists() {
        std::fs::create_dir_all(&expanded)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    platform::open_in_explorer(&expanded).map_err(|e| format!("Failed to open folder: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn check_git() -> Result<GitStatus, String> {
    paths::validate_runtime_overrides()?;

    if let Some(configured) = paths::configured_git_path() {
        let path = configured.to_string_lossy().into_owned();
        let version = get_git_version(&path).await;
        return Ok(GitStatus {
            available: version.is_some(),
            version,
            path: Some(path),
            source: Some(RuntimeToolSource::Custom),
        });
    }

    // System Git can have multiple PATH candidates on Windows (a stale
    // version-manager shim followed by the regular installer is common).
    // Probe every executable candidate before declaring Git unavailable so a
    // broken earlier entry cannot trigger an unnecessary system installation.
    let candidates = platform::detect_paths("git");
    let candidates = if candidates.is_empty() {
        vec![platform::bin_name("git")]
    } else {
        candidates
    };
    let mut first_unusable = None;
    for system_git in candidates {
        match get_git_version(&system_git).await {
            Some(version) => {
                return Ok(GitStatus {
                    available: true,
                    version: Some(version),
                    path: Some(system_git),
                    source: Some(RuntimeToolSource::System),
                });
            }
            None if first_unusable.is_none() => first_unusable = Some(system_git),
            None => {}
        }
    }

    Ok(GitStatus {
        available: false,
        version: None,
        path: first_unusable,
        source: Some(RuntimeToolSource::System),
    })
}

// ── get_terminal_env ──────────────────────────────────────────────────────
/// Project-level environment detection for the status bar pills, mirroring
/// kooky `session.environment` (pythonVenv, nodeVersion, goVersion).
#[derive(serde::Serialize)]
pub struct TerminalEnvInfo {
    pub node_version: Option<String>,
    pub python_venv: Option<String>,
    pub go_version: Option<String>,
}

#[tauri::command]
pub async fn get_terminal_env(project_path: String) -> Result<TerminalEnvInfo, String> {
    // Run node, go, and python detection concurrently with tokio::process::Command
    // so NVM/asdf shims don't block the Tokio executor thread.
    let pp = project_path.clone();

    let node_program = platform::resolve_spawn_program("node");
    let node_fut = async move {
        let mut command = tokio::process::Command::new(node_program);
        platform::configure_background_command(&mut command);
        command.arg("--version").current_dir(&pp).kill_on_drop(true);
        tokio::time::timeout(RUNTIME_PROBE_TIMEOUT, command.output())
            .await
            .ok()
            .and_then(Result::ok)
            .and_then(|o| {
                if o.status.success() {
                    let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    Some(v.trim_start_matches('v').to_string())
                } else {
                    None
                }
            })
    };

    let pp2 = project_path.clone();
    let go_fut = async {
        let mut command = tokio::process::Command::new("go");
        platform::configure_background_command(&mut command);
        command
            .arg("version")
            .current_dir(&pp2)
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    let text = String::from_utf8_lossy(&o.stdout).into_owned();
                    text.split_whitespace()
                        .find(|t| t.starts_with("go1.") || t.starts_with("go2."))
                        .map(|t| t.trim_start_matches("go").to_string())
                } else {
                    None
                }
            })
    };

    // Python venv: filesystem-only detection (.venv / venv / env dirs).
    // Deliberately skip std::env::var("VIRTUAL_ENV") -- that reads the Tauri
    // process environment, not the PTY terminal's activated venv.
    let pp3 = project_path.clone();
    let python_fut = async {
        for candidate in &[".venv", "venv", "env"] {
            let venv_dir = std::path::Path::new(&pp3).join(candidate);
            let py_win = venv_dir.join("Scripts").join("python.exe");
            let py_unix = venv_dir.join("bin").join("python");
            // Check each path once to avoid double filesystem stat.
            let py = if py_win.exists() {
                Some(py_win)
            } else if py_unix.exists() {
                Some(py_unix)
            } else {
                None
            };
            if let Some(py_path) = py {
                let mut command = tokio::process::Command::new(&py_path);
                platform::configure_background_command(&mut command);
                let ver = command
                    .arg("--version")
                    .output()
                    .await
                    .ok()
                    .map(|o| {
                        let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        if out.is_empty() {
                            String::from_utf8_lossy(&o.stderr).trim().to_string()
                        } else {
                            out
                        }
                    })
                    .unwrap_or_else(|| candidate.to_string());
                let clean = ver.strip_prefix("Python ").unwrap_or(&ver).to_string();
                return Some(clean);
            }
        }
        None
    };

    let (node_version, go_version, python_venv) = tokio::join!(node_fut, go_fut, python_fut);

    Ok(TerminalEnvInfo {
        node_version,
        python_venv,
        go_version,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        native_openclaw_runtime, native_openclaw_runtime_from_gateway_service_launch_contract,
        node_requirement_for_openclaw_binary, normalize_npm_prefix, npm_cli_for_node,
        npm_openclaw_entry, npm_prefix_for_openclaw_binary,
        openclaw_locale_for_application_language, openclaw_package_dir,
        openclaw_package_version_for_binary, openclaw_runtime_signature, parse_node_runtime_probe,
        parse_openclaw_version,
        path_text_for_display, read_openclaw_package_metadata,
        required_node_requirement_for_openclaw_binary,
        resolve_openclaw_binary_from_effective_prefixes, search_path_with_executable_parent,
        strip_windows_verbatim_prefix, validate_openclaw_package_payload,
        NodeRuntimeCandidateSelection, NodeRuntimeContract, NodeStatus, NpmExecutionContext,
        NpmStatus, OpenclawCommandContext, RuntimeToolSource,
    };
    use std::ffi::OsStr;
    use std::path::Path;

    fn write_global_npm_openclaw(prefix: &std::path::Path) -> std::path::PathBuf {
        let binary = crate::paths::npm_bin_dir_for_prefix(prefix).join(if cfg!(windows) {
            "openclaw.cmd"
        } else {
            "openclaw"
        });
        let package = if cfg!(windows) {
            prefix.join("node_modules").join("openclaw")
        } else {
            prefix.join("lib").join("node_modules").join("openclaw")
        };
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(&binary, "").unwrap();
        std::fs::write(package.join("openclaw.mjs"), "").unwrap();
        std::fs::write(
            package.join("package.json"),
            r#"{"name":"openclaw","version":"2026.7.1","engines":{"node":">=24.15.0 <25"}}"#,
        )
        .unwrap();
        binary
    }

    #[test]
    fn verified_runtime_signature_is_stable_for_unchanged_payload() {
        let prefix = std::env::temp_dir().join(format!("junqi-oclaw-sig-{}", uuid::Uuid::new_v4()));
        let binary = write_global_npm_openclaw(&prefix);

        let first = openclaw_runtime_signature(&binary).expect("signature for valid payload");
        let again = openclaw_runtime_signature(&binary).expect("signature is repeatable");
        assert_eq!(
            first, again,
            "an unchanged payload must produce an identical signature so the cache hits"
        );
        assert_eq!(first.version, "2026.7.1");

        let _ = std::fs::remove_dir_all(&prefix);
    }

    #[test]
    fn verified_runtime_signature_changes_when_entry_payload_changes() {
        let prefix = std::env::temp_dir().join(format!("junqi-oclaw-sig-{}", uuid::Uuid::new_v4()));
        let binary = write_global_npm_openclaw(&prefix);
        let before = openclaw_runtime_signature(&binary).expect("signature before update");

        // Simulate an install/upgrade rewriting the JS entry with new content.
        let package = openclaw_package_dir(&binary).expect("package dir");
        std::fs::write(
            package.join("openclaw.mjs"),
            "// upgraded entry with different bytes\n",
        )
        .unwrap();
        let after = openclaw_runtime_signature(&binary).expect("signature after update");

        assert_ne!(
            before, after,
            "a rewritten entry must invalidate the cache so a fresh smoke probe runs"
        );

        let _ = std::fs::remove_dir_all(&prefix);
    }

    #[test]
    fn bug_rp_04_runtime_tool_sources_have_distinct_wire_values() {
        assert_eq!(
            serde_json::to_value(RuntimeToolSource::System).unwrap(),
            "system"
        );
        assert_eq!(
            serde_json::to_value(RuntimeToolSource::Custom).unwrap(),
            "custom"
        );
    }

    #[test]
    fn managed_gateway_uses_an_openclaw_supported_wizard_locale() {
        assert_eq!(openclaw_locale_for_application_language("zh"), "zh-CN");
        assert_eq!(openclaw_locale_for_application_language("zh-TW"), "zh-TW");
        assert_eq!(openclaw_locale_for_application_language("en"), "en-US");
        assert_eq!(openclaw_locale_for_application_language("ar"), "en-US");
    }

    #[test]
    fn command_context_exports_the_managed_openclaw_locale() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-locale-context-{}",
            uuid::Uuid::new_v4()
        ));
        let context = OpenclawCommandContext::for_paths(
            root.join("state"),
            root.join("state").join("openclaw.json"),
        );
        let mut command = tokio::process::Command::new("openclaw");
        context.apply(&mut command);
        let configured_locale = command.as_std().get_envs().find_map(|(key, value)| {
            (key == OsStr::new("OPENCLAW_LOCALE"))
                .then_some(value)
                .flatten()
        });
        assert_eq!(configured_locale, Some(OsStr::new(context.locale.as_str())));
    }

    #[test]
    fn npm_prefix_normalization_rejects_ambiguous_values() {
        assert_eq!(normalize_npm_prefix(""), None);
        assert_eq!(normalize_npm_prefix("undefined"), None);
        assert_eq!(normalize_npm_prefix("relative/prefix"), None);

        let absolute = std::env::temp_dir().join("junqi-npm-prefix");
        assert_eq!(
            normalize_npm_prefix(&absolute.to_string_lossy()),
            Some(absolute)
        );
        assert!(normalize_npm_prefix("~/junqi-npm-prefix").is_some_and(|path| path.is_absolute()));
    }

    #[test]
    fn resolved_node_parent_precedes_the_inherited_search_path() {
        let root = std::env::temp_dir().join("junqi-selected-node");
        let node = root.join(if cfg!(windows) { "node.exe" } else { "node" });
        let inherited = std::env::join_paths([std::env::temp_dir().join("other-runtime")])
            .unwrap()
            .to_string_lossy()
            .into_owned();

        let search_path = search_path_with_executable_parent(&node, &inherited);
        let entries = std::env::split_paths(&search_path).collect::<Vec<_>>();
        assert_eq!(entries.first(), Some(&root));
        assert!(entries.iter().any(|entry| entry.ends_with("other-runtime")));
    }

    #[test]
    fn node_runtime_probe_uses_the_distribution_path_behind_a_version_manager_shim() {
        let probe = br#"{"execPath":"/Users/example/.volta/tools/image/node/24.18.0/bin/node","version":"v24.18.0"}"#;
        assert_eq!(
            parse_node_runtime_probe(probe),
            Some((
                "/Users/example/.volta/tools/image/node/24.18.0/bin/node".into(),
                "v24.18.0".into(),
            ))
        );
    }

    #[test]
    fn node_runtime_selection_prefers_a_complete_pair_over_an_earlier_broken_npm() {
        let incomplete = NodeRuntimeContract {
            node: NodeStatus {
                available: true,
                version: Some("v24.18.0".into()),
                path: Some("first-node".into()),
                source: Some(RuntimeToolSource::System),
            },
            npm: NpmStatus::unavailable(None, "bundled npm is missing"),
        };
        let complete = NodeRuntimeContract {
            node: NodeStatus {
                available: true,
                version: Some("v24.18.0".into()),
                path: Some("second-node".into()),
                source: Some(RuntimeToolSource::System),
            },
            npm: NpmStatus::available("11.16.0".into(), "second-npm".into()),
        };

        let mut selection = NodeRuntimeCandidateSelection::default();
        assert!(selection.consider(incomplete).is_none());
        let selected = selection
            .consider(complete)
            .expect("complete pair selected");

        assert_eq!(selected.node.path.as_deref(), Some("second-node"));
        assert!(selected.npm.available);
    }

    #[test]
    fn effective_npm_prefix_resolution_does_not_reuse_a_stale_saved_binary() {
        let root = std::env::temp_dir().join(format!(
            "junqi-effective-npm-prefix-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let old_prefix = root.join("old-prefix");
        let current_prefix = root.join("current-prefix");
        let stale_binary = write_global_npm_openclaw(&old_prefix);
        let current_binary = write_global_npm_openclaw(&current_prefix);

        let resolved = resolve_openclaw_binary_from_effective_prefixes(
            std::slice::from_ref(&current_prefix),
            Some(stale_binary.clone()),
        )
        .expect("the npm-reported current prefix should resolve");
        assert_eq!(resolved.0, current_binary);
        assert_eq!(resolved.1, "npm-effective-prefix");

        let empty_current_prefix = root.join("empty-current-prefix");
        std::fs::create_dir_all(&empty_current_prefix).unwrap();
        assert!(resolve_openclaw_binary_from_effective_prefixes(
            std::slice::from_ref(&empty_current_prefix),
            Some(stale_binary),
        )
        .is_none());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn windows_npm_shim_resolves_to_package_entry_point() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-command-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let custom_prefix = root.join("custom-npm-prefix");
        let entry = custom_prefix
            .join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs");
        std::fs::create_dir_all(entry.parent().unwrap()).unwrap();
        std::fs::write(&entry, "").unwrap();
        std::fs::write(
            entry.parent().unwrap().join("package.json"),
            r#"{"name":"openclaw","version":"2026.7.1"}"#,
        )
        .unwrap();

        let shim = custom_prefix.join("openclaw.cmd");
        assert_eq!(npm_openclaw_entry(&shim), Some(entry.clone()));

        let node = root.join("node.exe");
        let runtime = native_openclaw_runtime(
            shim,
            &NodeStatus {
                available: true,
                version: Some("v24.18.0".into()),
                path: Some(node.to_string_lossy().to_string()),
                source: Some(RuntimeToolSource::System),
            },
        )
        .unwrap();
        let context = OpenclawCommandContext::for_paths(
            root.join("state"),
            root.join("state").join("openclaw.json"),
        );
        let command = runtime.command(&context);
        let command = command.as_std();
        assert_eq!(command.get_program(), node.as_os_str());
        assert_eq!(command.get_args().next(), Some(entry.as_os_str()));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn gateway_service_launch_contract_reconstructs_the_verified_node_entry() {
        let root = std::env::temp_dir().join(format!(
            "junqi-gateway-service-launch-contract-{}",
            uuid::Uuid::new_v4()
        ));
        let node = root.join(if cfg!(windows) { "node.exe" } else { "node" });
        let entry = root
            .join("prefix")
            .join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs");
        std::fs::create_dir_all(entry.parent().unwrap()).unwrap();
        std::fs::write(&node, "").unwrap();
        std::fs::write(&entry, "").unwrap();

        let contract = crate::paths::NativeGatewayServiceLaunchContract {
            node: Some(node.clone()),
            entry: Some(entry.clone()),
            executable: None,
            package_dir: Some(entry.parent().unwrap().to_path_buf()),
            npm_prefix: Some(root.join("prefix")),
        };
        let runtime =
            native_openclaw_runtime_from_gateway_service_launch_contract(&contract).unwrap();
        let context = OpenclawCommandContext::for_paths(
            root.join("state"),
            root.join("state").join("openclaw.json"),
        );
        let command = runtime.command(&context);
        let command = command.as_std();

        assert_eq!(command.get_program(), node.as_os_str());
        assert_eq!(command.get_args().next(), Some(entry.as_os_str()));
        assert_eq!(runtime.identity().npm_prefix, Some(root.join("prefix")));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn npm_command_shim_without_a_verified_entry_fails_closed() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-broken-shim-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let shim = root.join("relocated-npm-prefix").join("openclaw.cmd");
        std::fs::create_dir_all(shim.parent().unwrap()).unwrap();
        std::fs::write(&shim, "@echo off").unwrap();

        let error = native_openclaw_runtime(
            shim,
            &NodeStatus {
                available: true,
                version: Some("v24.18.0".into()),
                path: Some(root.join("node.exe").to_string_lossy().to_string()),
                source: Some(RuntimeToolSource::System),
            },
        )
        .unwrap_err();
        assert!(error.contains("JavaScript entry point"));
        assert!(error.contains("re-detect OpenClaw"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn windows_verbatim_path_prefix_is_removed_for_node_arguments() {
        assert_eq!(
            strip_windows_verbatim_prefix(
                r"\\?\C:\Users\ExampleUser\AppData\Roaming\npm\node_modules\openclaw\openclaw.mjs"
            ),
            r"C:\Users\ExampleUser\AppData\Roaming\npm\node_modules\openclaw\openclaw.mjs"
        );
    }

    #[test]
    fn windows_npm_dot_bin_shim_uses_the_verified_package_prefix() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-dot-bin-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let package = root.join("node_modules").join("openclaw");
        let entry = package.join("openclaw.mjs");
        let shim = root.join("node_modules").join(".bin").join("openclaw.cmd");
        std::fs::create_dir_all(shim.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(&shim, "@echo off").unwrap();
        std::fs::write(&entry, "").unwrap();
        std::fs::write(
            package.join("package.json"),
            r#"{"name":"openclaw","version":"2026.7.1"}"#,
        )
        .unwrap();

        assert_eq!(openclaw_package_dir(&shim), Some(package));
        assert_eq!(npm_openclaw_entry(&shim), Some(entry));
        assert_eq!(
            npm_prefix_for_openclaw_binary(&shim, true),
            Some(root.clone())
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn npm_cli_is_derived_from_the_selected_node_layout() {
        let root = std::env::temp_dir().join(format!(
            "junqi-node-npm-layout-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let node = root.join("bin").join("node");
        let npm = root
            .join("lib")
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js");
        std::fs::create_dir_all(node.parent().unwrap()).unwrap();
        std::fs::create_dir_all(npm.parent().unwrap()).unwrap();
        std::fs::write(&node, "").unwrap();
        std::fs::write(&npm, "").unwrap();

        assert_eq!(npm_cli_for_node(&node), Some(npm));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn npm_execution_context_keeps_node_npm_path_and_workdir_together() {
        let root = std::env::temp_dir().join(format!(
            "junqi-npm-execution-context-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let node = root
            .join("selected-node")
            .join(crate::platform::bin_name("node"));
        let npm = node
            .parent()
            .unwrap()
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js");
        std::fs::create_dir_all(node.parent().unwrap()).unwrap();
        std::fs::create_dir_all(npm.parent().unwrap()).unwrap();
        std::fs::write(&node, "").unwrap();
        std::fs::write(&npm, "").unwrap();

        let context = NpmExecutionContext::for_node(&node).unwrap();
        assert_eq!(context.npm_cli(), npm.as_path());
        assert_eq!(
            std::env::split_paths(&context.search_path).next(),
            node.parent().map(Path::to_path_buf)
        );

        let command = context.command();
        let command = command.as_std();
        assert_eq!(command.get_program(), node.as_os_str());
        assert_eq!(command.get_args().next(), Some(npm.as_os_str()));
        assert_eq!(command.get_current_dir(), context.working_dir.as_deref());
        let configured_path = command
            .get_envs()
            .find_map(|(key, value)| (key == OsStr::new("PATH")).then_some(value).flatten());
        assert_eq!(configured_path, Some(OsStr::new(&context.search_path)));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn npm_execution_context_requires_the_selected_nodes_bundled_cli() {
        let root = std::env::temp_dir().join(format!(
            "junqi-npm-execution-context-missing-cli-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let node = root.join(crate::platform::bin_name("node"));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&node, "").unwrap();

        let error = NpmExecutionContext::for_node(&node).unwrap_err();
        assert!(error.contains("bundled npm CLI"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn package_metadata_reads_version_and_node_engine_from_windows_shim_layout() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-metadata-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let package = root.join("node_modules").join("openclaw");
        std::fs::create_dir_all(&package).unwrap();
        let shim = root.join("openclaw.cmd");
        std::fs::write(&shim, "@echo off").unwrap();
        std::fs::write(
            package.join("package.json"),
            r#"{"name":"openclaw","version":"2026.7.1","engines":{"node":">=24.15.0 <25"}}"#,
        )
        .unwrap();

        let metadata = read_openclaw_package_metadata(&shim).unwrap();
        assert_eq!(metadata.version, "2026.7.1");
        assert_eq!(metadata.node_requirement.as_deref(), Some(">=24.15.0 <25"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn strict_package_contract_rejects_missing_engines_while_status_keeps_legacy_fallback() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-strict-contract-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let package = root.join("node_modules").join("openclaw");
        let shim = root.join("openclaw.cmd");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(&shim, "@echo off").unwrap();
        std::fs::write(
            package.join("package.json"),
            r#"{"name":"openclaw","version":"2026.7.1"}"#,
        )
        .unwrap();

        assert_eq!(
            openclaw_package_version_for_binary(&shim).unwrap(),
            "2026.7.1"
        );
        assert!(required_node_requirement_for_openclaw_binary(&shim).is_err());
        assert_eq!(
            node_requirement_for_openclaw_binary(&shim)
                .unwrap()
                .expression(),
            "*"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn package_payload_inventory_rejects_missing_or_unsafe_files() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-package-inventory-{}",
            uuid::Uuid::new_v4()
        ));
        let prefix = root.join("prefix");
        let binary = write_global_npm_openclaw(&prefix);
        let package = openclaw_package_dir(&binary).unwrap();
        let dist = package.join("dist");
        std::fs::create_dir_all(&dist).unwrap();
        std::fs::write(dist.join("runtime.js"), "export {};").unwrap();
        std::fs::write(
            dist.join("postinstall-inventory.json"),
            r#"["openclaw.mjs", "dist/runtime.js"]"#,
        )
        .unwrap();

        assert!(validate_openclaw_package_payload(&binary).is_ok());

        std::fs::remove_file(dist.join("runtime.js")).unwrap();
        let missing = validate_openclaw_package_payload(&binary).unwrap_err();
        assert!(missing.contains("inventory is incomplete"));

        std::fs::write(
            dist.join("postinstall-inventory.json"),
            r#"["../outside.js"]"#,
        )
        .unwrap();
        let unsafe_path = validate_openclaw_package_payload(&binary).unwrap_err();
        assert!(unsafe_path.contains("unsafe path"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn windows_display_paths_hide_verbatim_prefixes() {
        assert_eq!(
            path_text_for_display(
                r"\\?\C:\Users\ExampleUser\AppData\Roaming\npm\openclaw.cmd",
                true
            ),
            r"C:\Users\ExampleUser\AppData\Roaming\npm\openclaw.cmd"
        );
        assert_eq!(
            path_text_for_display(r"\\?\UNC\server\share\openclaw.cmd", true),
            r"\\server\share\openclaw.cmd"
        );
    }

    #[test]
    fn parse_openclaw_version_accepts_plain_cli_output() {
        assert_eq!(
            parse_openclaw_version("OpenClaw 2026.6.11 (e085fa1)"),
            Some("2026.6.11".to_string())
        );
    }

    #[test]
    fn parse_openclaw_version_accepts_v_prefixed_output() {
        assert_eq!(
            parse_openclaw_version("openclaw v2026.6.11"),
            Some("2026.6.11".to_string())
        );
    }

    #[test]
    fn parse_openclaw_version_rejects_unrelated_output() {
        let unrelated_brand_output = format!("{}{} 1.0.0", "Cla", "wX");
        assert_eq!(parse_openclaw_version(&unrelated_brand_output), None);
        assert_eq!(parse_openclaw_version("2026.6.11"), None);
    }
}
