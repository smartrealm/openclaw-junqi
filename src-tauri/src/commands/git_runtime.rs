use serde::Deserialize;
use std::collections::HashMap;

/// A Git for Windows archive whose contents are checked before activation.
///
/// Version and publisher digest are reviewed when JunQi is released. End-user
/// installation prefers domestic mirrors and falls back to the official Git
/// for Windows release for networks where those mirrors are unavailable.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct ManagedGitArtifact {
    pub(crate) version: String,
    pub(crate) tag: String,
    pub(crate) filename: String,
    pub(crate) sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    git_for_windows: HashMap<String, ManagedGitArtifact>,
    #[serde(default)]
    git_for_windows_installer: HashMap<String, GitForWindowsInstallerArtifact>,
}

/// The vendor installer used for the system-default Git location. It is
/// distinct from MinGit, which stays available for an explicitly selected
/// portable runtime directory.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(crate) struct GitForWindowsInstallerArtifact {
    pub(crate) version: String,
    pub(crate) tag: String,
    pub(crate) filename: String,
    pub(crate) sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GitDistributionSource {
    base_url: &'static str,
    log_label: &'static str,
    display_name: &'static str,
}

const GIT_DISTRIBUTION_SOURCES: &[GitDistributionSource] = &[
    GitDistributionSource {
        base_url: "https://registry.npmmirror.com/-/binary/git-for-windows",
        log_label: "npmmirror.com（国内）",
        display_name: "npmmirror.com",
    },
    GitDistributionSource {
        base_url: "https://mirrors.huaweicloud.com/git-for-windows",
        log_label: "华为云镜像（国内）",
        display_name: "华为云",
    },
    GitDistributionSource {
        base_url: "https://github.com/git-for-windows/git/releases/download",
        log_label: "Git for Windows（官方）",
        display_name: "Git for Windows",
    },
];

impl ManagedGitArtifact {
    pub(crate) fn sources(&self) -> Vec<(String, &'static str)> {
        GIT_DISTRIBUTION_SOURCES
            .iter()
            .map(|source| {
                (
                    format!("{}/{}/{}", source.base_url, self.tag, self.filename),
                    source.log_label,
                )
            })
            .collect()
    }
}

impl GitForWindowsInstallerArtifact {
    pub(crate) fn sources(&self) -> Vec<(String, &'static str)> {
        GIT_DISTRIBUTION_SOURCES
            .iter()
            .map(|source| {
                (
                    format!("{}/{}/{}", source.base_url, self.tag, self.filename),
                    source.log_label,
                )
            })
            .collect()
    }
}

pub(crate) fn managed_git_download_order() -> Vec<String> {
    GIT_DISTRIBUTION_SOURCES
        .iter()
        .map(|source| source.display_name.to_string())
        .collect()
}

/// Returns the release-reviewed archive for the requested architecture.
pub(crate) fn verified_managed_git_artifact(
    architecture: &str,
) -> Result<ManagedGitArtifact, String> {
    let manifest: RuntimeManifest =
        serde_json::from_str(include_str!("../../resources/runtime-artifacts.json"))
            .map_err(|error| format!("Invalid managed runtime artifact manifest: {error}"))?;
    let artifact = manifest
        .git_for_windows
        .get(architecture)
        .cloned()
        .ok_or_else(|| format!("Unsupported Windows architecture for MinGit: {architecture}"))?;
    validate_artifact(architecture, &artifact)?;
    Ok(artifact)
}

pub(crate) fn verified_system_git_installer_artifact(
    architecture: &str,
) -> Result<GitForWindowsInstallerArtifact, String> {
    let manifest: RuntimeManifest =
        serde_json::from_str(include_str!("../../resources/runtime-artifacts.json"))
            .map_err(|error| format!("Invalid Git installer artifact manifest: {error}"))?;
    let artifact = manifest
        .git_for_windows_installer
        .get(architecture)
        .cloned()
        .ok_or_else(|| {
            format!(
                "Unsupported Windows architecture for the Git for Windows installer: {architecture}"
            )
        })?;
    validate_installer_artifact(architecture, &artifact)?;
    Ok(artifact)
}

fn validate_artifact(architecture: &str, artifact: &ManagedGitArtifact) -> Result<(), String> {
    let suffix = match architecture {
        "x86" => "-32-bit.zip",
        "x86_64" => "-64-bit.zip",
        "aarch64" => "-arm64.zip",
        other => {
            return Err(format!(
                "Unsupported Windows architecture for MinGit: {other}"
            ))
        }
    };
    if artifact.version.trim().is_empty()
        || artifact.tag != format!("v{}", artifact.version)
        || !artifact.filename.starts_with("MinGit-")
        || !artifact.filename.ends_with(suffix)
        || artifact.filename.contains(['/', '\\'])
        || artifact.sha256.len() != 64
        || !artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(format!(
            "Managed Git artifact manifest is invalid for {architecture}"
        ));
    }
    Ok(())
}

fn validate_installer_artifact(
    architecture: &str,
    artifact: &GitForWindowsInstallerArtifact,
) -> Result<(), String> {
    let suffix = match architecture {
        "x86_64" => "-64-bit.exe",
        "aarch64" => "-arm64.exe",
        other => {
            return Err(format!(
                "Unsupported Windows architecture for the Git for Windows installer: {other}"
            ))
        }
    };
    if artifact.version.trim().is_empty()
        || artifact.tag != format!("v{}", artifact.version)
        || !artifact.filename.starts_with("Git-")
        || !artifact.filename.ends_with(suffix)
        || artifact.filename.contains(['/', '\\'])
        || artifact.sha256.len() != 64
        || !artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(format!(
            "Git for Windows installer artifact manifest is invalid for {architecture}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_artifact_uses_domestic_mirrors_and_a_publisher_digest() {
        let artifact = verified_managed_git_artifact("aarch64").unwrap();
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sources()[0].0.contains("registry.npmmirror.com"));
        assert!(artifact.sources()[1].0.contains("mirrors.huaweicloud.com"));
        assert!(artifact.sources()[2]
            .0
            .contains("github.com/git-for-windows/git/releases/download"));
        assert_eq!(artifact.sources().len(), 3);
    }

    #[test]
    fn runtime_version_metadata_is_loaded_from_the_reviewed_manifest() {
        let source = include_str!("../../resources/runtime-artifacts.json");
        let manifest: RuntimeManifest = serde_json::from_str(source).unwrap();
        assert_eq!(manifest.git_for_windows.len(), 3);
        for (architecture, artifact) in manifest.git_for_windows {
            validate_artifact(&architecture, &artifact).unwrap();
        }
        assert_eq!(manifest.git_for_windows_installer.len(), 2);
        for (architecture, artifact) in manifest.git_for_windows_installer {
            validate_installer_artifact(&architecture, &artifact).unwrap();
        }
    }

    #[test]
    fn bug_rp_03_git_urls_and_ui_order_share_one_catalog() {
        let artifact = verified_managed_git_artifact("x86_64").unwrap();
        let sources = artifact.sources();
        let order = managed_git_download_order();
        assert_eq!(sources.len(), GIT_DISTRIBUTION_SOURCES.len());
        assert_eq!(sources.len(), order.len());
        assert!(sources[0].0.starts_with("https://registry.npmmirror.com/"));
        assert!(sources[1].0.starts_with("https://mirrors.huaweicloud.com/"));
        assert!(sources[2]
            .0
            .starts_with("https://github.com/git-for-windows/git/releases/download/"));
        assert_eq!(order.last().map(String::as_str), Some("Git for Windows"));
    }

    #[test]
    fn system_installer_uses_the_same_domestic_source_catalog() {
        let artifact = verified_system_git_installer_artifact("x86_64").unwrap();
        let sources = artifact.sources();
        assert!(artifact.filename.ends_with("-64-bit.exe"));
        assert_eq!(sources.len(), GIT_DISTRIBUTION_SOURCES.len());
        assert!(sources[0].0.starts_with("https://registry.npmmirror.com/"));
        assert!(sources[1].0.starts_with("https://mirrors.huaweicloud.com/"));
    }
}
