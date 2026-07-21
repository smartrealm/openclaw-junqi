//! Selective Agent / Skill sharing packages.
//!
//! A package is a ZIP file with a small `manifest.json` and the explicitly
//! selected files under `files/`. The commands intentionally never follow
//! symlinks, reject archive traversal, and leave credentials unselected by
//! default so a share operation cannot accidentally publish local state.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeSet, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use zip::write::SimpleFileOptions;

const PACKAGE_FORMAT: &str = "junqi-share-package";
const PACKAGE_VERSION: u32 = 1;
const MAX_ENTRY_COUNT: usize = 10_000;
const MAX_SINGLE_FILE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 500 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

const OMITTED_DIRECTORY_NAMES: &[&str] = &[
    ".git",
    ".next",
    ".nuxt",
    ".cache",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "venv",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageSourceEntry {
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub recommended: bool,
    pub sensitive: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excluded_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageSourceScan {
    pub root: String,
    pub entries: Vec<SharePackageSourceEntry>,
    pub omitted_directories: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageFile {
    pub path: String,
    pub size: u64,
    #[serde(default)]
    pub executable: bool,
    #[serde(default)]
    pub sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageManifest {
    pub format: String,
    pub version: u32,
    pub kind: String,
    pub name: String,
    pub created_at: i64,
    #[serde(default)]
    pub metadata: Value,
    #[serde(default)]
    pub files: Vec<SharePackageFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageExportRequest {
    pub kind: String,
    pub name: String,
    pub root: String,
    pub destination: String,
    #[serde(default)]
    pub selected_paths: Vec<String>,
    #[serde(default)]
    pub include_sensitive: bool,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageExportResult {
    pub destination: String,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageInspectResult {
    pub package_path: String,
    pub manifest: SharePackageManifest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageImportPreviewRequest {
    pub source_path: String,
    pub target_parent: String,
    pub target_name: String,
    #[serde(default)]
    pub selected_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageImportConflict {
    pub path: String,
    pub existing_kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageImportPreview {
    pub target_path: String,
    pub selected_files: Vec<SharePackageFile>,
    pub conflicts: Vec<SharePackageImportConflict>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageImportRequest {
    pub source_path: String,
    pub target_parent: String,
    pub target_name: String,
    #[serde(default)]
    pub selected_paths: Vec<String>,
    pub conflict_strategy: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePackageImportResult {
    pub target_path: String,
    pub imported_files: usize,
    pub skipped_files: usize,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn canonical_directory(value: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.trim());
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(format!("{label} must be an absolute directory path"));
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve {label}: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("{label} is not a directory"));
    }
    Ok(canonical)
}

fn canonical_file(value: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.trim());
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(format!("{label} must be an absolute file path"));
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve {label}: {error}"))?;
    if !canonical.is_file() {
        return Err(format!("{label} is not a file"));
    }
    Ok(canonical)
}

fn metadata_if_exists(path: &Path, label: &str) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot inspect {label}: {error}")),
    }
}

fn validate_package_kind(value: &str) -> Result<String, String> {
    match value.trim() {
        "agent" | "skill" => Ok(value.trim().to_string()),
        _ => Err("Share package kind must be either `agent` or `skill`".to_string()),
    }
}

fn normalize_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.trim().is_empty() || path.is_absolute() {
        return Err("Package paths must be non-empty relative paths".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => {
                let segment = segment.to_string_lossy();
                if segment.contains('\\') || segment.contains('\0') {
                    return Err("Package paths contain an unsupported file name".to_string());
                }
                normalized.push(segment.as_ref());
            }
            _ => return Err("Package paths cannot contain traversal segments".to_string()),
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err("Package paths must be non-empty relative paths".to_string());
    }
    Ok(normalized)
}

fn package_path_string(path: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        let Component::Normal(segment) = component else {
            return Err("Package paths cannot contain traversal segments".to_string());
        };
        let segment = segment.to_string_lossy();
        if segment.contains('\\') || segment.contains('\0') {
            return Err("Package paths contain an unsupported file name".to_string());
        }
        parts.push(segment.into_owned());
    }
    if parts.is_empty() {
        return Err("Package paths must be non-empty relative paths".to_string());
    }
    Ok(parts.join("/"))
}

fn is_omitted_directory(name: &str) -> bool {
    OMITTED_DIRECTORY_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}

fn is_sensitive_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return true;
    };
    let lower = file_name.to_ascii_lowercase();
    lower == ".env"
        || lower.starts_with(".env.")
        || lower == "id_rsa"
        || lower == "id_ed25519"
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower.ends_with(".p12")
        || lower.ends_with(".pfx")
        || lower.contains("credential")
        || lower.contains("secret")
        || lower.contains("token")
        || lower.contains("apikey")
        || lower.contains("api_key")
        || lower.contains("password")
        || lower.contains("auth")
}

fn source_entry_for_file(relative: String, size: u64, sensitive: bool) -> SharePackageSourceEntry {
    let excluded_reason = if sensitive {
        Some("Sensitive files are not selected by default".to_string())
    } else if size > MAX_SINGLE_FILE_BYTES {
        Some(format!(
            "Files larger than {} MB cannot be exported",
            MAX_SINGLE_FILE_BYTES / 1024 / 1024
        ))
    } else {
        None
    };
    SharePackageSourceEntry {
        path: relative,
        kind: "file".to_string(),
        size,
        recommended: excluded_reason.is_none(),
        sensitive,
        excluded_reason,
    }
}

fn scan_source_tree(
    root: &Path,
    current: &Path,
    entries: &mut Vec<SharePackageSourceEntry>,
    omitted_directories: &mut BTreeSet<String>,
) -> Result<(), String> {
    let mut children = fs::read_dir(current)
        .map_err(|error| format!("Cannot read package source: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Cannot inspect package source: {error}"))?;
    children.sort_by_key(|entry| entry.file_name());

    for child in children {
        if entries.len() >= MAX_ENTRY_COUNT {
            return Err(format!(
                "The selected directory contains more than {MAX_ENTRY_COUNT} entries; narrow the export scope first"
            ));
        }
        let path = child.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Cannot inspect package source entry: {error}"))?;
        if metadata.file_type().is_symlink() {
            // A link can point outside the selected root. Do not include it or
            // recurse through it; a package must always be self-contained.
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("Cannot normalize package source entry: {error}"))?;
        let relative_string = package_path_string(relative)?;
        if metadata.is_dir() {
            let name = child.file_name().to_string_lossy().into_owned();
            if is_omitted_directory(&name) {
                omitted_directories.insert(relative_string);
                continue;
            }
            entries.push(SharePackageSourceEntry {
                path: relative_string,
                kind: "directory".to_string(),
                size: 0,
                recommended: true,
                sensitive: false,
                excluded_reason: None,
            });
            scan_source_tree(root, &path, entries, omitted_directories)?;
        } else if metadata.is_file() {
            entries.push(source_entry_for_file(
                relative_string,
                metadata.len(),
                is_sensitive_file(relative),
            ));
        }
    }
    Ok(())
}

fn scan_source(root: &str) -> Result<SharePackageSourceScan, String> {
    let root = canonical_directory(root, "Package source")?;
    let mut entries = Vec::new();
    let mut omitted_directories = BTreeSet::new();
    scan_source_tree(&root, &root, &mut entries, &mut omitted_directories)?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(SharePackageSourceScan {
        root: root.to_string_lossy().into_owned(),
        entries,
        omitted_directories: omitted_directories.into_iter().collect(),
    })
}

fn selection_set(selected_paths: &[String]) -> Result<Vec<String>, String> {
    let mut selection = BTreeSet::new();
    for selected in selected_paths {
        let normalized = normalize_relative_path(selected)?;
        selection.insert(package_path_string(&normalized)?);
    }
    if selection.is_empty() {
        return Err("Choose at least one file or directory to export".to_string());
    }
    Ok(selection.into_iter().collect())
}

fn selection_includes(selection: &[String], file: &str) -> bool {
    selection.iter().any(|selected| {
        selected == file
            || file
                .strip_prefix(selected)
                .is_some_and(|suffix| suffix.starts_with('/'))
    })
}

fn selected_source_files(
    source: &SharePackageSourceScan,
    selected_paths: &[String],
    include_sensitive: bool,
) -> Result<Vec<SharePackageFile>, String> {
    let selection = selection_set(selected_paths)?;
    let mut total_bytes = 0_u64;
    let mut selected = Vec::new();

    for entry in &source.entries {
        if entry.kind != "file" || !selection_includes(&selection, &entry.path) {
            continue;
        }
        if entry.size > MAX_SINGLE_FILE_BYTES {
            return Err(format!(
                "{} is too large to include in a share package",
                entry.path
            ));
        }
        if entry.sensitive && !include_sensitive {
            return Err(format!(
                "{} looks sensitive. Enable sensitive-file export before including it",
                entry.path
            ));
        }
        total_bytes = total_bytes
            .checked_add(entry.size)
            .ok_or_else(|| "Selected files exceed the package size limit".to_string())?;
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(format!(
                "Selected files exceed the {} MB package limit",
                MAX_TOTAL_BYTES / 1024 / 1024
            ));
        }
        selected.push(SharePackageFile {
            path: entry.path.clone(),
            size: entry.size,
            executable: false,
            sensitive: entry.sensitive,
        });
    }
    if selected.is_empty() {
        return Err("Choose at least one exportable file".to_string());
    }
    Ok(selected)
}

fn metadata_contains_sensitive_key(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, nested)| {
            let key = key.to_ascii_lowercase();
            key.contains("credential")
                || key.contains("secret")
                || key.contains("token")
                || key.contains("password")
                || key.contains("apikey")
                || key.contains("api_key")
                || metadata_contains_sensitive_key(nested)
        }),
        Value::Array(values) => values.iter().any(metadata_contains_sensitive_key),
        _ => false,
    }
}

fn validate_export_metadata(metadata: &Value) -> Result<(), String> {
    if !metadata.is_null() && !metadata.is_object() {
        return Err("Share package metadata must be an object".to_string());
    }
    let serialized = serde_json::to_vec(metadata)
        .map_err(|error| format!("Cannot encode share package metadata: {error}"))?;
    if serialized.len() > 64 * 1024 {
        return Err("Share package metadata is too large".to_string());
    }
    if metadata_contains_sensitive_key(metadata) {
        return Err("Share package metadata cannot include credentials or secrets".to_string());
    }
    Ok(())
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

fn prepare_destination(value: &str) -> Result<PathBuf, String> {
    let destination = PathBuf::from(value.trim());
    if destination.as_os_str().is_empty() || !destination.is_absolute() {
        return Err("Share package destination must be an absolute .zip path".to_string());
    }
    if !destination
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        return Err("Share packages must use a .zip destination".to_string());
    }
    if metadata_if_exists(&destination, "share package destination")?.is_some() {
        return Err("A file already exists at the selected package destination".to_string());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Share package destination has no parent folder".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create share package destination: {error}"))?;
    Ok(destination)
}

fn write_selected_file(
    archive: &mut zip::ZipWriter<File>,
    root: &Path,
    file: &SharePackageFile,
) -> Result<(), String> {
    let relative = normalize_relative_path(&file.path)?;
    let source = root.join(&relative);
    let metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("Cannot inspect selected file {}: {error}", file.path))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "Selected path is not a regular file: {}",
            file.path
        ));
    }
    if metadata.len() != file.size {
        return Err(format!(
            "Selected file changed while exporting: {}",
            file.path
        ));
    }
    let permissions = if file.executable { 0o700 } else { 0o600 };
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(permissions);
    archive
        .start_file(format!("files/{}", file.path), options)
        .map_err(|error| format!("Cannot add {} to the package: {error}", file.path))?;
    let mut input = File::open(&source)
        .map_err(|error| format!("Cannot read selected file {}: {error}", file.path))?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read selected file {}: {error}", file.path))?;
        if read == 0 {
            break;
        }
        archive
            .write_all(&buffer[..read])
            .map_err(|error| format!("Cannot write selected file {}: {error}", file.path))?;
    }
    Ok(())
}

fn hydrate_selected_file_metadata(
    root: &Path,
    files: &mut [SharePackageFile],
) -> Result<(), String> {
    for file in files {
        let relative = normalize_relative_path(&file.path)?;
        let source = root.join(relative);
        let metadata = fs::symlink_metadata(&source)
            .map_err(|error| format!("Cannot inspect selected file {}: {error}", file.path))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "Selected path is not a regular file: {}",
                file.path
            ));
        }
        if metadata.len() != file.size {
            return Err(format!(
                "Selected file changed while exporting: {}",
                file.path
            ));
        }
        file.executable = is_executable(&metadata);
    }
    Ok(())
}

fn export_package(request: SharePackageExportRequest) -> Result<SharePackageExportResult, String> {
    let kind = validate_package_kind(&request.kind)?;
    let name = request.name.trim();
    if name.is_empty() || name.len() > 120 {
        return Err("Share package name must be between 1 and 120 characters".to_string());
    }
    validate_export_metadata(&request.metadata)?;
    let source = scan_source(&request.root)?;
    let root = PathBuf::from(&source.root);
    let mut files =
        selected_source_files(&source, &request.selected_paths, request.include_sensitive)?;
    files.sort_by(|left, right| left.path.cmp(&right.path));
    hydrate_selected_file_metadata(&root, &mut files)?;
    let total_bytes = files.iter().map(|file| file.size).sum();
    let manifest = SharePackageManifest {
        format: PACKAGE_FORMAT.to_string(),
        version: PACKAGE_VERSION,
        kind,
        name: name.to_string(),
        created_at: now_ms(),
        metadata: request.metadata,
        files,
    };
    let destination = prepare_destination(&request.destination)?;
    let temporary = destination.with_file_name(format!(
        ".{}.{}.tmp",
        destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("junqi-share.zip"),
        uuid::Uuid::new_v4()
    ));

    let result = (|| -> Result<(), String> {
        let output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("Cannot create share package: {error}"))?;
        let mut archive = zip::ZipWriter::new(output);
        let manifest_options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);
        archive
            .start_file("manifest.json", manifest_options)
            .map_err(|error| format!("Cannot write share package manifest: {error}"))?;
        let manifest_json = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("Cannot encode share package manifest: {error}"))?;
        archive
            .write_all(&manifest_json)
            .map_err(|error| format!("Cannot write share package manifest: {error}"))?;

        for file in &manifest.files {
            write_selected_file(&mut archive, &root, file)?;
        }
        archive
            .finish()
            .map_err(|error| format!("Cannot finish share package: {error}"))?;
        fs::rename(&temporary, &destination)
            .map_err(|error| format!("Cannot save share package: {error}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    Ok(SharePackageExportResult {
        destination: destination.to_string_lossy().into_owned(),
        file_count: manifest.files.len(),
        total_bytes,
    })
}

fn validate_manifest(manifest: &SharePackageManifest) -> Result<(), String> {
    if manifest.format != PACKAGE_FORMAT {
        return Err("This file is not a JunQi share package".to_string());
    }
    if manifest.version != PACKAGE_VERSION {
        return Err(format!(
            "Unsupported share package version: {}",
            manifest.version
        ));
    }
    validate_package_kind(&manifest.kind)?;
    if manifest.name.trim().is_empty() || manifest.name.len() > 120 {
        return Err("The package manifest has an invalid name".to_string());
    }
    validate_export_metadata(&manifest.metadata)?;
    if manifest.files.is_empty() || manifest.files.len() > MAX_ENTRY_COUNT {
        return Err("The package manifest has an invalid file list".to_string());
    }
    let mut paths = HashSet::new();
    let mut total_bytes = 0_u64;
    for file in &manifest.files {
        let normalized = normalize_relative_path(&file.path)?;
        let normalized = package_path_string(&normalized)?;
        if normalized != file.path || !paths.insert(normalized) {
            return Err("The package manifest contains duplicate or unsafe paths".to_string());
        }
        if file.size > MAX_SINGLE_FILE_BYTES {
            return Err(format!("{} exceeds the package file size limit", file.path));
        }
        total_bytes = total_bytes
            .checked_add(file.size)
            .ok_or_else(|| "The package exceeds the size limit".to_string())?;
        if total_bytes > MAX_TOTAL_BYTES {
            return Err("The package exceeds the size limit".to_string());
        }
    }
    Ok(())
}

fn read_package_manifest(path: &Path) -> Result<SharePackageManifest, String> {
    let file = File::open(path).map_err(|error| format!("Cannot open share package: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Cannot read share package: {error}"))?;
    let entry = archive
        .by_name("manifest.json")
        .map_err(|_| "The share package is missing its manifest".to_string())?;
    if entry.size() > MAX_MANIFEST_BYTES {
        return Err("The share package manifest is too large".to_string());
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read share package manifest: {error}"))?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("The share package manifest is too large".to_string());
    }
    let manifest: SharePackageManifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Cannot decode share package manifest: {error}"))?;
    validate_manifest(&manifest)?;
    for file in &manifest.files {
        let archive_path = format!("files/{}", file.path);
        let entry = archive
            .by_name(&archive_path)
            .map_err(|_| format!("The share package is missing {}", file.path))?;
        if entry.is_dir() || entry.size() != file.size {
            return Err(format!("The share package file is invalid: {}", file.path));
        }
    }
    Ok(manifest)
}

fn inspect_package(source_path: &str) -> Result<SharePackageInspectResult, String> {
    let package_path = canonical_file(source_path, "Share package")?;
    let manifest = read_package_manifest(&package_path)?;
    Ok(SharePackageInspectResult {
        package_path: package_path.to_string_lossy().into_owned(),
        manifest,
    })
}

fn normalize_target_name(value: &str) -> Result<String, String> {
    let normalized = normalize_relative_path(value.trim())?;
    if normalized.components().count() != 1 {
        return Err("Import folder name must be a single directory name".to_string());
    }
    let name = normalized
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Import folder name is invalid".to_string())?;
    if name.len() > 120 {
        return Err("Import folder name is too long".to_string());
    }
    Ok(name.to_string())
}

fn target_root(parent: &str, name: &str) -> Result<PathBuf, String> {
    let parent = canonical_directory(parent, "Import destination")?;
    let name = normalize_target_name(name)?;
    let target = parent.join(name);
    if let Some(metadata) = metadata_if_exists(&target, "import destination")? {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("Import destination must be a regular directory".to_string());
        }
        return target
            .canonicalize()
            .map_err(|error| format!("Cannot resolve import destination: {error}"));
    }
    Ok(target)
}

fn selected_manifest_files(
    manifest: &SharePackageManifest,
    selected_paths: &[String],
) -> Result<Vec<SharePackageFile>, String> {
    let selection = if selected_paths.is_empty() {
        manifest
            .files
            .iter()
            .map(|file| file.path.clone())
            .collect()
    } else {
        selection_set(selected_paths)?
    };
    let files: Vec<SharePackageFile> = manifest
        .files
        .iter()
        .filter(|file| selection_includes(&selection, &file.path))
        .cloned()
        .collect();
    if files.is_empty() {
        return Err("Choose at least one file to import".to_string());
    }
    Ok(files)
}

fn import_preview(
    request: SharePackageImportPreviewRequest,
) -> Result<SharePackageImportPreview, String> {
    let package_path = canonical_file(&request.source_path, "Share package")?;
    let manifest = read_package_manifest(&package_path)?;
    let selected_files = selected_manifest_files(&manifest, &request.selected_paths)?;
    let target = target_root(&request.target_parent, &request.target_name)?;
    let mut conflicts = Vec::new();
    for file in &selected_files {
        let relative = normalize_relative_path(&file.path)?;
        let candidate = target.join(relative);
        let Some(metadata) = metadata_if_exists(&candidate, "import conflict")? else {
            continue;
        };
        let existing_kind = if metadata.file_type().is_symlink() {
            "symlink"
        } else if metadata.is_dir() {
            "directory"
        } else {
            "file"
        };
        conflicts.push(SharePackageImportConflict {
            path: file.path.clone(),
            existing_kind: existing_kind.to_string(),
        });
    }
    Ok(SharePackageImportPreview {
        target_path: target.to_string_lossy().into_owned(),
        selected_files,
        conflicts,
    })
}

fn ensure_safe_parent(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let parent = relative.parent().map(Path::to_path_buf).unwrap_or_default();
    let mut current = root.to_path_buf();
    for component in parent.components() {
        let Component::Normal(segment) = component else {
            return Err("Package paths cannot contain traversal segments".to_string());
        };
        current.push(segment);
        if let Some(metadata) = metadata_if_exists(&current, "import directory")? {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("The import destination contains an unsafe path".to_string());
            }
        } else {
            fs::create_dir(&current)
                .map_err(|error| format!("Cannot create import directory: {error}"))?;
        }
    }
    Ok(current)
}

#[cfg(unix)]
fn apply_executable_permission(path: &Path, executable: bool) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(
        path,
        fs::Permissions::from_mode(if executable { 0o700 } else { 0o600 }),
    )
    .map_err(|error| format!("Cannot set imported file permissions: {error}"))
}

#[cfg(not(unix))]
fn apply_executable_permission(_path: &Path, _executable: bool) -> Result<(), String> {
    Ok(())
}

fn import_package(request: SharePackageImportRequest) -> Result<SharePackageImportResult, String> {
    let conflict_strategy = match request.conflict_strategy.as_str() {
        "error" | "skip" | "overwrite" => request.conflict_strategy.as_str(),
        _ => return Err("Import conflict strategy is invalid".to_string()),
    };
    let package_path = canonical_file(&request.source_path, "Share package")?;
    let manifest = read_package_manifest(&package_path)?;
    let files = selected_manifest_files(&manifest, &request.selected_paths)?;
    let target = target_root(&request.target_parent, &request.target_name)?;
    if metadata_if_exists(&target, "import destination")?.is_none() {
        fs::create_dir_all(&target)
            .map_err(|error| format!("Cannot create import destination: {error}"))?;
    }
    let target = target
        .canonicalize()
        .map_err(|error| format!("Cannot resolve import destination: {error}"))?;

    let archive_file =
        File::open(&package_path).map_err(|error| format!("Cannot open share package: {error}"))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|error| format!("Cannot read share package: {error}"))?;
    let mut imported_files = 0_usize;
    let mut skipped_files = 0_usize;

    for file in files {
        let relative = normalize_relative_path(&file.path)?;
        let destination = target.join(&relative);
        let parent = ensure_safe_parent(&target, &relative)?;
        let target_metadata = metadata_if_exists(&destination, "import conflict")?;
        let target_exists = target_metadata.is_some();
        if let Some(metadata) = target_metadata {
            if metadata.file_type().is_symlink() || metadata.is_dir() {
                return Err(format!("Cannot replace {} during import", file.path));
            }
            if conflict_strategy == "skip" {
                skipped_files += 1;
                continue;
            }
            if conflict_strategy == "error" {
                return Err(format!(
                    "{} already exists at the import destination",
                    file.path
                ));
            }
        }

        let archive_path = format!("files/{}", file.path);
        let mut entry = archive
            .by_name(&archive_path)
            .map_err(|_| format!("The share package is missing {}", file.path))?;
        if entry.is_dir() || entry.size() != file.size || entry.size() > MAX_SINGLE_FILE_BYTES {
            return Err(format!("The share package file is invalid: {}", file.path));
        }
        let file_name = relative
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "The share package contains an invalid file name".to_string())?;
        let temporary = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("Cannot create imported file: {error}"))?;
        let copied = std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Cannot extract {}: {error}", file.path))?;
        output
            .flush()
            .map_err(|error| format!("Cannot finalize {}: {error}", file.path))?;
        if copied != file.size {
            let _ = fs::remove_file(&temporary);
            return Err(format!(
                "The share package file changed while importing: {}",
                file.path
            ));
        }
        let backup = if target_exists {
            let backup = parent.join(format!(".{file_name}.{}.backup", uuid::Uuid::new_v4()));
            fs::rename(&destination, &backup)
                .map_err(|error| format!("Cannot stage existing {}: {error}", file.path))?;
            Some(backup)
        } else {
            None
        };
        if let Err(error) = fs::rename(&temporary, &destination) {
            if let Some(backup) = backup.as_ref() {
                let _ = fs::rename(backup, &destination);
            }
            let _ = fs::remove_file(&temporary);
            return Err(format!(
                "Cannot commit imported file {}: {error}",
                file.path
            ));
        }
        if let Some(backup) = backup {
            let _ = fs::remove_file(backup);
        }
        apply_executable_permission(&destination, file.executable)?;
        imported_files += 1;
    }

    Ok(SharePackageImportResult {
        target_path: target.to_string_lossy().into_owned(),
        imported_files,
        skipped_files,
    })
}

#[tauri::command]
pub async fn scan_share_package_source(root: String) -> Result<SharePackageSourceScan, String> {
    tokio::task::spawn_blocking(move || scan_source(&root))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn export_share_package(
    request: SharePackageExportRequest,
) -> Result<SharePackageExportResult, String> {
    tokio::task::spawn_blocking(move || export_package(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn inspect_share_package(
    source_path: String,
) -> Result<SharePackageInspectResult, String> {
    tokio::task::spawn_blocking(move || inspect_package(&source_path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn preview_share_package_import(
    request: SharePackageImportPreviewRequest,
) -> Result<SharePackageImportPreview, String> {
    tokio::task::spawn_blocking(move || import_preview(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn import_share_package(
    request: SharePackageImportRequest,
) -> Result<SharePackageImportResult, String> {
    tokio::task::spawn_blocking(move || import_package(request))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "junqi-share-package-{label}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn package_paths_reject_traversal_and_absolute_paths() {
        assert!(normalize_relative_path("../secrets.txt").is_err());
        assert!(normalize_relative_path("/tmp/secrets.txt").is_err());
        assert!(normalize_relative_path("agents/definition.md").is_ok());
    }

    #[test]
    fn scan_marks_sensitive_files_and_omits_runtime_directories() {
        let root = test_root("scan");
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::create_dir_all(root.join("skills")).unwrap();
        fs::write(root.join(".env"), "TOKEN=secret").unwrap();
        fs::write(root.join("skills/SKILL.md"), "# Skill").unwrap();
        fs::write(root.join("node_modules/index.js"), "ignored").unwrap();

        let scan = scan_source(&root.to_string_lossy()).unwrap();
        assert!(scan
            .entries
            .iter()
            .any(|entry| entry.path == ".env" && entry.sensitive));
        assert!(scan
            .entries
            .iter()
            .any(|entry| entry.path == "skills/SKILL.md" && entry.recommended));
        assert!(scan
            .entries
            .iter()
            .all(|entry| !entry.path.starts_with("node_modules/")));
        assert!(scan
            .omitted_directories
            .iter()
            .any(|path| path == "node_modules"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_files_round_trip_without_unselected_credentials() {
        let root = test_root("roundtrip-source");
        let destination_root = test_root("roundtrip-destination");
        let package = root.join("agent.junqi-agent.zip");
        fs::create_dir_all(root.join("agents")).unwrap();
        fs::create_dir_all(&destination_root).unwrap();
        fs::write(root.join("AGENTS.md"), "agent instructions").unwrap();
        fs::write(root.join("agents/research.md"), "research persona").unwrap();
        fs::write(root.join(".env"), "TOKEN=do-not-share").unwrap();

        let exported = export_package(SharePackageExportRequest {
            kind: "agent".to_string(),
            name: "Research agent".to_string(),
            root: root.to_string_lossy().into_owned(),
            destination: package.to_string_lossy().into_owned(),
            selected_paths: vec!["AGENTS.md".to_string(), "agents".to_string()],
            include_sensitive: false,
            metadata: json!({"agent": {"id": "research", "name": "Research"}}),
        })
        .unwrap();
        assert_eq!(exported.file_count, 2);

        let inspection = inspect_package(&package.to_string_lossy()).unwrap();
        assert_eq!(inspection.manifest.kind, "agent");
        assert!(inspection
            .manifest
            .files
            .iter()
            .all(|file| file.path != ".env"));

        let imported = import_package(SharePackageImportRequest {
            source_path: package.to_string_lossy().into_owned(),
            target_parent: destination_root.to_string_lossy().into_owned(),
            target_name: "research-agent".to_string(),
            selected_paths: Vec::new(),
            conflict_strategy: "error".to_string(),
        })
        .unwrap();
        assert_eq!(imported.imported_files, 2);
        assert_eq!(
            fs::read_to_string(destination_root.join("research-agent/AGENTS.md")).unwrap(),
            "agent instructions"
        );
        assert!(!destination_root.join("research-agent/.env").exists());

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(destination_root);
    }

    #[cfg(unix)]
    #[test]
    fn import_target_refuses_symlinked_destination_folders() {
        use std::os::unix::fs::symlink;

        let parent = test_root("symlink-parent");
        let outside = test_root("symlink-outside");
        fs::create_dir_all(&parent).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, parent.join("linked-agent")).unwrap();

        assert!(target_root(&parent.to_string_lossy(), "linked-agent").is_err());

        let _ = fs::remove_dir_all(parent);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn import_preview_and_conflict_strategies_preserve_or_replace_existing_files() {
        let source = test_root("conflict-source");
        let destination = test_root("conflict-destination");
        let package = source.join("skill.junqi-skill.zip");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(destination.join("shared-skill")).unwrap();
        fs::write(source.join("SKILL.md"), "new definition").unwrap();
        fs::write(
            destination.join("shared-skill/SKILL.md"),
            "local definition",
        )
        .unwrap();

        export_package(SharePackageExportRequest {
            kind: "skill".to_string(),
            name: "Shared skill".to_string(),
            root: source.to_string_lossy().into_owned(),
            destination: package.to_string_lossy().into_owned(),
            selected_paths: vec!["SKILL.md".to_string()],
            include_sensitive: false,
            metadata: json!({"skill": {"slug": "shared-skill"}}),
        })
        .unwrap();

        let preview = import_preview(SharePackageImportPreviewRequest {
            source_path: package.to_string_lossy().into_owned(),
            target_parent: destination.to_string_lossy().into_owned(),
            target_name: "shared-skill".to_string(),
            selected_paths: Vec::new(),
        })
        .unwrap();
        assert_eq!(preview.conflicts.len(), 1);
        assert_eq!(preview.conflicts[0].path, "SKILL.md");

        let skipped = import_package(SharePackageImportRequest {
            source_path: package.to_string_lossy().into_owned(),
            target_parent: destination.to_string_lossy().into_owned(),
            target_name: "shared-skill".to_string(),
            selected_paths: Vec::new(),
            conflict_strategy: "skip".to_string(),
        })
        .unwrap();
        assert_eq!(skipped.skipped_files, 1);
        assert_eq!(
            fs::read_to_string(destination.join("shared-skill/SKILL.md")).unwrap(),
            "local definition"
        );

        let replaced = import_package(SharePackageImportRequest {
            source_path: package.to_string_lossy().into_owned(),
            target_parent: destination.to_string_lossy().into_owned(),
            target_name: "shared-skill".to_string(),
            selected_paths: Vec::new(),
            conflict_strategy: "overwrite".to_string(),
        })
        .unwrap();
        assert_eq!(replaced.imported_files, 1);
        assert_eq!(
            fs::read_to_string(destination.join("shared-skill/SKILL.md")).unwrap(),
            "new definition"
        );

        let _ = fs::remove_dir_all(source);
        let _ = fs::remove_dir_all(destination);
    }
}
