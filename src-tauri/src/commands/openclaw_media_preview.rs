//! Scoped preview access for OpenClaw-persisted media.
//!
//! OpenClaw records user-turn attachments as `MediaPath` / `MediaPaths` in
//! its transcript. The Desktop renderer must not grant arbitrary filesystem
//! access just to render those references, so this command accepts only files
//! under the active OpenClaw state directory's `media` tree.

use crate::{
    commands::file_preview::{CreateFilePreviewResult, FilePreviewRegistry},
    paths,
};
use std::path::{Path, PathBuf};
use tauri::State;

const OPENCLAW_MEDIA_DIRECTORY: &str = "media";

#[tauri::command]
pub fn create_openclaw_media_preview_url(
    path: String,
    registry: State<'_, FilePreviewRegistry>,
) -> CreateFilePreviewResult {
    let result = (|| {
        let media_file = resolve_authorized_openclaw_media_file(&path)?;
        registry.create_exact_preview_url_for_file(&media_file)
    })();

    match result {
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

fn resolve_authorized_openclaw_media_file(raw_path: &str) -> Result<PathBuf, String> {
    let state_dirs = paths::media_state_dirs_for_preview()
        .map_err(|_| "The active OpenClaw storage location is unavailable".to_string())?;
    resolve_openclaw_media_file_under_state_dirs(raw_path, &state_dirs)
}

fn resolve_openclaw_media_file_under_state_dirs(
    raw_path: &str,
    state_dirs: &[PathBuf],
) -> Result<PathBuf, String> {
    for state_dir in state_dirs {
        if let Ok(file) = resolve_openclaw_media_file_under_root(
            raw_path,
            &state_dir.join(OPENCLAW_MEDIA_DIRECTORY),
        ) {
            return Ok(file);
        }
    }
    Err("The media file is outside the managed OpenClaw media directories".to_string())
}

fn resolve_openclaw_media_file_under_root(
    raw_path: &str,
    media_root: &Path,
) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err("The OpenClaw media path is empty".to_string());
    }

    let requested = PathBuf::from(trimmed);
    if !requested.is_absolute() {
        return Err("The OpenClaw media path must be absolute".to_string());
    }

    let root = media_root
        .canonicalize()
        .map_err(|_| "The active OpenClaw media directory is unavailable".to_string())?;
    if !root.is_dir() {
        return Err("The active OpenClaw media directory is unavailable".to_string());
    }

    let file = requested
        .canonicalize()
        .map_err(|_| "The OpenClaw media file is no longer available".to_string())?;
    if !file.is_file() {
        return Err("The OpenClaw media path is not a file".to_string());
    }
    if !file.starts_with(&root) {
        return Err("The media file is outside the active OpenClaw media directory".to_string());
    }

    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_media_root() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("junqi-openclaw-media-{unique}"));
        fs::create_dir_all(root.join("media").join("inbound")).expect("create media root");
        root
    }

    #[test]
    fn accepts_only_files_inside_the_openclaw_media_tree() {
        let root = temp_media_root();
        let media_root = root.join("media");
        let image = media_root.join("inbound").join("screenshot.png");
        let outside = root.join("outside.png");
        fs::write(&image, b"image").expect("write media file");
        fs::write(&outside, b"outside").expect("write outside file");

        assert_eq!(
            resolve_openclaw_media_file_under_root(
                image.to_str().expect("utf8 image path"),
                &media_root,
            )
            .expect("accept media file"),
            image.canonicalize().expect("canonical image"),
        );
        assert!(resolve_openclaw_media_file_under_root(
            outside.to_str().expect("utf8 outside path"),
            &media_root,
        )
        .is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_relative_media_paths() {
        let root = temp_media_root();
        assert!(resolve_openclaw_media_file_under_root(
            "inbound/screenshot.png",
            &root.join("media")
        )
        .is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn accepts_an_explicitly_authorized_migrated_state_root() {
        let root = temp_media_root();
        let active_state = root.join("active-state");
        let historical_state = root.join("historical-state");
        let image = historical_state
            .join("media")
            .join("inbound")
            .join("screenshot.png");
        fs::create_dir_all(image.parent().expect("media parent")).expect("create historical media");
        fs::write(&image, b"image").expect("write historical media");

        let state_dirs = vec![active_state, historical_state];
        assert_eq!(
            resolve_openclaw_media_file_under_state_dirs(
                image.to_str().expect("utf8 image path"),
                &state_dirs,
            )
            .expect("accept migrated media"),
            image.canonicalize().expect("canonical image"),
        );

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_media_symlink_that_escapes_the_state_directory() {
        use std::os::unix::fs::symlink;

        let root = temp_media_root();
        let media_root = root.join("media");
        let outside = root.join("outside.png");
        let linked = media_root.join("inbound").join("linked.png");
        fs::write(&outside, b"outside").expect("write outside file");
        symlink(&outside, &linked).expect("link outside file");

        assert!(resolve_openclaw_media_file_under_root(
            linked.to_str().expect("utf8 linked path"),
            &media_root,
        )
        .is_err());

        let _ = fs::remove_dir_all(root);
    }
}
