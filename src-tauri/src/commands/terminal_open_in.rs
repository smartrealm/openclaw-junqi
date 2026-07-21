//! Cross-platform counterpart to Kooky's top-chrome "Open in" picker.
//!
//! We intentionally launch only a fixed catalog of editor commands after a
//! PATH lookup. The frontend never supplies a program path, so choosing an
//! app cannot turn this command into a generic process launcher.

use serde::Serialize;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::process::Command;

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

fn open_in_app_is_installed(app: &TerminalOpenInSpec) -> bool {
    if app.id == "finder" {
        return true;
    }
    #[cfg(target_os = "macos")]
    if macos_application_path(*app).is_some() {
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
}
