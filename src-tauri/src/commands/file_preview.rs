//! Local file preview protocol.
//!
//! A chat result can refer to any file the user has chosen to inspect. Rendering
//! a `file://` URL would bypass Tauri's scope model, while placing HTML into
//! `srcDoc` loses its sibling assets. This registry gives a clicked file a
//! short-lived, directory-bounded URL that the preview iframe can load.

use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    State,
};
use url::Url;
use uuid::Uuid;

pub const FILE_PREVIEW_SCHEME: &str = "junqi-preview";

const PREVIEW_GRANT_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_PREVIEW_RESOURCE_BYTES: u64 = 32 * 1024 * 1024;
const PREVIEW_CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

#[derive(Clone, Default)]
pub struct FilePreviewRegistry {
    grants: Arc<Mutex<HashMap<String, PreviewGrant>>>,
}

#[derive(Clone)]
struct PreviewGrant {
    target: PreviewGrantTarget,
    expires_at: Instant,
}

#[derive(Clone)]
enum PreviewGrantTarget {
    Directory(PathBuf),
    ExactFile(PathBuf),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFilePreviewResult {
    pub success: bool,
    pub url: Option<String>,
    pub error: Option<String>,
}

impl FilePreviewRegistry {
    pub fn create_preview_url(&self, raw_path: &str) -> Result<String, String> {
        let path = path_from_input(raw_path)?;
        let file = canonical_file(&path)?;
        let root = file
            .parent()
            .ok_or_else(|| "The selected file has no parent folder".to_string())?
            .to_path_buf();
        self.create_url_for_grant(file, PreviewGrantTarget::Directory(root))
    }

    /// Creates a one-file preview grant for media reconstructed from an
    /// OpenClaw transcript. Unlike local HTML previews, media files do not
    /// need access to sibling resources.
    pub(crate) fn create_exact_preview_url_for_file(&self, file: &Path) -> Result<String, String> {
        let file = canonical_file(file)?;
        self.create_url_for_grant(file.clone(), PreviewGrantTarget::ExactFile(file))
    }

    fn create_url_for_grant(
        &self,
        file: PathBuf,
        target: PreviewGrantTarget,
    ) -> Result<String, String> {
        let file_name = file
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "The file name cannot be represented safely".to_string())?;
        let token = Uuid::new_v4().simple().to_string();

        let mut grants = self
            .grants
            .lock()
            .map_err(|_| "The preview registry is unavailable".to_string())?;
        let now = Instant::now();
        grants.retain(|_, grant| grant.expires_at > now);
        grants.insert(
            token.clone(),
            PreviewGrant {
                target,
                expires_at: now + PREVIEW_GRANT_TTL,
            },
        );

        Ok(preview_url(&token, &encode_url_segment(file_name)))
    }

    fn grant_for(&self, token: &str) -> Option<PreviewGrant> {
        let mut grants = self.grants.lock().ok()?;
        let now = Instant::now();
        grants.retain(|_, grant| grant.expires_at > now);
        grants.get(token).cloned()
    }
}

#[tauri::command]
pub fn create_file_preview_url(
    path: String,
    registry: State<'_, FilePreviewRegistry>,
) -> CreateFilePreviewResult {
    match registry.create_preview_url(&path) {
        Ok(url) => CreateFilePreviewResult {
            success: true,
            url: Some(url),
            error: None,
        },
        Err(error) => CreateFilePreviewResult {
            success: false,
            url: None,
            error: Some(error),
        },
    }
}

pub fn handle_file_preview_request(
    registry: &FilePreviewRegistry,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return preview_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain; charset=utf-8",
            b"Method not allowed".to_vec(),
        );
    }

    let segments = match request_path_segments(request.uri().to_string().as_str()) {
        Some(segments) if segments.len() >= 2 => segments,
        _ => {
            return preview_response(
                StatusCode::NOT_FOUND,
                "text/plain; charset=utf-8",
                b"Preview not found".to_vec(),
            )
        }
    };
    let token = &segments[0];
    if !is_token(token) {
        return preview_response(
            StatusCode::NOT_FOUND,
            "text/plain; charset=utf-8",
            b"Preview not found".to_vec(),
        );
    }
    let Some(grant) = registry.grant_for(token) else {
        return preview_response(
            StatusCode::GONE,
            "text/plain; charset=utf-8",
            b"Preview expired".to_vec(),
        );
    };
    let Some(path) = resolve_granted_path(&grant, &segments[1..]) else {
        return preview_response(
            StatusCode::FORBIDDEN,
            "text/plain; charset=utf-8",
            b"Preview resource is not allowed".to_vec(),
        );
    };
    let Ok(metadata) = fs::metadata(&path) else {
        return preview_response(
            StatusCode::NOT_FOUND,
            "text/plain; charset=utf-8",
            b"Preview resource not found".to_vec(),
        );
    };
    if metadata.len() > MAX_PREVIEW_RESOURCE_BYTES {
        return preview_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "text/plain; charset=utf-8",
            b"Preview resource is too large".to_vec(),
        );
    }

    let content_type = content_type_for_path(&path);
    if request.method() == Method::HEAD {
        return preview_response(StatusCode::OK, content_type, Vec::new());
    }

    match fs::read(&path) {
        Ok(bytes) => preview_response(StatusCode::OK, content_type, bytes),
        Err(_) => preview_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "text/plain; charset=utf-8",
            b"Unable to read preview resource".to_vec(),
        ),
    }
}

fn path_from_input(raw_path: &str) -> Result<PathBuf, String> {
    if let Ok(url) = Url::parse(raw_path) {
        if url.scheme() == "file" {
            return url
                .to_file_path()
                .map_err(|_| "The file URL is invalid".to_string());
        }
    }
    let path = PathBuf::from(raw_path);
    if path.as_os_str().is_empty() {
        return Err("The file path is empty".to_string());
    }
    Ok(path)
}

fn canonical_file(path: &Path) -> Result<PathBuf, String> {
    let file = path
        .canonicalize()
        .map_err(|_| "The file is no longer available".to_string())?;
    if !file.is_file() {
        return Err("The selected path is not a file".to_string());
    }
    Ok(file)
}

fn preview_url(token: &str, entry: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        return format!("http://{FILE_PREVIEW_SCHEME}.localhost/{token}/{entry}");
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("{FILE_PREVIEW_SCHEME}://localhost/{token}/{entry}")
    }
}

fn request_path_segments(raw_uri: &str) -> Option<Vec<String>> {
    let url = Url::parse(raw_uri).ok()?;
    url.path_segments()?
        .filter(|segment| !segment.is_empty())
        .map(decode_url_segment)
        .collect()
}

fn decode_url_segment(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return None;
        }
        let high = hex_value(bytes[index + 1])?;
        let low = hex_value(bytes[index + 2])?;
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn is_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|value| value.is_ascii_hexdigit())
}

fn resolve_granted_path(grant: &PreviewGrant, segments: &[String]) -> Option<PathBuf> {
    match &grant.target {
        PreviewGrantTarget::Directory(root) => resolve_directory_grant_path(root, segments),
        PreviewGrantTarget::ExactFile(file) => resolve_exact_file_grant_path(file, segments),
    }
}

fn resolve_directory_grant_path(root: &Path, segments: &[String]) -> Option<PathBuf> {
    let mut relative = PathBuf::new();
    for segment in segments {
        if !is_safe_relative_segment(segment) {
            return None;
        }
        relative.push(segment);
    }
    let candidate = root.join(relative).canonicalize().ok()?;
    if !candidate.is_file() || !candidate.starts_with(root) {
        return None;
    }
    Some(candidate)
}

fn resolve_exact_file_grant_path(file: &Path, segments: &[String]) -> Option<PathBuf> {
    let [entry] = segments else {
        return None;
    };
    if !is_safe_relative_segment(entry) {
        return None;
    }
    let name = file.file_name()?.to_str()?;
    (entry == name).then(|| file.to_path_buf())
}

fn is_safe_relative_segment(value: &str) -> bool {
    if value.is_empty() || value.contains('/') || value.contains('\\') {
        return false;
    }
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

fn encode_url_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{byte:02X}"));
        }
    }
    encoded
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "pdf" => "application/pdf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        "m4v" => "video/x-m4v",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn preview_response(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-store")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", PREVIEW_CSP)
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_preview_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("junqi-preview-{unique}"));
        fs::create_dir_all(dir.join("assets")).expect("create temp preview directory");
        dir
    }

    #[test]
    fn preview_protocol_serves_relative_assets_and_rejects_traversal() {
        let dir = temp_preview_dir();
        let index = dir.join("index.html");
        fs::write(&index, "<script src=\"./assets/runtime.js\"></script>").expect("write index");
        fs::write(dir.join("assets/runtime.js"), "window.ready = true;").expect("write asset");
        fs::write(dir.join(".env"), "SECRET=never-expose").expect("write secret");

        let registry = FilePreviewRegistry::default();
        let url = registry
            .create_preview_url(index.to_str().expect("utf8 path"))
            .expect("create url");
        let asset_url = url.replace("index.html", "assets/runtime.js");
        // Encoded separators survive URL normalization and must still be
        // rejected after decoding, rather than becoming a filesystem path.
        let traversal_url = url.replace("index.html", "assets%2F..%2F.env");

        let entry = Request::builder()
            .uri(url)
            .body(Vec::new())
            .expect("entry request");
        let entry_response = handle_file_preview_request(&registry, entry);
        assert_eq!(entry_response.status(), StatusCode::OK);
        assert_eq!(
            entry_response.headers()[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
        assert!(String::from_utf8(entry_response.into_body())
            .expect("utf8 html")
            .contains("runtime.js"));

        let asset = Request::builder()
            .uri(asset_url)
            .body(Vec::new())
            .expect("asset request");
        let asset_response = handle_file_preview_request(&registry, asset);
        assert_eq!(asset_response.status(), StatusCode::OK);
        assert_eq!(
            asset_response.headers()[header::CONTENT_TYPE],
            "text/javascript; charset=utf-8"
        );

        let traversal = Request::builder()
            .uri(traversal_url)
            .body(Vec::new())
            .expect("traversal request");
        assert_eq!(
            handle_file_preview_request(&registry, traversal).status(),
            StatusCode::FORBIDDEN
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn preview_url_keeps_unicode_file_names_addressable() {
        let dir = temp_preview_dir();
        let index = dir.join("课程.html");
        fs::write(&index, "<h1>课程</h1>").expect("write unicode index");

        let registry = FilePreviewRegistry::default();
        let url = registry
            .create_preview_url(index.to_str().expect("utf8 path"))
            .expect("create url");
        assert!(url.contains('%'));
        let request = Request::builder()
            .uri(url)
            .body(Vec::new())
            .expect("unicode request");
        let response = handle_file_preview_request(&registry, request);
        assert_eq!(response.status(), StatusCode::OK);
        assert!(String::from_utf8(response.into_body())
            .expect("utf8 html")
            .contains("课程"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn exact_preview_grant_does_not_expose_sibling_files() {
        let dir = temp_preview_dir();
        let image = dir.join("history.png");
        let sibling = dir.join("other.png");
        fs::write(&image, b"image").expect("write history media");
        fs::write(&sibling, b"other").expect("write sibling media");

        let registry = FilePreviewRegistry::default();
        let url = registry
            .create_exact_preview_url_for_file(&image)
            .expect("create exact preview url");
        let sibling_url = url.replace("history.png", "other.png");

        let image_response = handle_file_preview_request(
            &registry,
            Request::builder()
                .uri(url)
                .body(Vec::new())
                .expect("image request"),
        );
        assert_eq!(image_response.status(), StatusCode::OK);

        let sibling_response = handle_file_preview_request(
            &registry,
            Request::builder()
                .uri(sibling_url)
                .body(Vec::new())
                .expect("sibling request"),
        );
        assert_eq!(sibling_response.status(), StatusCode::FORBIDDEN);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn preview_protocol_assigns_media_types_for_supported_binary_previews() {
        assert_eq!(
            content_type_for_path(Path::new("report.pdf")),
            "application/pdf"
        );
        assert_eq!(
            content_type_for_path(Path::new("recording.m4a")),
            "audio/mp4"
        );
        assert_eq!(
            content_type_for_path(Path::new("clip.mov")),
            "video/quicktime"
        );
        assert_eq!(content_type_for_path(Path::new("scan.tiff")), "image/tiff");
    }
}
