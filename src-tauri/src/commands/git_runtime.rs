use serde::Deserialize;

pub(crate) const GIT_FOR_WINDOWS_LATEST_RELEASE: &str =
    "https://api.github.com/repos/git-for-windows/git/releases/latest";

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct GitHubReleaseAsset {
    pub(crate) name: String,
    pub(crate) browser_download_url: String,
    pub(crate) digest: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct GitForWindowsRelease {
    pub(crate) tag_name: String,
    #[serde(default)]
    pub(crate) assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedGitArtifact {
    pub(crate) version: String,
    pub(crate) tag: String,
    pub(crate) filename: String,
    pub(crate) official_url: String,
    pub(crate) sha256: String,
}

impl ManagedGitArtifact {
    pub(crate) fn sources(&self) -> Vec<(String, &'static str)> {
        vec![
            (
                format!(
                    "https://registry.npmmirror.com/-/binary/git-for-windows/{}/{}",
                    self.tag, self.filename
                ),
                "npmmirror.com（国内）",
            ),
            (self.official_url.clone(), "GitHub（官方）"),
        ]
    }
}

pub(crate) fn select_managed_git_artifact(
    release: &GitForWindowsRelease,
    architecture: &str,
) -> Result<ManagedGitArtifact, String> {
    let suffix = match architecture {
        "x86_64" => "-64-bit.zip",
        "aarch64" => "-arm64.zip",
        other => {
            return Err(format!(
                "Unsupported Windows architecture for MinGit: {other}"
            ))
        }
    };
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name.starts_with("MinGit-") && asset.name.ends_with(suffix))
        .ok_or_else(|| {
            format!(
                "Git-for-Windows release {} has no MinGit asset for {architecture}",
                release.tag_name
            )
        })?;
    let sha256 = asset
        .digest
        .as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .filter(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| {
            format!(
                "Git-for-Windows asset {} does not publish a valid SHA-256 digest",
                asset.name
            )
        })?;

    Ok(ManagedGitArtifact {
        version: release.tag_name.trim_start_matches('v').to_string(),
        tag: release.tag_name.clone(),
        filename: asset.name.clone(),
        official_url: asset.browser_download_url.clone(),
        sha256: sha256.to_ascii_lowercase(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release() -> GitForWindowsRelease {
        GitForWindowsRelease {
            tag_name: "v2.55.0.windows.3".into(),
            assets: vec![
                GitHubReleaseAsset {
                    name: "MinGit-2.55.0.3-64-bit.zip".into(),
                    browser_download_url: "https://example.test/x64.zip".into(),
                    digest: Some(format!("sha256:{}", "a".repeat(64))),
                },
                GitHubReleaseAsset {
                    name: "MinGit-2.55.0.3-arm64.zip".into(),
                    browser_download_url: "https://example.test/arm64.zip".into(),
                    digest: Some(format!("sha256:{}", "b".repeat(64))),
                },
            ],
        }
    }

    #[test]
    fn selects_architecture_asset_and_builds_mirror_fallback_order() {
        let selected = select_managed_git_artifact(&release(), "aarch64").unwrap();
        assert_eq!(selected.version, "2.55.0.windows.3");
        assert!(selected.filename.ends_with("-arm64.zip"));
        let sources = selected.sources();
        assert!(sources[0].0.contains("registry.npmmirror.com"));
        assert_eq!(sources[1].0, "https://example.test/arm64.zip");
    }

    #[test]
    fn rejects_assets_without_publisher_digest() {
        let mut release = release();
        release.assets[0].digest = None;
        assert!(select_managed_git_artifact(&release, "x86_64")
            .unwrap_err()
            .contains("SHA-256"));
    }
}
