//! Cross-platform counterpart to Kooky's top-chrome "Open in" picker.
//!
//! We intentionally launch only a fixed catalog of editor commands after a
//! PATH lookup. The frontend never supplies a program path, so choosing an
//! app cannot turn this command into a generic process launcher.

#[cfg(target_os = "macos")]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::path::Path;
#[cfg(any(target_os = "macos", windows))]
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "macos")]
use std::process::Stdio;
#[cfg(target_os = "macos")]
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy)]
struct TerminalOpenInSpec {
    id: &'static str,
    label: &'static str,
    binary: Option<&'static str>,
}

const OPEN_IN_APPS: &[TerminalOpenInSpec] = &[
    TerminalOpenInSpec {
        id: "vscode",
        label: "VS Code",
        binary: Some("code"),
    },
    TerminalOpenInSpec {
        id: "cursor",
        label: "Cursor",
        binary: Some("cursor"),
    },
    TerminalOpenInSpec {
        id: "windsurf",
        label: "Windsurf",
        binary: Some("windsurf"),
    },
    TerminalOpenInSpec {
        id: "zed",
        label: "Zed",
        binary: Some("zed"),
    },
    TerminalOpenInSpec {
        id: "sublime",
        label: "Sublime Text",
        binary: Some("subl"),
    },
    TerminalOpenInSpec {
        id: "antigravity",
        label: "Antigravity",
        binary: Some("antigravity"),
    },
    TerminalOpenInSpec {
        id: "trae",
        label: "Trae",
        binary: Some("trae"),
    },
    TerminalOpenInSpec {
        id: "kiro",
        label: "Kiro",
        binary: Some("kiro"),
    },
    TerminalOpenInSpec {
        id: "intellij",
        label: "IntelliJ IDEA",
        binary: Some("idea"),
    },
    TerminalOpenInSpec {
        id: "pycharm",
        label: "PyCharm",
        binary: Some("pycharm"),
    },
    TerminalOpenInSpec {
        id: "webstorm",
        label: "WebStorm",
        binary: Some("webstorm"),
    },
    TerminalOpenInSpec {
        id: "xcode",
        label: "Xcode",
        binary: None,
    },
    TerminalOpenInSpec {
        id: "terminal",
        label: "Terminal",
        binary: None,
    },
    TerminalOpenInSpec {
        id: "iterm",
        label: "iTerm",
        binary: None,
    },
    TerminalOpenInSpec {
        id: "ghostty",
        label: "Ghostty",
        binary: None,
    },
    TerminalOpenInSpec {
        id: "warp",
        label: "Warp",
        binary: None,
    },
    TerminalOpenInSpec {
        id: "finder",
        label: "File Manager",
        binary: None,
    },
];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOpenInApp {
    pub id: String,
    pub label: String,
    /// Real application artwork when the native platform can resolve it.
    /// The UI deliberately falls back to a generic glyph instead of claiming
    /// an unverified brand icon on platforms where extraction is unavailable.
    pub icon_data_url: Option<String>,
}

fn open_in_spec(id: &str) -> Option<TerminalOpenInSpec> {
    OPEN_IN_APPS.iter().copied().find(|app| app.id == id)
}

#[cfg(target_os = "macos")]
fn macos_bundle_names(id: &str) -> &'static [&'static str] {
    match id {
        "finder" => &["Finder.app"],
        "vscode" => &[
            "Visual Studio Code.app",
            "Visual Studio Code - Insiders.app",
        ],
        "cursor" => &["Cursor.app"],
        "windsurf" => &["Windsurf.app"],
        "zed" => &["Zed.app", "Zed Preview.app"],
        "sublime" => &["Sublime Text.app"],
        "antigravity" => &["Antigravity.app"],
        "trae" => &["Trae.app"],
        "kiro" => &["Kiro.app"],
        "intellij" => &["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"],
        "pycharm" => &["PyCharm.app", "PyCharm CE.app"],
        "webstorm" => &["WebStorm.app"],
        "xcode" => &["Xcode.app"],
        "terminal" => &["Terminal.app"],
        "iterm" => &["iTerm.app"],
        "ghostty" => &["Ghostty.app"],
        "warp" => &["Warp.app"],
        _ => &[],
    }
}

/// Kooky resolves by NSWorkspace bundle identifier. In Tauri we retain the
/// same installed-app behavior without an Objective-C bridge by checking the
/// standard macOS application roots, then hand the canonical app bundle to
/// `open -a` below.
#[cfg(target_os = "macos")]
fn macos_application_path(app: TerminalOpenInSpec) -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = crate::platform::home_dir() {
        roots.push(home.join("Applications"));
    }
    roots.extend([
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
        PathBuf::from("/System/Library/CoreServices"),
    ]);
    for root in roots {
        for bundle in macos_bundle_names(app.id) {
            let candidate = root.join(bundle);
            if candidate.is_dir() {
                return candidate.canonicalize().ok().or(Some(candidate));
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn macos_application_icon_path(application: &Path) -> Option<PathBuf> {
    let resources = application.join("Contents").join("Resources");
    let plist = application.join("Contents").join("Info.plist");
    let configured_name = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIconFile"])
        .arg(&plist)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|name| !name.is_empty());

    if let Some(name) = configured_name {
        let configured = resources.join(&name);
        if configured.is_file() {
            return Some(configured);
        }
        if configured.extension().is_none() {
            let with_extension = resources.join(format!("{name}.icns"));
            if with_extension.is_file() {
                return Some(with_extension);
            }
        }
    }

    for fallback in ["AppIcon.icns", "icon.icns", "Icon.icns"] {
        let candidate = resources.join(fallback);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let mut icons = std::fs::read_dir(resources)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("icns"))
        })
        .collect::<Vec<_>>();
    icons.sort();
    icons.into_iter().next()
}

#[cfg(target_os = "macos")]
fn macos_icon_cache() -> &'static Mutex<HashMap<PathBuf, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Kooky receives an `NSImage` from `NSWorkspace`. Tauri's Rust bridge has no
/// AppKit image wrapper, so downsample the real `.icns` to a small PNG once and
/// pass that exact local image to the WebView. This never uses bundled logos.
#[cfg(target_os = "macos")]
fn macos_application_icon_data_url(application: &Path, app_id: &str) -> Option<String> {
    if let Ok(cache) = macos_icon_cache().lock() {
        if let Some(icon) = cache.get(application) {
            return icon.clone();
        }
    }

    let icon = macos_application_icon_path(application)?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let output = std::env::temp_dir().join(format!(
        "junqi-open-in-{app_id}-{}-{nonce}.png",
        std::process::id()
    ));
    let converted = Command::new("/usr/bin/sips")
        .args(["-s", "format", "png", "-z", "64", "64"])
        .arg(icon)
        .arg("--out")
        .arg(&output)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success());
    let png = converted.then(|| std::fs::read(&output).ok()).flatten();
    let _ = std::fs::remove_file(&output);
    let data_url = png
        .filter(|png| !png.is_empty() && png.len() <= 512 * 1024)
        .map(|png| format!("data:image/png;base64,{}", BASE64_STANDARD.encode(png)));
    if let Ok(mut cache) = macos_icon_cache().lock() {
        cache.insert(application.to_path_buf(), data_url.clone());
    }
    data_url
}

#[cfg(windows)]
fn windows_executable_names(id: &str) -> &'static [&'static str] {
    match id {
        "vscode" => &["Code.exe", "Code - Insiders.exe"],
        "cursor" => &["Cursor.exe"],
        "windsurf" => &["Windsurf.exe"],
        "zed" => &["Zed.exe"],
        "sublime" => &["sublime_text.exe"],
        "antigravity" => &["Antigravity.exe"],
        "trae" => &["Trae.exe"],
        "kiro" => &["Kiro.exe"],
        "intellij" => &["idea64.exe", "idea.exe"],
        "pycharm" => &["pycharm64.exe", "pycharm.exe"],
        "webstorm" => &["webstorm64.exe", "webstorm.exe"],
        "terminal" => &["WindowsTerminal.exe", "wt.exe"],
        "ghostty" => &["ghostty.exe"],
        "warp" => &["Warp.exe"],
        _ => &[],
    }
}

/// Windows GUI installs commonly omit their command-line launcher from PATH.
/// App Paths is the OS-owned registry contract for resolving the executable a
/// user actually installed, and avoids a broad filesystem scan or accepting a
/// frontend-supplied executable path.
#[cfg(windows)]
fn windows_application_path(app: TerminalOpenInSpec) -> Option<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    for executable in windows_executable_names(app.id) {
        let key_path = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{executable}");
        for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            let Ok(key) = RegKey::predef(hive).open_subkey(&key_path) else {
                continue;
            };
            let Ok(value) = key.get_value::<String, _>("") else {
                continue;
            };
            let path = PathBuf::from(value.trim().trim_matches('"'));
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

fn open_in_app_is_installed(app: &TerminalOpenInSpec) -> bool {
    if app.id == "finder" {
        return true;
    }
    #[cfg(target_os = "macos")]
    if macos_application_path(*app).is_some() {
        return true;
    }
    #[cfg(windows)]
    if windows_application_path(*app).is_some() {
        return true;
    }
    app.binary
        .is_some_and(|binary| !crate::platform::detect_path(binary).is_empty())
}

fn installed_open_in_apps() -> Vec<TerminalOpenInApp> {
    OPEN_IN_APPS
        .iter()
        .filter(|app| open_in_app_is_installed(app))
        .map(|app| TerminalOpenInApp {
            id: app.id.to_string(),
            label: {
                #[cfg(target_os = "macos")]
                if app.id == "finder" {
                    "Finder".to_string()
                } else {
                    app.label.to_string()
                }
                #[cfg(not(target_os = "macos"))]
                {
                    app.label.to_string()
                }
            },
            icon_data_url: {
                #[cfg(target_os = "macos")]
                {
                    macos_application_path(*app)
                        .and_then(|path| macos_application_icon_data_url(&path, app.id))
                }
                #[cfg(not(target_os = "macos"))]
                {
                    None
                }
            },
        })
        .collect()
}

#[tauri::command]
pub async fn list_terminal_open_in_apps() -> Vec<TerminalOpenInApp> {
    tokio::task::spawn_blocking(installed_open_in_apps)
        .await
        .unwrap_or_else(|_| {
            vec![TerminalOpenInApp {
                id: "finder".to_string(),
                label: "File Manager".to_string(),
                icon_data_url: None,
            }]
        })
}

#[tauri::command]
pub async fn open_terminal_workspace_in_app(app_id: String, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let app = open_in_spec(app_id.trim())
            .ok_or_else(|| "unsupported Open In application".to_string())?;
        let directory =
            crate::commands::terminal_workspace::resolve_terminal_workspace_directory(path)?;
        #[cfg(target_os = "macos")]
        if let Some(application) = macos_application_path(app) {
            let mut command = Command::new("open");
            command.arg("-a").arg(application).arg(&directory);
            command
                .spawn()
                .map_err(|error| format!("open {}: {error}", app.label))?;
            return Ok(());
        }
        #[cfg(windows)]
        if let Some(application) = windows_application_path(app) {
            let mut command = Command::new(application);
            if app.id == "terminal" {
                command.arg("-d");
            }
            command.arg(&directory);
            crate::platform::suppress_console_window(&mut command);
            command
                .spawn()
                .map_err(|error| format!("open {}: {error}", app.label))?;
            return Ok(());
        }
        if let Some(binary) = app.binary {
            let program = crate::platform::detect_path(binary);
            if program.is_empty() {
                return Err(format!("{} is not installed", app.label));
            }
            let mut command = Command::new(program);
            command.arg(&directory);
            crate::platform::suppress_console_window(&mut command);
            command
                .spawn()
                .map_err(|error| format!("open {}: {error}", app.label))?;
        } else if app.id == "finder" {
            crate::platform::open_in_explorer(&directory)
                .map_err(|error| format!("open file manager: {error}"))?;
        } else {
            return Err(format!("{} is not installed", app.label));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("open workspace application task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{open_in_spec, OPEN_IN_APPS};

    #[test]
    fn open_in_catalog_has_a_safe_file_manager_fallback() {
        assert_eq!(OPEN_IN_APPS.last().map(|app| app.id), Some("finder"));
        assert!(open_in_spec("finder").is_some());
        assert!(open_in_spec("/bin/sh").is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_catalog_covers_kooky_editor_and_terminal_bundle_names() {
        use super::macos_bundle_names;

        assert!(macos_bundle_names("vscode").contains(&"Visual Studio Code.app"));
        assert!(macos_bundle_names("iterm").contains(&"iTerm.app"));
        assert!(macos_bundle_names("finder").contains(&"Finder.app"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_finder_uses_the_installed_bundle_icon() {
        use super::{macos_application_icon_data_url, macos_application_path, open_in_spec};

        let finder = open_in_spec("finder").expect("Finder is part of the fixed catalog");
        let application = macos_application_path(finder).expect("Finder is installed on macOS");
        let icon = macos_application_icon_data_url(&application, finder.id)
            .expect("Finder icon should convert to a PNG data URL");
        assert!(icon.starts_with("data:image/png;base64,"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_catalog_covers_common_registered_editor_and_terminal_names() {
        use super::windows_executable_names;

        assert!(windows_executable_names("vscode").contains(&"Code.exe"));
        assert!(windows_executable_names("terminal").contains(&"WindowsTerminal.exe"));
    }
}
