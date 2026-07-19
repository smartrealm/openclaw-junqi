use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine as _;
use reqwest::header::HeaderValue;
use url::Url;

const OFFICIAL_NPM_REGISTRY: NpmRegistry = NpmRegistry {
    kind: NpmRegistryKind::Official,
    url: "https://registry.npmjs.org",
};
const CHINA_NPM_REGISTRY: NpmRegistry = NpmRegistry {
    kind: NpmRegistryKind::ChinaMirror,
    url: "https://registry.npmmirror.com",
};
const REGISTRY_PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const OPENCLAW_PACKAGE_NAME: &str = "openclaw";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NpmRegistryKind {
    Official,
    ChinaMirror,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NpmRegistry {
    pub kind: NpmRegistryKind,
    pub url: &'static str,
}

impl NpmRegistry {
    pub fn label(self) -> &'static str {
        match self.kind {
            NpmRegistryKind::Official => "npmjs.org (official)",
            NpmRegistryKind::ChinaMirror => "npmmirror.com (China mirror)",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NpmRegistrySelection {
    pub primary: NpmRegistry,
    pub fallback: Option<NpmRegistry>,
    pub package_version: Option<String>,
    pub node_requirement: Option<String>,
}

impl NpmRegistrySelection {
    pub fn candidates(&self) -> Vec<NpmRegistry> {
        let mut candidates = vec![self.primary];
        if let Some(fallback) = self.fallback {
            candidates.push(fallback);
        }
        candidates
    }

    fn china_default() -> Self {
        Self {
            primary: CHINA_NPM_REGISTRY,
            fallback: Some(OFFICIAL_NPM_REGISTRY),
            package_version: None,
            node_requirement: None,
        }
    }
}

/// A pinned OpenClaw package release together with the Node.js contract read
/// from the selected registry metadata. Installation callers must retain this
/// object through runtime validation and `npm install`, rather than resolving
/// `latest` independently at each stage.
#[derive(Clone)]
pub(crate) struct OpenclawReleaseTarget {
    version: String,
    node_requirement: String,
    sources: Vec<NpmPackageSource>,
}

impl OpenclawReleaseTarget {
    pub(crate) fn version(&self) -> &str {
        &self.version
    }

    pub(crate) fn node_requirement(&self) -> &str {
        &self.node_requirement
    }

    pub(crate) fn package_spec(&self) -> String {
        format!("{OPENCLAW_PACKAGE_NAME}@{}", self.version)
    }

    pub(crate) fn sources(&self) -> &[NpmPackageSource] {
        &self.sources
    }
}

#[derive(Debug, Clone)]
struct RegistryProbe {
    registry: NpmRegistry,
    version: String,
    node_requirement: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReleaseMetadata {
    version: String,
    node_requirement: Option<String>,
}

/// Internal endpoint used only while resolving package metadata. The public
/// `NpmRegistry` intentionally remains a static, copyable value because the
/// update command serializes it. User-configured URLs stay private here so a
/// token embedded in an npm config can never reach progress or result payloads.
#[derive(Clone)]
struct RegistryEndpoint {
    url: Url,
    authorization: Option<HeaderValue>,
}

impl RegistryEndpoint {
    pub(crate) fn public(registry: NpmRegistry) -> Self {
        Self {
            url: Url::parse(registry.url).expect("built-in npm registry URL must be valid"),
            authorization: None,
        }
    }

    fn configured(raw: &str, auth_token: Option<&str>) -> Option<Self> {
        let mut url = Url::parse(raw.trim().trim_matches(['\"', '\'']).trim()).ok()?;
        if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() {
            return None;
        }
        url.set_query(None);
        url.set_fragment(None);

        let authorization = if !url.username().is_empty() {
            let username = url.username().to_string();
            let password = url.password().unwrap_or_default().to_string();
            let credentials =
                base64::engine::general_purpose::STANDARD.encode(format!("{username}:{password}"));
            url.set_username("").ok()?;
            url.set_password(None).ok()?;
            HeaderValue::from_str(&format!("Basic {credentials}"))
                .ok()
                .map(|mut value| {
                    value.set_sensitive(true);
                    value
                })
        } else {
            auth_token.and_then(|token| {
                HeaderValue::from_str(&format!("Bearer {}", token.trim()))
                    .ok()
                    .filter(|_| !token.trim().is_empty())
                    .map(|mut value| {
                        value.set_sensitive(true);
                        value
                    })
            })
        };

        Some(Self { url, authorization })
    }

    fn metadata_url(&self, selector: &str) -> Option<Url> {
        let mut url = self.url.clone();
        let path = url.path().trim_end_matches('/');
        url.set_path(&format!("{path}/{OPENCLAW_PACKAGE_NAME}/{selector}"));
        Some(url)
    }
}

/// One npm package source selected for a single operation. Configured sources
/// deliberately keep their endpoint private: npm itself receives credentials
/// from the user's configuration, while JunQi uses the same source only for
/// metadata validation and never sends its URL through progress or IPC data.
#[derive(Clone)]
pub(crate) struct NpmPackageSource(NpmPackageSourceKind);

#[derive(Clone)]
enum NpmPackageSourceKind {
    Public(NpmRegistry),
    Configured(RegistryEndpoint),
}

impl NpmPackageSource {
    pub(crate) fn public(registry: NpmRegistry) -> Self {
        Self(NpmPackageSourceKind::Public(registry))
    }

    fn configured(endpoint: RegistryEndpoint) -> Self {
        Self(NpmPackageSourceKind::Configured(endpoint))
    }

    pub(crate) fn label(&self) -> String {
        match &self.0 {
            NpmPackageSourceKind::Public(registry) => registry.label().to_string(),
            NpmPackageSourceKind::Configured(_) => "user-configured npm registry".to_string(),
        }
    }

    pub(crate) fn public_registry(&self) -> Option<NpmRegistry> {
        match &self.0 {
            NpmPackageSourceKind::Public(registry) => Some(*registry),
            NpmPackageSourceKind::Configured(_) => None,
        }
    }

    /// Apply the selected registry URL without materializing credentials. npm
    /// still reads the user's auth/proxy configuration, while an environment
    /// URL pins a later Node runtime to the same registry that supplied the
    /// metadata contract.
    pub(crate) fn apply_to_command(&self, command: &mut tokio::process::Command) {
        let registry = match &self.0 {
            NpmPackageSourceKind::Public(registry) => registry.url,
            NpmPackageSourceKind::Configured(endpoint) => endpoint.url.as_str(),
        };
        command
            .env("npm_config_registry", registry)
            .env("NPM_CONFIG_REGISTRY", registry);
    }

    async fn latest_metadata(&self, client: &reqwest::Client) -> Result<ReleaseMetadata, String> {
        let endpoint = match &self.0 {
            NpmPackageSourceKind::Public(registry) => RegistryEndpoint::public(*registry),
            NpmPackageSourceKind::Configured(endpoint) => endpoint.clone(),
        };
        fetch_release_metadata_from_endpoint(client, &endpoint, "latest").await
    }

    async fn metadata_for_version(
        &self,
        client: &reqwest::Client,
        version: &str,
    ) -> Result<ReleaseMetadata, String> {
        let endpoint = match &self.0 {
            NpmPackageSourceKind::Public(registry) => RegistryEndpoint::public(*registry),
            NpmPackageSourceKind::Configured(endpoint) => endpoint.clone(),
        };
        fetch_release_metadata_from_endpoint(client, &endpoint, version).await
    }

    pub(crate) async fn node_requirement(&self, version: &str) -> Result<Option<String>, String> {
        require_valid_openclaw_package_version(version)?;
        let client = reqwest::Client::builder()
            .connect_timeout(REGISTRY_PROBE_TIMEOUT)
            .timeout(REGISTRY_PROBE_TIMEOUT)
            .user_agent("JunQi Desktop OpenClaw metadata resolver")
            .build()
            .map_err(|error| format!("Failed to initialize npm metadata resolver: {error}"))?;
        Ok(self
            .metadata_for_version(&client, version)
            .await?
            .node_requirement)
    }
}

/// The complete npm source policy for one operation. Public registries may
/// have a validated fallback; a user-configured registry is always a single
/// source because redirecting it would violate npm's own configuration.
#[derive(Clone)]
pub(crate) struct EffectiveNpmRegistryPolicy {
    sources: Vec<NpmPackageSource>,
}

impl EffectiveNpmRegistryPolicy {
    fn configured(endpoint: RegistryEndpoint) -> Self {
        Self {
            sources: vec![NpmPackageSource::configured(endpoint)],
        }
    }

    fn public(selection: NpmRegistrySelection) -> Self {
        Self {
            sources: selection
                .candidates()
                .into_iter()
                .map(NpmPackageSource::public)
                .collect(),
        }
    }

    pub(crate) fn sources(&self) -> &[NpmPackageSource] {
        &self.sources
    }
}

#[derive(Debug, Deserialize)]
struct PackageMetadata {
    version: Option<String>,
    dist: Option<PackageDist>,
    engines: Option<PackageEngines>,
}

#[derive(Debug, Deserialize)]
struct PackageEngines {
    node: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PackageDist {
    tarball: Option<String>,
}

/// Probe the public registries concurrently. The official registry owns the
/// release contract when it is reachable; the mainland mirror is a transport
/// preference only when it advertises that exact same version.
pub async fn select_npm_registry() -> NpmRegistrySelection {
    let client = match reqwest::Client::builder()
        .connect_timeout(REGISTRY_PROBE_TIMEOUT)
        .timeout(REGISTRY_PROBE_TIMEOUT)
        .user_agent("JunQi Desktop npm registry probe")
        .build()
    {
        Ok(client) => client,
        Err(_) => return NpmRegistrySelection::china_default(),
    };

    select_from_live_registry_probes(&client, OFFICIAL_NPM_REGISTRY, CHINA_NPM_REGISTRY).await
}

/// Probe both registries before selecting a release. Metadata reachability is
/// not the same as tarball availability; retaining the official probe gives
/// `npm_install_with_fallback` a real second candidate when the mirror serves
/// stale or incomplete package data.
async fn select_from_live_registry_probes(
    client: &reqwest::Client,
    official_registry: NpmRegistry,
    mirror_registry: NpmRegistry,
) -> NpmRegistrySelection {
    let (official, mirror) = tokio::join!(
        probe_registry(client, official_registry),
        probe_registry(client, mirror_registry),
    );
    select_from_probes(official, mirror)
}

async fn probe_registry(client: &reqwest::Client, registry: NpmRegistry) -> Option<RegistryProbe> {
    let endpoint = RegistryEndpoint::public(registry);
    let metadata = probe_endpoint(client, &endpoint, "latest").await?;
    Some(RegistryProbe {
        registry,
        version: metadata.version,
        node_requirement: metadata.node_requirement,
    })
}

fn release_metadata_from_package(metadata: PackageMetadata) -> Option<ReleaseMetadata> {
    let version = metadata.version.filter(|value| !value.trim().is_empty())?;
    if !is_valid_openclaw_package_version(&version) {
        return None;
    }
    let node_requirement = metadata
        .engines
        .and_then(|engines| engines.node)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let tarball = metadata
        .dist
        .and_then(|dist| dist.tarball)
        .filter(|value| !value.trim().is_empty())?;
    let Ok(tarball_url) = Url::parse(&tarball) else {
        return None;
    };
    if !matches!(tarball_url.scheme(), "https" | "http") {
        return None;
    }

    Some(ReleaseMetadata {
        version,
        node_requirement,
    })
}

async fn probe_endpoint(
    client: &reqwest::Client,
    endpoint: &RegistryEndpoint,
    selector: &str,
) -> Option<ReleaseMetadata> {
    fetch_release_metadata_from_endpoint(client, endpoint, selector)
        .await
        .ok()
}

async fn fetch_release_metadata_from_endpoint(
    client: &reqwest::Client,
    endpoint: &RegistryEndpoint,
    selector: &str,
) -> Result<ReleaseMetadata, String> {
    let url = endpoint
        .metadata_url(selector)
        .ok_or_else(|| "Invalid npm registry endpoint for OpenClaw metadata".to_string())?;
    let mut request = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(authorization) = &endpoint.authorization {
        request = request.header(reqwest::header::AUTHORIZATION, authorization.clone());
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("Failed to read OpenClaw metadata: {error}"))?
        .error_for_status()
        .map_err(|error| format!("OpenClaw metadata request failed: {error}"))?;
    release_metadata_from_package(
        response
            .json::<PackageMetadata>()
            .await
            .map_err(|error| format!("Invalid OpenClaw metadata: {error}"))?,
    )
    .ok_or_else(|| "OpenClaw metadata is incomplete or invalid".to_string())
}

fn is_valid_openclaw_package_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && version
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit())
        && version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character))
}

fn require_valid_openclaw_package_version(version: &str) -> Result<(), String> {
    if is_valid_openclaw_package_version(version) {
        return Ok(());
    }
    Err("Invalid OpenClaw package version".to_string())
}

fn expand_npmrc_value(value: &str, home: &Path) -> String {
    value
        .trim()
        .trim_matches(['\"', '\''])
        .replace("${HOME}", &home.to_string_lossy())
        .replace("$HOME", &home.to_string_lossy())
        .replace("%USERPROFILE%", &home.to_string_lossy())
        .replace("%HOME%", &home.to_string_lossy())
}

fn expand_token_reference(value: &str) -> Option<String> {
    let value = value.trim().trim_matches(['\"', '\'']);
    if value.is_empty() {
        return None;
    }
    if let Some(name) = value
        .strip_prefix("${")
        .and_then(|value| value.strip_suffix('}'))
    {
        return std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty());
    }
    Some(value.to_string())
}

fn npmrc_registry_and_token(content: &str, home: &Path) -> Option<(String, Option<String>)> {
    let mut registry = None;
    let mut unscoped_token = None;
    let mut scoped_tokens = Vec::new();

    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        if key.eq_ignore_ascii_case("registry") {
            registry = Some(expand_npmrc_value(value, home));
            continue;
        }
        if key.eq_ignore_ascii_case("_authtoken") {
            unscoped_token = expand_token_reference(value);
            continue;
        }
        let lower = key.to_ascii_lowercase();
        if lower.ends_with(":_authtoken") {
            scoped_tokens.push((
                lower[..lower.len() - ":_authtoken".len()].to_string(),
                value,
            ));
        }
    }

    let registry = registry.filter(|value| !value.trim().is_empty())?;
    let scoped_token = Url::parse(registry.trim()).ok().and_then(|url| {
        let host = url.host_str()?.to_ascii_lowercase();
        let path = url.path().trim_end_matches('/');
        scoped_tokens.into_iter().rev().find_map(|(scope, value)| {
            let scope = scope.trim_end_matches('/');
            let matches_host = scope.contains(&host);
            let matches_path = path.is_empty() || scope.ends_with(path);
            (matches_host && matches_path).then(|| expand_token_reference(value))?
        })
    });
    Some((registry, scoped_token.or(unscoped_token)))
}

/// The effective explicit registry setting inherited by npm.  Installation
/// transport and metadata resolution must inspect this one source, otherwise
/// a custom global config can produce a version contract from one registry and
/// an install command that is silently redirected to another.
#[derive(Default)]
struct ExplicitNpmRegistry {
    configured: bool,
    endpoint: Option<RegistryEndpoint>,
}

fn explicit_npm_registry_from_content(
    content: &str,
    home: &Path,
    environment_token: Option<&str>,
) -> Option<ExplicitNpmRegistry> {
    let (raw, token) = npmrc_registry_and_token(content, home)?;
    Some(ExplicitNpmRegistry {
        configured: true,
        endpoint: RegistryEndpoint::configured(&raw, token.as_deref().or(environment_token)),
    })
}

fn explicit_npm_registry_from_config_paths(
    home: &Path,
    registry_override: Option<&str>,
    environment_token: Option<&str>,
    config_paths: &[PathBuf],
) -> ExplicitNpmRegistry {
    if let Some(registry) = registry_override.filter(|value| !value.trim().is_empty()) {
        let config_token = config_paths.iter().find_map(|path| {
            let content = std::fs::read_to_string(path).ok()?;
            // The environment owns the effective registry value, but npmrc
            // may still contain the host-scoped credential for that endpoint.
            let content = format!("{content}\nregistry={registry}");
            npmrc_registry_and_token(&content, home).and_then(|(_, token)| token)
        });
        return ExplicitNpmRegistry {
            configured: true,
            endpoint: RegistryEndpoint::configured(
                registry,
                config_token.as_deref().or(environment_token),
            ),
        };
    }

    for path in config_paths {
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        if let Some(policy) = explicit_npm_registry_from_content(&content, home, environment_token)
        {
            return policy;
        }
    }
    ExplicitNpmRegistry::default()
}

fn npm_config_path_from_output(raw: &str) -> Option<PathBuf> {
    let value = raw.trim().trim_matches(['"', '\\']);
    if value.is_empty() || matches!(value, "null" | "undefined") {
        return None;
    }
    let path = PathBuf::from(value);
    path.is_absolute().then_some(path)
}

async fn npm_config_path_for_node(node: &Path, key: &str) -> Result<Option<PathBuf>, String> {
    let context = crate::commands::system::NpmExecutionContext::for_node(node)?;
    let mut command = context.command();
    command
        .args(["config", "get", key])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(15), command.output())
        .await
        .map_err(|_| format!("Selected npm timed out while reading {key} configuration"))?
        .map_err(|error| format!("Failed to read selected npm {key} configuration: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Selected npm could not read {key} configuration (exit {})",
            output.status
        ));
    }
    Ok(npm_config_path_from_output(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

async fn explicit_npm_registry_for_node(node: &Path) -> Result<ExplicitNpmRegistry, String> {
    let home = crate::platform::home_dir()
        .ok_or_else(|| "Unable to resolve the current user's home directory for npm".to_string())?;
    let environment_token = std::env::var("NODE_AUTH_TOKEN")
        .ok()
        .or_else(|| std::env::var("NPM_TOKEN").ok());
    let registry_override = ["npm_config_registry", "NPM_CONFIG_REGISTRY"]
        .into_iter()
        .find_map(|key| std::env::var(key).ok())
        .filter(|value| !value.trim().is_empty());
    // npm, rather than JunQi, owns the effective user/global config paths.
    // This includes Windows `etc\\npmrc`, Node managers, and an overridden
    // userconfig without making assumptions about a particular machine.
    let mut config_paths = Vec::new();
    for key in ["userconfig", "globalconfig"] {
        if let Some(path) = npm_config_path_for_node(node, key).await? {
            if !config_paths
                .iter()
                .any(|known: &PathBuf| crate::paths::paths_refer_to_same_location(known, &path))
            {
                config_paths.push(path);
            }
        }
    }
    if config_paths.is_empty() {
        return Err("Selected npm did not report userconfig or globalconfig paths".to_string());
    }
    Ok(explicit_npm_registry_from_config_paths(
        &home,
        registry_override.as_deref(),
        environment_token.as_deref(),
        &config_paths,
    ))
}

/// Resolve the one registry policy that every package operation must use for
/// a selected Node/npm pair. A configured registry is never mixed with public
/// mirror probes: its package metadata, npm install, update dry-run, and
/// update execution all retain that same user-selected source.
pub(crate) async fn resolve_effective_npm_registry_policy(
    node: &Path,
) -> Result<EffectiveNpmRegistryPolicy, String> {
    let explicit = explicit_npm_registry_for_node(node).await?;
    if explicit.configured {
        let endpoint = explicit.endpoint.ok_or_else(|| {
            "The selected npm runtime has an invalid explicit registry configuration; correct npm config before installing or updating OpenClaw"
                .to_string()
        })?;
        return Ok(EffectiveNpmRegistryPolicy::configured(endpoint));
    }
    Ok(EffectiveNpmRegistryPolicy::public(
        select_npm_registry().await,
    ))
}

/// Resolve one concrete package release and its Node.js contract. A missing
/// contract is a hard failure for installation: using a local fallback can
/// accept a runtime that the package about to be installed does not support.
pub(crate) async fn resolve_latest_openclaw_release_target(
    node: &Path,
) -> Result<OpenclawReleaseTarget, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(REGISTRY_PROBE_TIMEOUT)
        .timeout(REGISTRY_PROBE_TIMEOUT)
        .user_agent("JunQi Desktop npm metadata resolver")
        .build()
        .map_err(|error| format!("Failed to initialize npm metadata resolver: {error}"))?;
    let policy = resolve_effective_npm_registry_policy(node).await?;
    let mut failures = Vec::new();
    for source in policy.sources() {
        match source.latest_metadata(&client).await {
            Ok(metadata) => {
                let version = metadata.version;
                return resolve_pinned_openclaw_release_target(&client, &policy, &version).await;
            }
            Err(error) => failures.push(format!("{}: {error}", source.label())),
        }
    }
    Err(format!(
        "Unable to determine the target OpenClaw package version from the selected npm source: {}",
        failures.join("; ")
    ))
}

/// Resolve an exact OpenClaw release through the selected npm policy.
///
/// Runtime relocation uses this rather than `latest`: moving an npm prefix
/// must reproduce the installed package contract, not silently upgrade it.
/// Public registry fallbacks are retained only when they publish the exact
/// same version and Node.js requirement.
pub(crate) async fn resolve_openclaw_release_target(
    node: &Path,
    version: &str,
) -> Result<OpenclawReleaseTarget, String> {
    require_valid_openclaw_package_version(version)?;
    let client = reqwest::Client::builder()
        .connect_timeout(REGISTRY_PROBE_TIMEOUT)
        .timeout(REGISTRY_PROBE_TIMEOUT)
        .user_agent("JunQi Desktop npm metadata resolver")
        .build()
        .map_err(|error| format!("Failed to initialize npm metadata resolver: {error}"))?;
    let policy = resolve_effective_npm_registry_policy(node).await?;
    resolve_pinned_openclaw_release_target(&client, &policy, version).await
}

async fn resolve_pinned_openclaw_release_target(
    client: &reqwest::Client,
    policy: &EffectiveNpmRegistryPolicy,
    version: &str,
) -> Result<OpenclawReleaseTarget, String> {
    require_valid_openclaw_package_version(version)?;
    let mut failures = Vec::new();
    for (index, source) in policy.sources().iter().enumerate() {
        match source.metadata_for_version(client, version).await {
            Ok(metadata) if metadata.version != version => failures.push(format!(
                "{}: requested OpenClaw {version}, received {}",
                source.label(),
                metadata.version
            )),
            Ok(metadata) => {
                let node_requirement = metadata.node_requirement.ok_or_else(|| {
                    format!(
                        "OpenClaw {version} does not publish an engines.node requirement; installation was not started"
                    )
                })?;
                if node_requirement.trim().is_empty() {
                    return Err(format!(
                        "OpenClaw {version} returned an empty engines.node requirement; installation was not started"
                    ));
                }

                let mut sources = vec![source.clone()];
                for fallback in policy.sources().iter().skip(index + 1) {
                    if let Ok(candidate) = fallback.metadata_for_version(client, version).await {
                        if candidate.version == version
                            && candidate.node_requirement.as_deref()
                                == Some(node_requirement.as_str())
                        {
                            sources.push(fallback.clone());
                        }
                    }
                }
                return Ok(OpenclawReleaseTarget {
                    version: version.to_string(),
                    node_requirement,
                    sources,
                });
            }
            Err(error) => failures.push(format!("{}: {error}", source.label())),
        }
    }
    Err(format!(
        "Unable to resolve OpenClaw {version} from the selected npm source: {}",
        failures.join("; ")
    ))
}

fn select_from_probes(
    official: Option<RegistryProbe>,
    mirror: Option<RegistryProbe>,
) -> NpmRegistrySelection {
    match (official, mirror) {
        (Some(official), Some(mirror)) if mirror.version == official.version => {
            NpmRegistrySelection {
                primary: mirror.registry,
                fallback: Some(official.registry),
                package_version: Some(official.version),
                node_requirement: official.node_requirement,
            }
        }
        (Some(official), Some(_stale_mirror)) => NpmRegistrySelection {
            primary: official.registry,
            fallback: None,
            package_version: Some(official.version),
            node_requirement: official.node_requirement,
        },
        (Some(official), None) => NpmRegistrySelection {
            primary: official.registry,
            fallback: None,
            package_version: Some(official.version),
            node_requirement: official.node_requirement,
        },
        (None, Some(mirror)) => NpmRegistrySelection {
            primary: mirror.registry,
            // The mirror probe can win even when the official metadata probe
            // timed out. Keep the official URL as an unvalidated tarball
            // fallback; npm will verify the pinned package version and the
            // installer will still validate the complete payload afterward.
            fallback: Some(OFFICIAL_NPM_REGISTRY),
            package_version: Some(mirror.version),
            node_requirement: mirror.node_requirement,
        },
        (None, None) => NpmRegistrySelection::china_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    fn probe(registry: NpmRegistry, _latency_ms: u64, version: &str) -> RegistryProbe {
        RegistryProbe {
            registry,
            version: version.to_string(),
            node_requirement: Some(">=24.15.0 <25".to_string()),
        }
    }

    struct TestRegistryServer {
        registry: NpmRegistry,
        worker: thread::JoinHandle<()>,
    }

    impl TestRegistryServer {
        fn spawn(kind: NpmRegistryKind, body: &str) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let body = body.to_string();
            let worker = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 1024];
                let received = stream.read(&mut request).unwrap();
                assert!(received > 0, "registry probe did not send an HTTP request");
                let headers = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream.write_all(headers.as_bytes()).unwrap();
                stream.write_all(body.as_bytes()).unwrap();
            });

            // NpmRegistry intentionally owns static endpoint definitions in
            // production. Tests create an ephemeral loopback endpoint, whose
            // URL must therefore live for the duration of the test process.
            let url = Box::leak(format!("http://{address}").into_boxed_str());
            Self {
                registry: NpmRegistry { kind, url },
                worker,
            }
        }

        fn join(self) {
            self.worker.join().unwrap();
        }
    }

    fn latest_package_metadata(version: &str, node_requirement: &str) -> String {
        format!(
            r#"{{"version":"{version}","engines":{{"node":"{node_requirement}"}},"dist":{{"tarball":"https://registry.example.test/openclaw-{version}.tgz"}}}}"#
        )
    }

    #[test]
    fn keeps_the_china_registry_first_when_both_are_healthy() {
        let selection = select_from_probes(
            Some(probe(OFFICIAL_NPM_REGISTRY, 80, "2026.7.1")),
            Some(probe(CHINA_NPM_REGISTRY, 50, "2026.7.1")),
        );

        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
        assert_eq!(selection.package_version.as_deref(), Some("2026.7.1"));
    }

    #[test]
    fn chooses_the_china_mirror_when_the_matching_official_source_is_slow() {
        let selection = select_from_probes(
            Some(probe(OFFICIAL_NPM_REGISTRY, 900, "2026.7.1")),
            Some(probe(CHINA_NPM_REGISTRY, 90, "2026.7.1")),
        );

        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
        assert_eq!(selection.package_version.as_deref(), Some("2026.7.1"));
    }

    #[test]
    fn stale_mirror_cannot_replace_the_official_release_contract() {
        let selection = select_from_probes(
            Some(probe(OFFICIAL_NPM_REGISTRY, 900, "2026.7.1")),
            Some(probe(CHINA_NPM_REGISTRY, 90, "2026.7.0")),
        );

        assert_eq!(selection.primary, OFFICIAL_NPM_REGISTRY);
        assert_eq!(selection.fallback, None);
        assert_eq!(selection.package_version.as_deref(), Some("2026.7.1"));
    }

    #[test]
    fn uses_the_mirror_when_the_official_registry_is_unavailable() {
        let selection = select_from_probes(None, Some(probe(CHINA_NPM_REGISTRY, 90, "2026.7.1")));

        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
        assert_eq!(selection.package_version.as_deref(), Some("2026.7.1"));
    }

    #[test]
    fn unavailable_registries_fall_back_without_claiming_a_version() {
        let selection = select_from_probes(None, None);

        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
        assert_eq!(selection.package_version, None);
        assert_eq!(selection.node_requirement, None);
    }

    #[test]
    fn matching_mirror_remains_the_first_public_transport_source() {
        let official = probe(OFFICIAL_NPM_REGISTRY, 900, "2026.7.1");
        let mut mirror = probe(CHINA_NPM_REGISTRY, 50, "2026.7.1");
        mirror.node_requirement = Some(">=26".to_string());
        let selection = select_from_probes(Some(official), Some(mirror));
        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
    }

    #[test]
    fn configured_registry_is_an_exclusive_effective_source() {
        let endpoint = RegistryEndpoint::configured(
            "https://user:secret@registry.example.test/npm/",
            Some("token-value"),
        )
        .unwrap();
        let policy = EffectiveNpmRegistryPolicy::configured(endpoint.clone());

        assert_eq!(policy.sources().len(), 1);
        assert_eq!(policy.sources()[0].public_registry(), None);
        assert_eq!(policy.sources()[0].label(), "user-configured npm registry");
        assert!(!endpoint.url.as_str().contains("secret"));
        assert!(!endpoint.url.as_str().contains("token-value"));
    }

    #[test]
    fn public_policy_keeps_only_the_validated_public_candidates() {
        let policy = EffectiveNpmRegistryPolicy::public(NpmRegistrySelection {
            primary: CHINA_NPM_REGISTRY,
            fallback: Some(OFFICIAL_NPM_REGISTRY),
            package_version: Some("2026.7.1".to_string()),
            node_requirement: Some(">=24.15.0 <25".to_string()),
        });

        assert_eq!(
            policy
                .sources()
                .iter()
                .filter_map(NpmPackageSource::public_registry)
                .collect::<Vec<_>>(),
            vec![CHINA_NPM_REGISTRY, OFFICIAL_NPM_REGISTRY]
        );
    }

    #[test]
    fn npmrc_registry_parser_handles_scoped_token_without_exposing_it() {
        let home = PathBuf::from(r"C:\Users\Example");
        let content = r#"
            registry=https://registry.example.test/npm/
            //registry.example.test/npm/:_authToken=do-not-log
        "#;
        let endpoint = explicit_npm_registry_from_content(content, &home, None)
            .unwrap()
            .endpoint
            .unwrap();
        assert_eq!(endpoint.url.as_str(), "https://registry.example.test/npm/");
        assert!(endpoint.authorization.is_some());
    }

    #[test]
    fn explicit_registry_policy_uses_the_same_config_source_as_metadata_resolution() {
        let home = std::env::temp_dir().join(format!(
            "junqi-npm-registry-policy-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&home).unwrap();
        let global_config = home.join("global-npmrc");
        std::fs::write(
            &global_config,
            "registry=https://registry.example.test/npm/\n",
        )
        .unwrap();

        let policy = explicit_npm_registry_from_config_paths(&home, None, None, &[global_config]);

        assert!(policy.configured);
        assert_eq!(
            policy.endpoint.unwrap().url.as_str(),
            "https://registry.example.test/npm/"
        );
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn explicit_registry_policy_preserves_invalid_overrides_for_npm_to_report() {
        let home = PathBuf::from(r"C:\Users\Example");
        let policy =
            explicit_npm_registry_from_config_paths(&home, Some("not a registry URL"), None, &[]);

        assert!(policy.configured);
        assert!(policy.endpoint.is_none());
    }

    #[test]
    fn explicit_registry_policy_preserves_invalid_npmrc_values_for_npm_to_report() {
        let home = std::env::temp_dir().join(format!(
            "junqi-invalid-npm-registry-policy-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&home).unwrap();
        let config = home.join(".npmrc");
        std::fs::write(&config, "registry=not a registry URL\n").unwrap();

        let policy = explicit_npm_registry_from_config_paths(&home, None, None, &[config]);

        assert!(policy.configured);
        assert!(policy.endpoint.is_none());
        let _ = std::fs::remove_dir_all(home);
    }

    #[tokio::test]
    async fn successful_mirror_metadata_keeps_official_registry_in_install_candidates() {
        let version = "2026.7.1";
        let node_requirement = ">=24.15.0 <25";
        let official = TestRegistryServer::spawn(
            NpmRegistryKind::Official,
            &latest_package_metadata(version, node_requirement),
        );
        let mirror = TestRegistryServer::spawn(
            NpmRegistryKind::ChinaMirror,
            &latest_package_metadata(version, node_requirement),
        );
        let client = reqwest::Client::builder().build().unwrap();
        let official_registry = official.registry;
        let mirror_registry = mirror.registry;

        let selection =
            select_from_live_registry_probes(&client, official_registry, mirror_registry).await;

        mirror.join();
        official.join();

        assert_eq!(selection.primary, mirror_registry);
        assert_eq!(selection.package_version.as_deref(), Some(version));
        assert_eq!(
            selection.node_requirement.as_deref(),
            Some(node_requirement)
        );
        assert_eq!(
            selection.candidates(),
            vec![mirror_registry, official_registry]
        );
    }

    #[test]
    fn release_target_pins_a_validated_version_for_every_registry_attempt() {
        let target = OpenclawReleaseTarget {
            version: "2026.7.1".to_string(),
            node_requirement: ">=24.15.0 <25".to_string(),
            sources: vec![
                NpmPackageSource::public(CHINA_NPM_REGISTRY),
                NpmPackageSource::public(OFFICIAL_NPM_REGISTRY),
            ],
        };

        assert_eq!(target.package_spec(), "openclaw@2026.7.1");
        assert_eq!(
            target
                .sources()
                .iter()
                .filter_map(NpmPackageSource::public_registry)
                .collect::<Vec<_>>(),
            vec![CHINA_NPM_REGISTRY, OFFICIAL_NPM_REGISTRY]
        );
        assert!(is_valid_openclaw_package_version("2026.7.1-beta.2"));
        assert!(!is_valid_openclaw_package_version("latest"));
        assert!(!is_valid_openclaw_package_version("2026.7.1/../../other"));
    }

    #[tokio::test]
    async fn exact_release_target_uses_the_requested_version_contract() {
        let version = "2026.7.1-2";
        let node_requirement = ">=24.15.0 <25";
        let server = TestRegistryServer::spawn(
            NpmRegistryKind::Official,
            &latest_package_metadata(version, node_requirement),
        );
        let client = reqwest::Client::builder().build().unwrap();
        let policy = EffectiveNpmRegistryPolicy {
            sources: vec![NpmPackageSource::public(server.registry)],
        };

        let target = resolve_pinned_openclaw_release_target(&client, &policy, version)
            .await
            .unwrap();

        server.join();
        assert_eq!(target.version(), version);
        assert_eq!(target.node_requirement(), node_requirement);
    }
}
