// ── Skill hub ────────────────────────────────────────────────────────────────
//
// Manages a directory of "skills" (folders with a `SKILL.md` frontmatter) and
// per-project installations (symlinks into the project's agent skills dir).
//
// JunQi stores hub configuration directly and treats project_id as the local
// project path, while retaining Nezha's validation, conflict, and symlink rules.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── Data types ───────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillHubConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hub_project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hub_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// SKILL 目录名（权威标识）
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallation {
    pub skill_name: String,
    pub project_id: String,
    pub agent: String,
    pub installed_at: i64,
    pub link_path: String,
    pub target_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<String>, // "ok" | "broken" | "diverged"
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub existing_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub existing_target: Option<String>,
    pub link_path: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<ConflictInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub already_installed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancelled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installation: Option<SkillInstallation>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub ok: bool,
    pub removed_links: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SetHubResult {
    pub config: SkillHubConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_new_project: Option<bool>,
    pub projects: Vec<Value>, // avoid coupling to Project struct
}

// ── Persistence paths ─────────────────────────────────────────────────────────

fn nezha_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    Ok(home.join(".nezha"))
}

fn hub_config_path() -> Result<PathBuf, String> {
    Ok(nezha_dir()?.join("skill-hub.json"))
}

fn installations_path() -> Result<PathBuf, String> {
    Ok(nezha_dir()?.join("skill-installations.json"))
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let uid = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{file_name}.{uid}.tmp"));
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── Hub config CRUD ──────────────────────────────────────────────────────────

fn load_hub_config() -> SkillHubConfig {
    let path = match hub_config_path() {
        Ok(p) => p,
        Err(_) => return SkillHubConfig::default(),
    };
    if !path.exists() {
        return SkillHubConfig::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_hub_config(cfg: &SkillHubConfig) -> Result<(), String> {
    let dir = nezha_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = hub_config_path()?;
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    atomic_write(&path, &raw)
}

#[tauri::command]
pub async fn get_skill_hub_config() -> Result<SkillHubConfig, String> {
    tokio::task::spawn_blocking(load_hub_config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_skill_hub_path(path: String) -> Result<SetHubResult, String> {
    tokio::task::spawn_blocking(move || {
        let trimmed = path.trim().to_string();
        if trimmed.is_empty() {
            return Err("Skill hub path is required".to_string());
        }
        if !Path::new(&trimmed).is_dir() {
            return Err(format!("Skill hub path is not a directory: {}", trimmed));
        }
        let cfg = SkillHubConfig {
            hub_path: Some(trimmed.clone()),
            hub_project_id: None,
            created_at: Some(now_ms()),
        };
        save_hub_config(&cfg)?;
        Ok(SetHubResult {
            config: cfg,
            created_new_project: Some(false),
            projects: Vec::new(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_skill_hub() -> Result<(), String> {
    tokio::task::spawn_blocking(|| save_hub_config(&SkillHubConfig::default()))
        .await
        .map_err(|e| e.to_string())?
}

// ── Skill scanning ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct InstallationsFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    installations: Vec<SkillInstallation>,
}

fn load_installations() -> InstallationsFile {
    let path = match installations_path() {
        Ok(p) => p,
        Err(_) => return InstallationsFile::default(),
    };
    if !path.exists() {
        return InstallationsFile::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_installations(file: &InstallationsFile) -> Result<(), String> {
    let dir = nezha_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = installations_path()?;
    let raw = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    atomic_write(&path, &raw)
}

/// Split frontmatter `name:` and `description:` from a SKILL.md head.
/// Tolerates both YAML literal (`|`) and folded (`>`) block scalars, plus
/// simple quoted/unquoted scalars. Returns `(name, description, has_error)`.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>, Option<String>) {
    let stripped = content.strip_prefix("---");
    let body = match stripped {
        Some(s) => s,
        None => {
            return (
                None,
                None,
                Some("Missing frontmatter delimiter".to_string()),
            )
        }
    };
    let end = body.find("\n---").or_else(|| body.find("\n..."));
    let head = match end {
        Some(idx) => &body[..idx],
        None => return (None, None, Some("Unterminated frontmatter".to_string())),
    };

    let mut name: Option<String> = None;
    let mut description: Option<String> = None;

    let lines: Vec<&str> = head.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            i += 1;
            continue;
        }
        let (key, rest) = match trimmed.split_once(':') {
            Some(kr) => kr,
            None => {
                i += 1;
                continue;
            }
        };
        let key = key.trim();
        let value = rest.trim();

        // Block scalar (literal `|` / folded `>`): consume subsequent indented lines.
        if value == "|"
            || value == "|-"
            || value == ">"
            || value == ">-"
            || value == "|+"
            || value == ">+"
        {
            let folded = value.starts_with('>');
            let tail: Vec<&str> = lines[i + 1..].to_vec();
            let (text, consumed) = parse_block_scalar(&tail, folded);
            match key {
                "name" => name = Some(text.trim().to_string()),
                "description" => description = Some(text.trim().to_string()),
                _ => {}
            }
            i += 1 + consumed;
            continue;
        }

        // Inline scalar (single-line).
        let cleaned = value.trim_matches('"').trim_matches('\'').to_string();
        match key {
            "name" => name = Some(cleaned),
            "description" => description = Some(cleaned),
            _ => {}
        }
        i += 1;
    }

    if name.is_none() {
        return (
            name,
            description,
            Some("Frontmatter missing `name` field".to_string()),
        );
    }
    (name, description, None)
}

fn parse_block_scalar(lines: &[&str], folded: bool) -> (String, usize) {
    let mut base_indent: Option<usize> = None;
    let mut consumed = 0usize;
    let mut collected: Vec<String> = Vec::new();
    for line in lines {
        if line.trim().is_empty() {
            collected.push(String::new());
            consumed += 1;
            continue;
        }
        let leading = line.chars().take_while(|c| *c == ' ').count();
        if leading == 0 {
            break;
        }
        let base = *base_indent.get_or_insert(leading);
        if leading < base {
            break;
        }
        collected.push(line[base..].to_string());
        consumed += 1;
    }
    while collected.last().map(|s| s.is_empty()).unwrap_or(false) {
        collected.pop();
    }
    let joined = if folded {
        fold_lines(&collected)
    } else {
        collected.join("\n")
    };
    (joined, consumed)
}

fn fold_lines(lines: &[String]) -> String {
    let mut out = String::new();
    let mut prev_blank = false;
    let mut first = true;
    for line in lines {
        if line.is_empty() {
            if first {
                first = false;
                prev_blank = true;
                continue;
            }
            out.push('\n');
            prev_blank = true;
            continue;
        }
        if !first && !prev_blank {
            out.push(' ');
        }
        out.push_str(line);
        first = false;
        prev_blank = false;
    }
    out
}

/// Scan a hub directory and return one `Skill` per subdirectory containing
/// a `SKILL.md`. Subdirectories without SKILL.md are skipped silently.
fn scan_skills_in(hub: &Path) -> Vec<Skill> {
    let mut out: Vec<Skill> = Vec::new();
    let entries = match fs::read_dir(hub) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let skill_md = path.join("SKILL.md");
        let (parsed_name, description, has_error) = if skill_md.is_file() {
            fs::read_to_string(&skill_md)
                .map(|c| parse_frontmatter(&c))
                .unwrap_or((None, None, Some("Cannot read SKILL.md".to_string())))
        } else {
            (None, None, Some("Missing SKILL.md".to_string()))
        };
        out.push(Skill {
            name: name.clone(),
            display_name: parsed_name,
            description,
            path: path.to_string_lossy().into_owned(),
            has_error,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub async fn list_skills() -> Result<Vec<Skill>, String> {
    tokio::task::spawn_blocking(|| {
        let cfg = load_hub_config();
        let Some(hub_path) = cfg.hub_path.as_deref() else {
            return Ok(Vec::new());
        };
        Ok(scan_skills_in(Path::new(hub_path)))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Installations ────────────────────────────────────────────────────────────

fn symlink_points_to(link: &Path, expected: &Path) -> bool {
    let Ok(target) = fs::read_link(link) else {
        return false;
    };
    let resolved = if target.is_absolute() {
        target
    } else {
        link.parent()
            .map(|parent| parent.join(&target))
            .unwrap_or(target)
    };
    resolved
        .canonicalize()
        .map(|actual| actual == expected)
        .unwrap_or(false)
}

fn health_for(link_path: &str, target_path: &str) -> String {
    let link = Path::new(link_path);
    match fs::symlink_metadata(link) {
        Err(_) => "broken".to_string(),
        Ok(meta) if !meta.file_type().is_symlink() => "diverged".to_string(),
        Ok(_) => match fs::canonicalize(target_path) {
            Err(_) => "broken".to_string(),
            Ok(expected) if symlink_points_to(link, &expected) => "ok".to_string(),
            Ok(_) => "diverged".to_string(),
        },
    }
}

#[tauri::command]
pub async fn list_skill_installations(
    skill_name: Option<String>,
) -> Result<Vec<SkillInstallation>, String> {
    tokio::task::spawn_blocking(move || {
        let file = load_installations();
        let mut out: Vec<SkillInstallation> = file
            .installations
            .into_iter()
            .filter(|ins| match &skill_name {
                Some(name) => ins.skill_name == *name,
                None => true,
            })
            .collect();
        for ins in &mut out {
            ins.health = Some(health_for(&ins.link_path, &ins.target_path));
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Validate the agent name and return the canonical skills directory for that
/// agent inside `project_path`.
fn agent_skills_dir(project_path: &str, agent: &str) -> Result<PathBuf, String> {
    if !Path::new(project_path).is_dir() {
        return Err(format!("Project path is not a directory: {}", project_path));
    }
    match agent {
        "claude" => Ok(Path::new(project_path).join(".claude").join("skills")),
        "codex" => Ok(Path::new(project_path).join(".codex").join("skills")),
        _ => Err(format!("Unknown agent: {}", agent)),
    }
}

fn validate_skill_name(skill_name: &str) -> Result<(), String> {
    if skill_name.is_empty() || skill_name == "." || skill_name == ".." {
        return Err(format!("Invalid skill name: {skill_name}"));
    }
    if skill_name.contains('/') || skill_name.contains('\\') || skill_name.contains('\0') {
        return Err(format!(
            "Skill name must not contain path separators: {skill_name}"
        ));
    }
    Ok(())
}

fn validate_skill_source(skill_name: &str, skill_path: &str) -> Result<PathBuf, String> {
    validate_skill_name(skill_name)?;
    let skill_dir = Path::new(skill_path);
    if !skill_dir.is_dir() {
        return Err(format!(
            "Skill '{skill_name}' not found at path: {skill_path}"
        ));
    }
    if !skill_dir.join("SKILL.md").is_file() {
        return Err(format!("Skill '{skill_name}' has no SKILL.md"));
    }
    if skill_dir.file_name().and_then(|name| name.to_str()) != Some(skill_name) {
        return Err(format!(
            "Skill path '{skill_path}' does not match skill name '{skill_name}'"
        ));
    }
    let hub_path = load_hub_config()
        .hub_path
        .ok_or_else(|| "Skill Hub is not configured".to_string())?;
    let hub_canonical = Path::new(&hub_path)
        .canonicalize()
        .map_err(|error| format!("Cannot resolve hub path '{hub_path}': {error}"))?;
    let skill_canonical = skill_dir
        .canonicalize()
        .map_err(|error| format!("Cannot resolve skill path '{skill_path}': {error}"))?;
    if !skill_canonical.starts_with(&hub_canonical) {
        return Err(format!(
            "Skill path '{skill_path}' is not inside hub '{hub_path}'"
        ));
    }
    Ok(skill_canonical)
}

#[cfg(unix)]
fn create_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn create_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

fn classify_existing(path: &Path) -> Option<(String, Option<String>)> {
    let meta = fs::symlink_metadata(path).ok()?;
    let kind = if meta.file_type().is_symlink() {
        "symlink"
    } else if meta.is_dir() {
        "directory"
    } else {
        "file"
    };
    let target = meta
        .file_type()
        .is_symlink()
        .then(|| fs::read_link(path).ok())
        .flatten()
        .map(|target| target.to_string_lossy().into_owned());
    Some((kind.to_string(), target))
}

fn remove_existing(path: &Path) -> Result<(), String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if meta.file_type().is_symlink() || meta.is_file() {
        fs::remove_file(path).map_err(|error| error.to_string())
    } else {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    }
}

fn upsert_installation(
    skill_name: &str,
    project_id: &str,
    agent: &str,
    link_path: &Path,
    target_path: &Path,
) -> Result<SkillInstallation, String> {
    let mut file = load_installations();
    if file.version == 0 {
        file.version = 1;
    }
    let installation = SkillInstallation {
        skill_name: skill_name.to_string(),
        project_id: project_id.to_string(),
        agent: agent.to_string(),
        installed_at: now_ms(),
        link_path: link_path.to_string_lossy().into_owned(),
        target_path: target_path.to_string_lossy().into_owned(),
        health: Some("ok".to_string()),
    };
    if let Some(existing) = file.installations.iter_mut().find(|item| {
        item.skill_name == skill_name && item.project_id == project_id && item.agent == agent
    }) {
        *existing = installation.clone();
    } else {
        file.installations.push(installation.clone());
    }
    save_installations(&file)?;
    Ok(installation)
}

#[tauri::command]
pub async fn install_skill(
    skill_name: String,
    skill_path: String,
    project_id: String,
    agent: String,
    strategy: String,
) -> Result<InstallResult, String> {
    tokio::task::spawn_blocking(move || -> Result<InstallResult, String> {
        if !matches!(
            strategy.as_str(),
            "detect" | "skip" | "overwrite" | "cancel"
        ) {
            return Err(format!("Unsupported strategy: {strategy}"));
        }
        if strategy == "cancel" {
            return Ok(InstallResult {
                ok: false,
                cancelled: Some(true),
                ..Default::default()
            });
        }

        let skill_canonical = validate_skill_source(&skill_name, &skill_path)?;
        let skills_dir = agent_skills_dir(&project_id, &agent)?;
        fs::create_dir_all(&skills_dir)
            .map_err(|error| format!("Failed to create {}: {error}", skills_dir.display()))?;
        let link_path = skills_dir.join(&skill_name);

        if strategy == "skip" {
            return Ok(InstallResult {
                ok: true,
                skipped: Some(true),
                ..Default::default()
            });
        }

        if let Some((kind, existing_target)) = classify_existing(&link_path) {
            if kind == "symlink" && symlink_points_to(&link_path, &skill_canonical) {
                let installation = upsert_installation(
                    &skill_name,
                    &project_id,
                    &agent,
                    &link_path,
                    &skill_canonical,
                )?;
                return Ok(InstallResult {
                    ok: true,
                    already_installed: Some(true),
                    installation: Some(installation),
                    ..Default::default()
                });
            }
            if strategy == "detect" {
                return Ok(InstallResult {
                    ok: false,
                    conflict: Some(ConflictInfo {
                        existing_kind: kind,
                        existing_target,
                        link_path: link_path.to_string_lossy().into_owned(),
                    }),
                    ..Default::default()
                });
            }
            remove_existing(&link_path)?;
        }

        create_symlink(&skill_canonical, &link_path).map_err(|error| {
            format!(
                "Failed to create symlink {} -> {}: {error}",
                link_path.display(),
                skill_canonical.display()
            )
        })?;
        let installation = upsert_installation(
            &skill_name,
            &project_id,
            &agent,
            &link_path,
            &skill_canonical,
        )?;
        Ok(InstallResult {
            ok: true,
            installation: Some(installation),
            ..Default::default()
        })
    })
    .await
    .map_err(|error| format!("install_skill join error: {error}"))?
}

#[tauri::command]
pub async fn uninstall_skill(
    skill_name: String,
    project_id: String,
    agent: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        validate_skill_name(&skill_name)?;
        let mut file = load_installations();
        let recorded_link = file
            .installations
            .iter()
            .find(|item| {
                item.skill_name == skill_name
                    && item.project_id == project_id
                    && item.agent == agent
            })
            .map(|item| PathBuf::from(&item.link_path));
        let link_path = match recorded_link {
            Some(path) => path,
            None => agent_skills_dir(&project_id, &agent)?.join(&skill_name),
        };
        if fs::symlink_metadata(&link_path)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(false)
        {
            fs::remove_file(&link_path).map_err(|error| error.to_string())?;
        }
        file.installations.retain(|item| {
            !(item.skill_name == skill_name && item.project_id == project_id && item.agent == agent)
        });
        save_installations(&file)
    })
    .await
    .map_err(|error| format!("uninstall_skill join error: {error}"))?
}

#[tauri::command]
pub async fn delete_skill(skill_name: String, skill_path: String) -> Result<DeleteResult, String> {
    tokio::task::spawn_blocking(move || -> Result<DeleteResult, String> {
        let skill_canonical = validate_skill_source(&skill_name, &skill_path)?;
        let mut file = load_installations();
        let targets: Vec<SkillInstallation> = file
            .installations
            .iter()
            .filter(|item| {
                item.skill_name == skill_name
                    && Path::new(&item.target_path)
                        .canonicalize()
                        .map(|target| target == skill_canonical)
                        .unwrap_or(false)
            })
            .cloned()
            .collect();

        let mut removed_links = 0;
        let mut seen = HashSet::new();
        for installation in &targets {
            let link_path = PathBuf::from(&installation.link_path);
            if seen.insert(link_path.clone())
                && symlink_points_to(&link_path, &skill_canonical)
                && fs::remove_file(&link_path).is_ok()
            {
                removed_links += 1;
            }
        }

        fs::remove_dir_all(&skill_canonical)
            .map_err(|error| format!("Failed to delete skill directory: {error}"))?;
        file.installations.retain(|item| {
            !targets.iter().any(|target| {
                target.skill_name == item.skill_name
                    && target.project_id == item.project_id
                    && target.agent == item.agent
            })
        });
        save_installations(&file)?;

        Ok(DeleteResult {
            ok: true,
            removed_links,
        })
    })
    .await
    .map_err(|error| format!("delete_skill join error: {error}"))?
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_frontmatter_inline_scalars() {
        let md = "---\nname: \"hello\"\ndescription: 'World tool'\n---\n# body";
        let (name, desc, err) = parse_frontmatter(md);
        assert_eq!(name.as_deref(), Some("hello"));
        assert_eq!(desc.as_deref(), Some("World tool"));
        assert!(err.is_none(), "unexpected error: {:?}", err);
    }

    #[test]
    fn parse_frontmatter_literal_block_scalar() {
        let md = "---\nname: |\n  multiline\n  name\ndescription: short\n---\n";
        let (name, desc, err) = parse_frontmatter(md);
        assert_eq!(name.as_deref(), Some("multiline\nname"));
        assert_eq!(desc.as_deref(), Some("short"));
        assert!(err.is_none());
    }

    #[test]
    fn parse_frontmatter_folded_block_scalar_joins_lines_with_spaces() {
        let md = "---\ndescription: >\n  folded\n  scalar\nname: x\n---\n";
        let (name, desc, err) = parse_frontmatter(md);
        assert_eq!(desc.as_deref(), Some("folded scalar"));
        assert_eq!(name.as_deref(), Some("x"));
        assert!(err.is_none());
    }

    #[test]
    fn parse_frontmatter_missing_delimiter_is_error() {
        let md = "name: hello\ndescription: world\n";
        let (_name, _desc, err) = parse_frontmatter(md);
        assert!(err.is_some());
    }

    #[test]
    fn parse_frontmatter_missing_name_field_is_error() {
        let md = "---\ndescription: nameless\n---\n";
        let (_name, _desc, err) = parse_frontmatter(md);
        assert!(err.is_some(), "expected missing-name error");
    }

    #[test]
    fn parse_frontmatter_empty_returns_empty_with_no_error() {
        let md = "---\nname: \"\"\ndescription: \"\"\n---\n";
        let (name, desc, err) = parse_frontmatter(md);
        assert_eq!(name.as_deref(), Some(""));
        assert_eq!(desc.as_deref(), Some(""));
        assert!(err.is_none());
    }

    #[test]
    fn parse_block_scalar_stops_at_top_level_key() {
        // Block scalar consumes only indented continuation lines.
        let lines = vec!["  continued line", "next_key: value"];
        let (text, consumed) = parse_block_scalar(&lines, false);
        assert_eq!(text, "continued line");
        assert_eq!(consumed, 1);
    }

    #[test]
    fn health_for_broken_when_symlink_missing() {
        let dir = std::env::temp_dir().join(format!(
            "junqi-skill-health-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let link = dir.join("missing.skill");
        let target = dir.join("never-existed");
        assert_eq!(
            health_for(&link.to_string_lossy(), &target.to_string_lossy()),
            "broken"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skill_names_cannot_escape_the_agent_skills_directory() {
        assert!(validate_skill_name("review-code").is_ok());
        assert!(validate_skill_name("../outside").is_err());
        assert!(validate_skill_name("nested/skill").is_err());
        assert!(validate_skill_name("nested\\skill").is_err());
    }

    #[test]
    fn skill_commands_keep_install_uninstall_and_delete_semantics_separate() {
        let source = include_str!("skills.rs");
        assert!(source.contains("Unsupported strategy"));
        assert!(source.contains("pub async fn uninstall_skill"));
        assert!(source.contains("remove_dir_all(&skill_canonical)"));
        let removed_policy = ["always ", "overwrites"].concat();
        assert!(!source.contains(&removed_policy));
    }
}
