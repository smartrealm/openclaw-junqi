use super::{
    hash_file, BUNDLED_ARCHIVE_RESOURCE, BUNDLED_METADATA_JSON, MAX_ARCHIVE_ENTRIES,
    MAX_ARCHIVE_EXPANDED_BYTES, MAX_MANIFEST_BYTES, MAX_PACKAGE_BYTES, PLUGIN_ID,
    PLUGIN_PACKAGE_NAME,
};
use flate2::read::GzDecoder;
use serde::Deserialize;
use serde_json::Value;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

#[derive(Debug)]
pub(super) struct VerifiedPackage {
    pub(super) source_path: PathBuf,
    pub(super) host_path: PathBuf,
    pub(super) cli_path: PathBuf,
    pub(super) sha256: String,
    pub(super) plugin_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct BundledPackageMetadata {
    pub(super) format_version: u32,
    pub(super) plugin_id: String,
    pub(super) package_name: String,
    pub(super) plugin_version: String,
    pub(super) schema_version: u32,
    pub(super) sha256: String,
    pub(super) archive_file: String,
    pub(super) resource_path: String,
}

pub(super) fn validate_archive_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("PLUGIN_ARCHIVE_PATH_MUST_BE_ABSOLUTE".to_string());
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("PLUGIN_ARCHIVE_UNAVAILABLE: {error}"))?;
    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| format!("PLUGIN_ARCHIVE_UNAVAILABLE: {error}"))?;
    if !metadata.is_file() {
        return Err("PLUGIN_ARCHIVE_NOT_FILE".to_string());
    }
    if metadata.len() == 0 || metadata.len() > MAX_PACKAGE_BYTES {
        return Err("PLUGIN_ARCHIVE_SIZE_INVALID".to_string());
    }
    if canonical
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("tgz"))
        .unwrap_or(true)
    {
        return Err("PLUGIN_ARCHIVE_MUST_BE_TGZ".to_string());
    }
    Ok(canonical)
}

pub(super) fn parse_archive_metadata(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to open plugin archive: {error}"))?;
    let decoder = GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let mut package_json: Option<Value> = None;
    let mut plugin_json: Option<Value> = None;
    let mut entries_seen = 0usize;
    let mut expanded_bytes = 0_u64;
    let entries = archive
        .entries()
        .map_err(|error| format!("Invalid plugin archive: {error}"))?;
    for entry in entries {
        entries_seen += 1;
        if entries_seen > MAX_ARCHIVE_ENTRIES {
            return Err("Plugin archive contains too many entries".to_string());
        }
        let mut entry = entry.map_err(|error| format!("Invalid plugin archive entry: {error}"))?;
        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .ok_or_else(|| "Plugin archive expanded size overflowed".to_string())?;
        if expanded_bytes > MAX_ARCHIVE_EXPANDED_BYTES {
            return Err("Plugin archive exceeds the expanded size limit".to_string());
        }
        let entry_path = entry
            .path()
            .map_err(|error| format!("Invalid plugin archive path: {error}"))?
            .into_owned();
        if entry_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("Plugin archive contains an unsafe path".to_string());
        }
        let normalized = entry_path.to_string_lossy().replace('\\', "/");
        if normalized != "package/package.json" && normalized != "package/openclaw.plugin.json" {
            continue;
        }
        if entry.size() > MAX_MANIFEST_BYTES {
            return Err("Plugin manifest exceeds the size limit".to_string());
        }
        let mut raw = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut raw)
            .map_err(|error| format!("Failed to read plugin manifest: {error}"))?;
        let value: Value = serde_json::from_slice(&raw)
            .map_err(|error| format!("Invalid plugin manifest JSON: {error}"))?;
        if normalized == "package/package.json" {
            package_json = Some(value);
        } else {
            plugin_json = Some(value);
        }
    }

    let package =
        package_json.ok_or_else(|| "Plugin archive is missing package.json".to_string())?;
    let manifest =
        plugin_json.ok_or_else(|| "Plugin archive is missing openclaw.plugin.json".to_string())?;
    if package.get("name").and_then(Value::as_str) != Some(PLUGIN_PACKAGE_NAME) {
        return Err("Plugin archive contains an unexpected npm package".to_string());
    }
    if manifest.get("id").and_then(Value::as_str) != Some(PLUGIN_ID) {
        return Err("Plugin archive contains an unexpected OpenClaw plugin id".to_string());
    }
    let package_version = package
        .get("version")
        .and_then(Value::as_str)
        .filter(|version| !version.trim().is_empty())
        .ok_or_else(|| "Plugin package version is missing".to_string())?;
    let manifest_version = manifest
        .get("version")
        .and_then(Value::as_str)
        .filter(|version| !version.trim().is_empty())
        .ok_or_else(|| "OpenClaw plugin version is missing".to_string())?;
    if package_version != manifest_version {
        return Err("Plugin package and manifest versions do not match".to_string());
    }
    let extensions_valid = package
        .get("openclaw")
        .and_then(|openclaw| openclaw.get("extensions"))
        .and_then(Value::as_array)
        .map(|extensions| {
            extensions
                .iter()
                .any(|entry| entry.as_str() == Some("./dist/index.js"))
        })
        .unwrap_or(false);
    if !extensions_valid {
        return Err("Plugin archive does not declare the expected OpenClaw entry".to_string());
    }
    Ok(package_version.to_string())
}

fn validate_bundled_metadata(
    metadata: BundledPackageMetadata,
) -> Result<BundledPackageMetadata, String> {
    if metadata.format_version != 1
        || metadata.plugin_id != PLUGIN_ID
        || metadata.package_name != PLUGIN_PACKAGE_NAME
        || metadata.archive_file != "junqi-collab.tgz"
        || metadata.resource_path != BUNDLED_ARCHIVE_RESOURCE
        || metadata.schema_version == 0
        || metadata.plugin_version.trim().is_empty()
        || metadata.plugin_version.len() > 128
        || metadata.sha256.len() != 64
        || !metadata
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("The collaboration bundle metadata is invalid".to_string());
    }
    Ok(metadata)
}

pub(super) fn parse_bundled_metadata(raw: &[u8]) -> Result<BundledPackageMetadata, String> {
    if raw.is_empty() || raw.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("The collaboration bundle metadata exceeds its size limit".to_string());
    }
    let metadata = serde_json::from_slice(raw)
        .map_err(|error| format!("Invalid collaboration bundle metadata: {error}"))?;
    validate_bundled_metadata(metadata)
}

pub(super) fn verify_package_path(
    path: &Path,
    expected_sha256: &str,
) -> Result<VerifiedPackage, (String, String)> {
    let expected = expected_sha256.trim().to_ascii_lowercase();
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err((
            "PLUGIN_SHA256_INVALID".to_string(),
            "The expected plugin SHA-256 must contain exactly 64 hexadecimal characters"
                .to_string(),
        ));
    }
    let path = validate_archive_path(path).map_err(|message| {
        (
            message
                .split(':')
                .next()
                .unwrap_or("PLUGIN_ARCHIVE_INVALID")
                .to_string(),
            message,
        )
    })?;
    let actual = hash_file(&path, MAX_PACKAGE_BYTES).map_err(|message| {
        (
            "PLUGIN_ARCHIVE_HASH_FAILED".to_string(),
            format!("Could not hash the plugin archive: {message}"),
        )
    })?;
    if actual != expected {
        return Err((
            "PLUGIN_SHA256_MISMATCH".to_string(),
            "The selected plugin archive does not match the pinned SHA-256".to_string(),
        ));
    }
    let plugin_version = parse_archive_metadata(&path)
        .map_err(|message| ("PLUGIN_ARCHIVE_INVALID".to_string(), message))?;
    Ok(VerifiedPackage {
        source_path: path.clone(),
        host_path: path.clone(),
        cli_path: path,
        sha256: actual,
        plugin_version,
    })
}

pub(super) fn verify_bundled_package_paths(
    metadata_path: &Path,
    archive_path: &Path,
) -> Result<VerifiedPackage, (String, String)> {
    let compiled_metadata =
        parse_bundled_metadata(BUNDLED_METADATA_JSON.as_bytes()).map_err(|message| {
            (
                "PLUGIN_BUNDLE_EMBEDDED_METADATA_INVALID".to_string(),
                message,
            )
        })?;
    let raw = std::fs::read(metadata_path).map_err(|error| {
        (
            "PLUGIN_BUNDLE_METADATA_UNAVAILABLE".to_string(),
            format!("Could not read the bundled collaboration metadata: {error}"),
        )
    })?;
    let resource_metadata = parse_bundled_metadata(&raw)
        .map_err(|message| ("PLUGIN_BUNDLE_METADATA_INVALID".to_string(), message))?;
    if resource_metadata != compiled_metadata {
        return Err((
            "PLUGIN_BUNDLE_METADATA_MISMATCH".to_string(),
            "The installed collaboration bundle metadata does not match this JunQi binary"
                .to_string(),
        ));
    }
    let package = verify_package_path(archive_path, &compiled_metadata.sha256)?;
    if package.plugin_version != compiled_metadata.plugin_version {
        return Err((
            "PLUGIN_BUNDLE_VERSION_MISMATCH".to_string(),
            "The bundled collaboration archive version does not match its embedded metadata"
                .to_string(),
        ));
    }
    Ok(package)
}

pub(super) fn verify_bundled_package(app: &AppHandle) -> Result<VerifiedPackage, (String, String)> {
    let metadata_path = app
        .path()
        .resolve(super::BUNDLED_METADATA_RESOURCE, BaseDirectory::Resource)
        .map_err(|error| {
            (
                "PLUGIN_BUNDLE_RESOURCE_UNAVAILABLE".to_string(),
                format!("Could not resolve the bundled collaboration metadata: {error}"),
            )
        })?;
    let archive_path = app
        .path()
        .resolve(super::BUNDLED_ARCHIVE_RESOURCE, BaseDirectory::Resource)
        .map_err(|error| {
            (
                "PLUGIN_BUNDLE_RESOURCE_UNAVAILABLE".to_string(),
                format!("Could not resolve the bundled collaboration archive: {error}"),
            )
        })?;
    verify_bundled_package_paths(&metadata_path, &archive_path)
}
