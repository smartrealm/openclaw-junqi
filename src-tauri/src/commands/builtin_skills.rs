use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::paths;

const HATCH_PET_ID: &str = "hatch-pet";
const HATCH_PET_VERSION: u32 = 1;
const VERSION_FILE: &str = ".junqi-skill-version";
const HATCH_PET_REQUIRED_FILES: &[&str] = &[
    "LICENSE.txt",
    "SKILL.md",
    "agents/junqi.yaml",
    "references/animation-rows.md",
    "references/junqi-pet-contract.md",
    "references/qa-rubric.md",
    "scripts/assemble_extended_atlas.py",
    "scripts/combine_direction_blind_verdicts.py",
    "scripts/compose_atlas.py",
    "scripts/compose_cardinal_anchor_strip.py",
    "scripts/derive_running_left_from_running_right.py",
    "scripts/despill_chroma_edges.py",
    "scripts/extract_cardinal_anchors.py",
    "scripts/extract_strip_frames.py",
    "scripts/inspect_frames.py",
    "scripts/make_contact_sheet.py",
    "scripts/make_direction_blind_qa_sheet.py",
    "scripts/make_direction_qa_sheet.py",
    "scripts/measure_direction_continuity.py",
    "scripts/prepare_pet_run.py",
    "scripts/render_animation_previews.py",
    "scripts/validate_atlas.py",
    "scripts/validate_direction_blind_verdicts.py",
];

static MATERIALIZE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinSkill {
    id: &'static str,
    display_name: &'static str,
    description: &'static str,
    version: u32,
    root_path: String,
    skill_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSkillInstallation {
    skill_name: &'static str,
    workspace_path: String,
    skill_path: String,
}

struct BuiltinSkillSpec {
    id: &'static str,
    display_name: &'static str,
    description: &'static str,
    version: u32,
}

impl BuiltinSkillSpec {
    fn hatch_pet() -> Self {
        Self {
            id: HATCH_PET_ID,
            display_name: "Hatch Pet",
            description: "Create and validate JunQi-compatible animated pets",
            version: HATCH_PET_VERSION,
        }
    }
}

#[tauri::command]
pub fn prepare_builtin_skill(app: AppHandle, skill_id: String) -> Result<BuiltinSkill, String> {
    let spec = match skill_id.as_str() {
        HATCH_PET_ID => BuiltinSkillSpec::hatch_pet(),
        _ => return Err(format!("Unknown JunQi built-in skill: {skill_id}")),
    };

    let lock = MATERIALIZE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Built-in skill installer lock is poisoned".to_string())?;

    let root = materialize(&app, &spec)?;
    Ok(BuiltinSkill {
        id: spec.id,
        display_name: spec.display_name,
        description: spec.description,
        version: spec.version,
        skill_path: root.join("SKILL.md").to_string_lossy().into_owned(),
        root_path: root.to_string_lossy().into_owned(),
    })
}

/// Install a JunQi-owned skill into the active OpenClaw workspace so the
/// current chat model can discover it through the normal `@skill` flow.
/// This deliberately does not route through a provider-specific task runner.
#[tauri::command]
pub fn install_builtin_skill_for_chat(
    app: AppHandle,
    skill_id: String,
) -> Result<ChatSkillInstallation, String> {
    let spec = match skill_id.as_str() {
        HATCH_PET_ID => BuiltinSkillSpec::hatch_pet(),
        _ => return Err(format!("Unknown JunQi built-in skill: {skill_id}")),
    };

    let lock = MATERIALIZE_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Built-in skill installer lock is poisoned".to_string())?;

    let source = materialize(&app, &spec)?;
    let workspace = paths::read_workspace_from_config(&paths::active_config_path())
        .unwrap_or_else(paths::default_workspace_dir);
    let target = install_into_workspace(&source, &workspace, &spec)?;

    Ok(ChatSkillInstallation {
        skill_name: spec.id,
        workspace_path: workspace.to_string_lossy().into_owned(),
        skill_path: target.to_string_lossy().into_owned(),
    })
}

fn materialize(app: &AppHandle, spec: &BuiltinSkillSpec) -> Result<PathBuf, String> {
    let parent = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve JunQi data directory: {error}"))?
        .join("builtin-skills");
    let target = parent.join(spec.id);

    if installed_version(&target) == Some(spec.version) && validate_skill(&target).is_ok() {
        return Ok(target);
    }

    fs::create_dir_all(&parent)
        .map_err(|error| format!("Cannot create built-in skill directory: {error}"))?;
    let source = bundled_source(app, spec.id)?;
    validate_skill(&source)?;

    let operation_id = Uuid::new_v4();
    let staging = parent.join(format!(".{}-{operation_id}.staging", spec.id));
    let backup = parent.join(format!(".{}-{operation_id}.backup", spec.id));

    if let Err(error) = copy_directory(&source, &staging).and_then(|_| {
        fs::write(staging.join(VERSION_FILE), spec.version.to_string())
            .map_err(|error| format!("Cannot write built-in skill version: {error}"))?;
        validate_skill(&staging)
    }) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if target.exists() {
        fs::rename(&target, &backup)
            .map_err(|error| format!("Cannot stage the previous built-in skill: {error}"))?;
    }

    if let Err(error) = fs::rename(&staging, &target) {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Cannot activate the built-in skill: {error}"));
    }

    if backup.exists() {
        let _ = fs::remove_dir_all(backup);
    }
    Ok(target)
}

fn install_into_workspace(
    source: &Path,
    workspace: &Path,
    spec: &BuiltinSkillSpec,
) -> Result<PathBuf, String> {
    validate_skill(source)?;
    let skills_dir = workspace.join("skills");
    fs::create_dir_all(&skills_dir)
        .map_err(|error| format!("Cannot create workspace skills directory: {error}"))?;

    let target = skills_dir.join(spec.id);
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Refusing to replace symlinked workspace skill: {}",
                target.display()
            ));
        }
        if installed_version(&target).is_none() {
            return Err(format!(
                "Workspace skill conflicts with JunQi's built-in {}: {}",
                spec.id,
                target.display()
            ));
        }
    }

    let operation_id = Uuid::new_v4();
    let staging = skills_dir.join(format!(".{}-{operation_id}.staging", spec.id));
    let backup = skills_dir.join(format!(".{}-{operation_id}.backup", spec.id));

    if let Err(error) = copy_directory(source, &staging).and_then(|_| {
        fs::write(staging.join(VERSION_FILE), spec.version.to_string())
            .map_err(|error| format!("Cannot write workspace skill version: {error}"))?;
        validate_skill(&staging)
    }) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if target.exists() {
        fs::rename(&target, &backup)
            .map_err(|error| format!("Cannot stage the previous workspace skill: {error}"))?;
    }
    if let Err(error) = fs::rename(&staging, &target) {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Cannot activate workspace skill: {error}"));
    }
    if backup.exists() {
        let _ = fs::remove_dir_all(backup);
    }
    Ok(target)
}

fn bundled_source(app: &AppHandle, skill_id: &str) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Cannot resolve JunQi resources: {error}"))?
        .join("skills")
        .join(skill_id);
    if packaged.is_dir() {
        return Ok(packaged);
    }

    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("skills")
            .join(skill_id);
        if development.is_dir() {
            return Ok(development);
        }
    }

    Err(format!(
        "JunQi built-in skill resource is missing: {}",
        packaged.display()
    ))
}

fn installed_version(root: &Path) -> Option<u32> {
    fs::read_to_string(root.join(VERSION_FILE))
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn validate_skill(root: &Path) -> Result<(), String> {
    for relative in HATCH_PET_REQUIRED_FILES {
        let path = root.join(relative);
        if !path.is_file() {
            return Err(format!(
                "JunQi built-in hatch-pet resource is incomplete: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Cannot create built-in skill staging directory: {error}"))?;

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Cannot read built-in skill resource: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Cannot read resource entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect resource entry: {error}"))?;
        let output = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_directory(&entry.path(), &output)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), output)
                .map_err(|error| format!("Cannot copy built-in skill resource: {error}"))?;
        } else {
            return Err(format!(
                "Unsupported entry in built-in skill resource: {}",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_hatch_pet_resource_has_the_runtime_contract() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/skills/hatch-pet");
        validate_skill(&root).expect("bundled hatch-pet skill should be complete");
    }

    #[test]
    fn copied_skill_preserves_nested_files() {
        let base = std::env::temp_dir().join(format!("junqi-skill-test-{}", Uuid::new_v4()));
        let source = base.join("source");
        let destination = base.join("destination");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("nested/file.txt"), "junqi").unwrap();

        copy_directory(&source, &destination).unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("nested/file.txt")).unwrap(),
            "junqi"
        );
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn workspace_install_rejects_unowned_skill_conflicts() {
        let base =
            std::env::temp_dir().join(format!("junqi-workspace-skill-test-{}", Uuid::new_v4()));
        let source = base.join("source");
        let workspace = base.join("workspace");
        fs::create_dir_all(source.join("agents")).unwrap();
        fs::create_dir_all(source.join("references")).unwrap();
        fs::create_dir_all(source.join("scripts")).unwrap();
        for file in HATCH_PET_REQUIRED_FILES {
            let path = source.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "test").unwrap();
        }
        let target = workspace.join("skills").join(HATCH_PET_ID);
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("SKILL.md"), "third-party skill").unwrap();

        let error = install_into_workspace(&source, &workspace, &BuiltinSkillSpec::hatch_pet())
            .expect_err("an unowned skill must not be replaced");
        assert!(error.contains("conflicts"));
        let _ = fs::remove_dir_all(base);
    }
}
