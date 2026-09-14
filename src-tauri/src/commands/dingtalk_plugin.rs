use crate::commands::docker::OPENCLAW_CONTAINER_STATE_DIR;
use crate::commands::openclaw_cli::{output_error, parse_cli_json, run_openclaw};
use crate::paths::{self, OpenClawRuntimeMode};
use crate::state::runtime_identity::{RuntimeIdentity, RuntimeIdentityState, RuntimeInstallTarget};
use flate2::read::GzDecoder;
use node_semver::{Range, Version};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};

const PLUGIN_ID: &str = "junqi-dingtalk";
const PACKAGE_NAME: &str = "@junqi/openclaw-dingtalk-business";
const ARCHIVE_FILE: &str = "junqi-dingtalk.tgz";
const METADATA_RESOURCE: &str = "dingtalk/metadata.json";
const ARCHIVE_RESOURCE: &str = "dingtalk/junqi-dingtalk.tgz";
const EMBEDDED_METADATA: &str = include_str!("../../resources/dingtalk/metadata.json");
const MAX_ARCHIVE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ENTRIES: usize = 4_096;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;

fn plugin_install_args(archive: &str) -> [&str; 6] {
    [
        "plugins",
        "install",
        "--force",
        "--accept-capabilities",
        "--acknowledge-install-policy-warning",
        archive,
    ]
}

fn plugin_enable_args() -> [&'static str; 4] {
    ["plugins", "enable", PLUGIN_ID, "--accept-capabilities"]
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BundleMetadata {
    format_version: u32,
    plugin_id: String,
    package_name: String,
    plugin_version: String,
    plugin_api_range: String,
    minimum_gateway_version: String,
    tool_count: usize,
    sha256: String,
    archive_file: String,
    resource_path: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DingTalkPluginCompatibility {
    Compatible,
    Incompatible,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkPluginStatus {
    installed: bool,
    enabled: bool,
    loaded: bool,
    version: Option<String>,
    bundled_version: String,
    restart_required: bool,
    compatibility: DingTalkPluginCompatibility,
    gateway_version: String,
    plugin_api_range: String,
    minimum_gateway_version: String,
}

fn parse_metadata(raw: &[u8]) -> Result<BundleMetadata, String> {
    if raw.is_empty() || raw.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("The DingTalk bundle metadata size is invalid".to_string());
    }
    let metadata: BundleMetadata = serde_json::from_slice(raw)
        .map_err(|error| format!("Invalid DingTalk bundle metadata: {error}"))?;
    let valid_hash = metadata.sha256.len() == 64
        && metadata
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase());
    let compatibility_contract_valid = Range::parse(&metadata.plugin_api_range).is_ok()
        && Version::parse(&metadata.minimum_gateway_version).is_ok();
    if metadata.format_version != 2
        || metadata.plugin_id != PLUGIN_ID
        || metadata.package_name != PACKAGE_NAME
        || metadata.plugin_version.trim().is_empty()
        || !compatibility_contract_valid
        || metadata.tool_count == 0
        || metadata.tool_count > MAX_ENTRIES
        || !valid_hash
        || metadata.archive_file != ARCHIVE_FILE
        || metadata.resource_path != ARCHIVE_RESOURCE
    {
        return Err("The DingTalk bundle metadata contract is invalid".to_string());
    }
    Ok(metadata)
}

fn resolve_plugin_compatibility(
    gateway_version: &str,
    metadata: &BundleMetadata,
) -> DingTalkPluginCompatibility {
    let gateway_version = gateway_version.trim().trim_start_matches('v');
    let Ok(version) = Version::parse(gateway_version) else {
        return DingTalkPluginCompatibility::Unknown;
    };
    let Ok(plugin_api_range) = Range::parse(&metadata.plugin_api_range) else {
        return DingTalkPluginCompatibility::Unknown;
    };
    let Ok(minimum_gateway_version) = Version::parse(&metadata.minimum_gateway_version) else {
        return DingTalkPluginCompatibility::Unknown;
    };
    if plugin_api_range.satisfies(&version) && version >= minimum_gateway_version {
        DingTalkPluginCompatibility::Compatible
    } else {
        DingTalkPluginCompatibility::Incompatible
    }
}

fn hash_file(path: &Path) -> Result<String, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("Could not inspect the DingTalk plugin archive: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_ARCHIVE_BYTES {
        return Err("The DingTalk plugin archive size is invalid".to_string());
    }
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Could not open the DingTalk plugin archive: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not read the DingTalk plugin archive: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn verify_archive_contract(path: &Path, metadata: &BundleMetadata) -> Result<(), String> {
    if hash_file(path)? != metadata.sha256 {
        return Err("The DingTalk plugin archive hash does not match its metadata".to_string());
    }
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Could not open the DingTalk plugin archive: {error}"))?;
    let mut archive = tar::Archive::new(GzDecoder::new(file));
    let mut package: Option<Value> = None;
    let mut manifest: Option<Value> = None;
    let mut expanded_bytes = 0_u64;
    for (index, entry) in archive
        .entries()
        .map_err(|error| format!("Invalid DingTalk plugin archive: {error}"))?
        .enumerate()
    {
        if index >= MAX_ENTRIES {
            return Err("The DingTalk plugin archive contains too many entries".to_string());
        }
        let mut entry = entry.map_err(|error| format!("Invalid archive entry: {error}"))?;
        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .ok_or_else(|| "The DingTalk plugin expanded size overflowed".to_string())?;
        if expanded_bytes > MAX_EXPANDED_BYTES {
            return Err("The DingTalk plugin expanded size exceeds the limit".to_string());
        }
        let entry_path = entry
            .path()
            .map_err(|error| format!("Invalid DingTalk archive path: {error}"))?
            .into_owned();
        if entry_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("The DingTalk plugin archive contains an unsafe path".to_string());
        }
        let normalized = entry_path.to_string_lossy().replace('\\', "/");
        if normalized != "package/package.json" && normalized != "package/openclaw.plugin.json" {
            continue;
        }
        if entry.size() > MAX_MANIFEST_BYTES {
            return Err("A DingTalk plugin manifest exceeds the size limit".to_string());
        }
        let mut raw = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut raw)
            .map_err(|error| format!("Could not read a DingTalk plugin manifest: {error}"))?;
        let value = serde_json::from_slice(&raw)
            .map_err(|error| format!("Invalid DingTalk plugin manifest: {error}"))?;
        if normalized == "package/package.json" {
            package = Some(value);
        } else {
            manifest = Some(value);
        }
    }
    let package = package.ok_or_else(|| "The archive is missing package.json".to_string())?;
    let manifest =
        manifest.ok_or_else(|| "The archive is missing openclaw.plugin.json".to_string())?;
    let manifest_tools = manifest
        .pointer("/contracts/tools")
        .and_then(Value::as_array)
        .ok_or_else(|| "The DingTalk plugin manifest omitted the tool contract".to_string())?;
    let tool_ids = manifest_tools
        .iter()
        .map(|value| value.as_str().filter(|id| !id.trim().is_empty()))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| "The DingTalk plugin manifest contains an invalid tool ID".to_string())?;
    let unique_tool_ids = tool_ids
        .iter()
        .copied()
        .collect::<std::collections::HashSet<_>>();
    if package.get("name").and_then(Value::as_str) != Some(PACKAGE_NAME)
        || package.get("version").and_then(Value::as_str) != Some(metadata.plugin_version.as_str())
        || package
            .pointer("/openclaw/compat/pluginApi")
            .and_then(Value::as_str)
            != Some(metadata.plugin_api_range.as_str())
        || package
            .pointer("/openclaw/compat/minGatewayVersion")
            .and_then(Value::as_str)
            != Some(metadata.minimum_gateway_version.as_str())
        || manifest.get("id").and_then(Value::as_str) != Some(PLUGIN_ID)
        || manifest.get("version").and_then(Value::as_str) != Some(metadata.plugin_version.as_str())
        || tool_ids.len() != metadata.tool_count
        || unique_tool_ids.len() != tool_ids.len()
    {
        return Err("The DingTalk archive identity does not match its metadata".to_string());
    }
    Ok(())
}

fn resolve_bundle(app: &AppHandle) -> Result<(BundleMetadata, PathBuf), String> {
    let embedded = parse_metadata(EMBEDDED_METADATA.as_bytes())?;
    let metadata_path = app
        .path()
        .resolve(METADATA_RESOURCE, BaseDirectory::Resource)
        .map_err(|error| format!("Could not resolve DingTalk bundle metadata: {error}"))?;
    let resource = parse_metadata(
        &std::fs::read(metadata_path)
            .map_err(|error| format!("Could not read DingTalk bundle metadata: {error}"))?,
    )?;
    if resource != embedded {
        return Err(
            "The installed DingTalk bundle metadata does not match this binary".to_string(),
        );
    }
    let archive = app
        .path()
        .resolve(ARCHIVE_RESOURCE, BaseDirectory::Resource)
        .map_err(|error| format!("Could not resolve the DingTalk plugin archive: {error}"))?;
    let archive = std::fs::canonicalize(archive)
        .map_err(|error| format!("Could not resolve the DingTalk plugin archive: {error}"))?;
    verify_archive_contract(&archive, &embedded)?;
    Ok((embedded, archive))
}

fn stage_for_selected_runtime(
    source: &Path,
    expected_hash: &str,
    identity: &RuntimeIdentity,
) -> Result<PathBuf, String> {
    if paths::active_runtime_mode() != OpenClawRuntimeMode::Docker {
        return Ok(source.to_path_buf());
    }
    let local_state_dir = Path::new(&identity.local_state_dir);
    if !local_state_dir.is_absolute() {
        return Err("The Docker runtime local state directory is not absolute".to_string());
    }
    let root = local_state_dir.join(".junqi-dingtalk");
    match std::fs::symlink_metadata(&root) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("The Docker DingTalk staging directory is unsafe".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&root)
                .map_err(|error| format!("Could not create DingTalk staging directory: {error}"))?;
        }
        Err(error) => {
            return Err(format!(
                "Could not inspect DingTalk staging directory: {error}"
            ))
        }
    }
    let destination = root.join(ARCHIVE_FILE);
    if destination.exists() {
        let existing_hash = hash_file(&destination)?;
        if existing_hash == expected_hash {
            return Ok(Path::new(OPENCLAW_CONTAINER_STATE_DIR)
                .join(".junqi-dingtalk")
                .join(ARCHIVE_FILE));
        }
        std::fs::remove_file(&destination)
            .map_err(|error| format!("Could not replace DingTalk staging archive: {error}"))?;
    }
    let mut input = std::fs::File::open(source)
        .map_err(|error| format!("Could not open DingTalk bundle for staging: {error}"))?;
    let mut output = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&destination)
        .map_err(|error| format!("Could not create DingTalk staging archive: {error}"))?;
    std::io::copy(&mut input, &mut output)
        .and_then(|_| output.flush())
        .map_err(|error| format!("Could not stage DingTalk plugin archive: {error}"))?;
    if hash_file(&destination)? != expected_hash {
        let _ = std::fs::remove_file(&destination);
        return Err("The staged DingTalk plugin archive hash changed".to_string());
    }
    Ok(Path::new(OPENCLAW_CONTAINER_STATE_DIR)
        .join(".junqi-dingtalk")
        .join(ARCHIVE_FILE))
}

async fn inspect_plugin(
    metadata: &BundleMetadata,
    gateway_version: &str,
) -> Result<DingTalkPluginStatus, String> {
    let compatibility = resolve_plugin_compatibility(gateway_version, metadata);
    let output = run_openclaw(
        &["plugins", "list", "--json"],
        None,
        Duration::from_secs(60),
    )
    .await?;
    if !output.success {
        return Err(output_error("plugins list", &output));
    }
    let payload = parse_cli_json(&output)?;
    let plugins = payload
        .get("plugins")
        .and_then(Value::as_array)
        .ok_or_else(|| "OpenClaw plugin listing omitted the plugins array".to_string())?;
    let Some(plugin) = plugins
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some(PLUGIN_ID))
    else {
        return Ok(DingTalkPluginStatus {
            installed: false,
            enabled: false,
            loaded: false,
            version: None,
            bundled_version: metadata.plugin_version.clone(),
            restart_required: false,
            compatibility,
            gateway_version: gateway_version.to_string(),
            plugin_api_range: metadata.plugin_api_range.clone(),
            minimum_gateway_version: metadata.minimum_gateway_version.clone(),
        });
    };
    let enabled = plugin
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let loaded = plugin.get("status").and_then(Value::as_str) == Some("loaded");
    let version = plugin
        .get("version")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    Ok(DingTalkPluginStatus {
        installed: true,
        enabled,
        loaded,
        restart_required: enabled && version.as_deref() != Some(metadata.plugin_version.as_str()),
        version,
        bundled_version: metadata.plugin_version.clone(),
        compatibility,
        gateway_version: gateway_version.to_string(),
        plugin_api_range: metadata.plugin_api_range.clone(),
        minimum_gateway_version: metadata.minimum_gateway_version.clone(),
    })
}

pub(crate) fn validated_target(
    state: &RuntimeIdentityState,
    target_fingerprint: &str,
    expected_connection_id: &str,
) -> Result<RuntimeIdentity, String> {
    let identity = state
        .current()?
        .ok_or_else(|| "The Gateway runtime identity is unavailable".to_string())?;
    if !identity.verified
        || identity.connection_id != expected_connection_id
        || identity.target_fingerprint != target_fingerprint
    {
        return Err("The Gateway runtime identity changed or is not verified".to_string());
    }
    if !identity.desktop_mutation_allowed {
        return Err("The connected Gateway does not allow Desktop plugin mutation".to_string());
    }
    let selected_target_matches = matches!(
        (paths::active_runtime_mode(), identity.install_target),
        (OpenClawRuntimeMode::Native, RuntimeInstallTarget::NativeCli)
            | (
                OpenClawRuntimeMode::Docker,
                RuntimeInstallTarget::DockerExec
            )
    );
    if !selected_target_matches {
        return Err(
            "The connected Gateway does not match the selected Desktop runtime".to_string(),
        );
    }
    Ok(identity)
}

#[tauri::command]
pub async fn get_dingtalk_plugin_status(
    app: AppHandle,
    state: State<'_, RuntimeIdentityState>,
    target_fingerprint: String,
    expected_connection_id: String,
) -> Result<DingTalkPluginStatus, String> {
    let identity = validated_target(&state, &target_fingerprint, &expected_connection_id)?;
    let (metadata, _) = resolve_bundle(&app)?;
    let status = inspect_plugin(&metadata, &identity.gateway_version).await?;
    validated_target(&state, &target_fingerprint, &expected_connection_id)?;
    Ok(status)
}

#[tauri::command]
pub async fn install_bundled_dingtalk_plugin(
    app: AppHandle,
    state: State<'_, RuntimeIdentityState>,
    target_fingerprint: String,
    expected_connection_id: String,
) -> Result<DingTalkPluginStatus, String> {
    validated_target(&state, &target_fingerprint, &expected_connection_id)?;
    let _guard = crate::commands::maintenance::acquire_operation_guard().await;
    let identity = validated_target(&state, &target_fingerprint, &expected_connection_id)?;
    let (metadata, archive) = resolve_bundle(&app)?;
    if resolve_plugin_compatibility(&identity.gateway_version, &metadata)
        == DingTalkPluginCompatibility::Incompatible
    {
        return Err(format!(
            "The bundled DingTalk plugin requires OpenClaw {} or plugin API {}; the current Gateway is {}",
            metadata.minimum_gateway_version, metadata.plugin_api_range, identity.gateway_version
        ));
    }
    let cli_archive = stage_for_selected_runtime(&archive, &metadata.sha256, &identity)?;
    let cli_archive = cli_archive
        .to_str()
        .ok_or_else(|| "The DingTalk plugin archive path is not valid UTF-8".to_string())?;
    let install_args = plugin_install_args(cli_archive);
    let install = run_openclaw(&install_args, None, Duration::from_secs(300)).await?;
    if !install.success {
        return Err(output_error("plugins install", &install));
    }
    let enable_args = plugin_enable_args();
    let enable = run_openclaw(&enable_args, None, Duration::from_secs(60)).await?;
    if !enable.success {
        return Err(output_error("plugins enable", &enable));
    }
    validated_target(&state, &target_fingerprint, &expected_connection_id)?;
    let mut status = inspect_plugin(&metadata, &identity.gateway_version).await?;
    if !status.installed
        || !status.enabled
        || !status.loaded
        || status.version.as_deref() != Some(metadata.plugin_version.as_str())
    {
        return Err("The installed DingTalk plugin failed identity or load validation".to_string());
    }
    status.restart_required = true;
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_metadata_matches_the_dingtalk_contract() {
        let metadata = parse_metadata(EMBEDDED_METADATA.as_bytes()).unwrap();
        assert_eq!(metadata.plugin_id, PLUGIN_ID);
        assert_eq!(metadata.package_name, PACKAGE_NAME);
        let archive = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dingtalk")
            .join(ARCHIVE_FILE);
        verify_archive_contract(&archive, &metadata).unwrap();
    }

    #[test]
    fn metadata_rejects_a_different_tool_count() {
        let mut value: Value = serde_json::from_str(EMBEDDED_METADATA).unwrap();
        value["toolCount"] = Value::from(29);
        let metadata = parse_metadata(serde_json::to_vec(&value).unwrap().as_slice()).unwrap();
        let archive = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dingtalk")
            .join(ARCHIVE_FILE);
        assert!(verify_archive_contract(&archive, &metadata).is_err());
    }

    #[test]
    fn compatibility_rejects_a_gateway_below_the_bundled_plugin_requirement() {
        let metadata = parse_metadata(EMBEDDED_METADATA.as_bytes()).unwrap();
        assert_eq!(
            resolve_plugin_compatibility("2026.7.1-2", &metadata),
            DingTalkPluginCompatibility::Incompatible
        );
        assert_eq!(
            resolve_plugin_compatibility("2026.8.1", &metadata),
            DingTalkPluginCompatibility::Compatible
        );
        assert_eq!(
            resolve_plugin_compatibility("v2026.9.4", &metadata),
            DingTalkPluginCompatibility::Compatible
        );
    }

    #[test]
    fn compatibility_remains_unknown_for_an_unparseable_gateway_version() {
        let metadata = parse_metadata(EMBEDDED_METADATA.as_bytes()).unwrap();
        assert_eq!(
            resolve_plugin_compatibility("unavailable", &metadata),
            DingTalkPluginCompatibility::Unknown
        );
    }

    #[test]
    fn noninteractive_install_accepts_the_verified_bundle_contract() {
        assert!(!plugin_install_args("/verified/plugin.tgz").contains(&"--pin"));
        assert_eq!(
            plugin_install_args("/verified/plugin.tgz"),
            [
                "plugins",
                "install",
                "--force",
                "--accept-capabilities",
                "--acknowledge-install-policy-warning",
                "/verified/plugin.tgz",
            ]
        );
        assert_eq!(
            plugin_enable_args(),
            ["plugins", "enable", PLUGIN_ID, "--accept-capabilities"]
        );
    }
}
