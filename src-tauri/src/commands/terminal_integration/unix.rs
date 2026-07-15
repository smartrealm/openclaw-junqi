use super::{EnvironmentBinding, TerminalIntegrationBackend, TerminalLauncherTarget};
use crate::{paths, platform};
use std::path::{Path, PathBuf};

const BLOCK_START: &str = "# >>> JunQi Desktop OpenClaw integration >>>";
const BLOCK_END: &str = "# <<< JunQi Desktop OpenClaw integration <<<";

pub(super) struct UnixBackend;

impl TerminalIntegrationBackend for UnixBackend {
    const LAUNCHER_FILENAME: &'static str = "openclaw";

    fn apply_environment(enabled: bool) -> Result<EnvironmentBinding, String> {
        if enabled {
            let profile = selected_profile()?;
            ProfileTransaction::new(vec![profile.clone()], true)?.commit()?;
            return Ok(EnvironmentBinding {
                profile_path: Some(profile),
            });
        }

        let profiles = known_profiles()?
            .into_iter()
            .filter(|path| path.exists())
            .collect();
        ProfileTransaction::new(profiles, false)?.commit()?;
        Ok(EnvironmentBinding::default())
    }

    fn detect_environment() -> EnvironmentBinding {
        EnvironmentBinding {
            profile_path: selected_profile().ok(),
        }
    }

    fn is_environment_configured(binding: &EnvironmentBinding) -> bool {
        binding
            .profile_path
            .as_deref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .is_some_and(|content| content.contains(BLOCK_START) && content.contains(BLOCK_END))
    }

    fn launcher_contents(target: TerminalLauncherTarget<'_>) -> String {
        match target {
            TerminalLauncherTarget::Docker => docker_launcher_contents(),
            TerminalLauncherTarget::Native(binary) => native_launcher_contents(binary),
        }
    }

    fn prepare_launcher(path: &Path) -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("Failed to make terminal launcher executable: {}", error))
    }
}

fn missing_binary_command() -> String {
    "printf '%s\n' 'OpenClaw is not installed yet. Finish setup in JunQi Desktop.' >&2\nexit 1"
        .into()
}

fn native_launcher_contents(binary: Option<&Path>) -> String {
    let state = shell_quote(&paths::desktop_dir());
    let config = shell_quote(&paths::config_path());
    let node_path = paths::configured_node_path()
        .and_then(|node| node.parent().map(Path::to_path_buf))
        .map(|path| format!("export PATH={}:\"$PATH\"\n", shell_quote(&path)))
        .unwrap_or_default();
    let command = binary.map_or_else(missing_binary_command, |path| {
        format!("exec {} \"$@\"", shell_quote(path))
    });
    format!(
        "#!/bin/sh\nexport OPENCLAW_STATE_DIR={}\nexport OPENCLAW_CONFIG_PATH={}\n{}{}\n",
        state, config, node_path, command
    )
}

fn docker_launcher_contents() -> String {
    let container = crate::commands::docker::OPENCLAW_CONTAINER_NAME;
    format!(
        "#!/bin/sh\nif ! command -v docker >/dev/null 2>&1; then\n  printf '%s\\n' 'Docker CLI is not available. Start Docker Desktop, then retry.' >&2\n  exit 1\nfi\nif [ -t 0 ] && [ -t 1 ]; then\n  exec docker exec -it {container} openclaw \"$@\"\nfi\nexec docker exec -i {container} openclaw \"$@\"\n"
    )
}

fn selected_profile() -> Result<PathBuf, String> {
    let home = platform::home_dir().ok_or("Could not determine the user home directory")?;
    let shell = std::env::var("SHELL").unwrap_or_default();
    let name = Path::new(&shell)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("sh");
    match name {
        "zsh" => Ok(home.join(".zprofile")),
        "bash" if home.join(".bash_profile").exists() => Ok(home.join(".bash_profile")),
        "bash" | "sh" | "dash" => Ok(home.join(".profile")),
        unsupported => Err(format!(
            "Automatic terminal integration does not support shell `{}`; keep integration disabled and configure PATH manually",
            unsupported
        )),
    }
}

fn known_profiles() -> Result<Vec<PathBuf>, String> {
    let home = platform::home_dir().ok_or("Could not determine the user home directory")?;
    Ok([".zprofile", ".bash_profile", ".profile"]
        .into_iter()
        .map(|name| home.join(name))
        .collect())
}

fn shell_quote(value: &Path) -> String {
    format!("'{}'", value.to_string_lossy().replace('\'', "'\\''"))
}

fn read_profile(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("Failed to read {}: {}", path.display(), error)),
    }
}

fn updated_profile_content(current: &str, enabled: bool) -> Result<String, String> {
    let mut next = remove_managed_block(current)?;
    if !enabled {
        return Ok(next);
    }
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(&format!(
        "{}\nexport PATH={}:\"$PATH\"\n{}\n",
        BLOCK_START,
        shell_quote(&paths::terminal_launcher_dir()),
        BLOCK_END,
    ));
    Ok(next)
}

fn remove_managed_block(content: &str) -> Result<String, String> {
    let mut output = String::with_capacity(content.len());
    let mut inside = false;
    for line in content.split_inclusive('\n') {
        let marker = line.trim_end_matches(['\r', '\n']).trim();
        match marker {
            BLOCK_START if inside => {
                return Err("Terminal integration profile contains a nested start marker".into())
            }
            BLOCK_START => inside = true,
            BLOCK_END if !inside => {
                return Err("Terminal integration profile contains an unmatched end marker".into())
            }
            BLOCK_END => inside = false,
            _ if !inside => output.push_str(line),
            _ => {}
        }
    }
    if inside {
        return Err("Terminal integration profile contains an unterminated managed block".into());
    }
    Ok(output)
}

struct ProfileUpdate {
    path: PathBuf,
    original: String,
    updated: String,
}

struct ProfileTransaction {
    updates: Vec<ProfileUpdate>,
}

impl ProfileTransaction {
    fn new(paths: Vec<PathBuf>, enabled: bool) -> Result<Self, String> {
        let updates = paths
            .into_iter()
            .map(|path| {
                let original = read_profile(&path)?;
                let updated = updated_profile_content(&original, enabled)?;
                Ok(ProfileUpdate {
                    path,
                    original,
                    updated,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Self { updates })
    }

    fn commit(self) -> Result<(), String> {
        let mut committed = Vec::new();
        for update in self
            .updates
            .iter()
            .filter(|item| item.original != item.updated)
        {
            if let Err(error) = write_profile(update) {
                rollback_profiles(&committed);
                return Err(error);
            }
            committed.push(update);
        }
        Ok(())
    }
}

fn write_profile(update: &ProfileUpdate) -> Result<(), String> {
    if let Some(parent) = update.path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create shell profile directory: {}", error))?;
    }
    paths::atomic_write_text(&update.path, &update.updated)
        .map_err(|error| format!("Failed to update {}: {}", update.path.display(), error))
}

fn rollback_profiles(committed: &[&ProfileUpdate]) {
    for update in committed.iter().rev() {
        let _ = paths::atomic_write_text(&update.path, &update.original);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_profile_block_is_replaced_without_touching_user_content() {
        let current = format!("export USER_VALUE=1\n{}\nold\n{}\n", BLOCK_START, BLOCK_END);
        assert_eq!(
            remove_managed_block(&current).unwrap(),
            "export USER_VALUE=1\n"
        );
    }

    #[test]
    fn malformed_profile_blocks_fail_closed() {
        let unterminated = format!("export USER_VALUE=1\n{}\nkeep-me\n", BLOCK_START);
        assert!(remove_managed_block(&unterminated).is_err());
        assert!(remove_managed_block(&format!("{}\n", BLOCK_END)).is_err());
        assert!(remove_managed_block(&format!(
            "{}\n{}\n{}\n",
            BLOCK_START, BLOCK_START, BLOCK_END
        ))
        .is_err());
    }

    #[test]
    fn all_profiles_are_validated_before_any_write() {
        let root = test_root("preflight");
        std::fs::create_dir_all(&root).unwrap();
        let valid = root.join("valid");
        let invalid = root.join("invalid");
        std::fs::write(&valid, format!("{}\nold\n{}\n", BLOCK_START, BLOCK_END)).unwrap();
        std::fs::write(&invalid, format!("{}\nbroken\n", BLOCK_START)).unwrap();

        assert!(ProfileTransaction::new(vec![valid.clone(), invalid], false).is_err());
        assert!(std::fs::read_to_string(valid).unwrap().contains("old"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn unreadable_text_profile_is_never_overwritten() {
        let root = test_root("encoding");
        std::fs::create_dir_all(&root).unwrap();
        let profile = root.join(".zprofile");
        let original = [0xff, 0xfe, b'\n'];
        std::fs::write(&profile, original).unwrap();

        assert!(ProfileTransaction::new(vec![profile.clone()], true).is_err());
        assert_eq!(std::fs::read(&profile).unwrap(), original);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn launcher_never_embeds_gateway_credentials() {
        let content = UnixBackend::launcher_contents(TerminalLauncherTarget::Native(None));
        assert!(content.contains("OPENCLAW_STATE_DIR"));
        assert!(content.contains("OPENCLAW_CONFIG_PATH"));
        assert!(!content.contains("GATEWAY_TOKEN"));
    }

    #[test]
    fn docker_launcher_delegates_without_embedding_credentials() {
        let content = UnixBackend::launcher_contents(TerminalLauncherTarget::Docker);
        assert!(content.contains("docker exec"));
        assert!(content.contains("maxauto-openclaw"));
        assert!(!content.contains("GATEWAY_TOKEN"));
    }

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "junqi-profile-{}-{}-{}",
            name,
            std::process::id(),
            uuid::Uuid::new_v4()
        ))
    }
}
