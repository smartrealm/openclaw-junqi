use serde::Deserialize;

#[cfg_attr(not(windows), allow(dead_code))]
const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/git-for-windows/git/releases/latest";
#[cfg_attr(not(windows), allow(dead_code))]
const RELEASE_METADATA_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const GITHUB_RELEASE_DOWNLOAD_PREFIX: &str =
    "https://github.com/git-for-windows/git/releases/download/";

/// A Git for Windows archive whose contents are checked before activation.
///
/// The normal path resolves this from the publisher's latest-release metadata.
/// The fixed artifact returned by [`verified_fallback_managed_git_artifact`] is
/// only used when that metadata cannot provide a verifiable archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedGitArtifact {
    pub(crate) version: String,
    pub(crate) tag: String,
    pub(crate) filename: String,
    pub(crate) sha256: String,
    github_download_url: String,
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
            (self.github_download_url.clone(), "GitHub（备用）"),
        ]
    }
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
}

/// Resolves the newest Git for Windows MinGit archive from publisher metadata.
///
/// We deliberately require GitHub's `sha256:` asset digest. A release that
/// cannot supply it is not safe to download dynamically, so callers can use
/// the independently verified fallback instead.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) async fn resolve_latest_managed_git_artifact(
    architecture: &str,
) -> Result<ManagedGitArtifact, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(RELEASE_METADATA_TIMEOUT)
        .timeout(RELEASE_METADATA_TIMEOUT)
        .user_agent("JunQi Desktop Git for Windows resolver")
        .build()
        .map_err(|error| format!("Failed to initialize Git release resolver: {error}"))?;
    let release = client
        .get(GITHUB_LATEST_RELEASE_URL)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("Failed to fetch Git for Windows release metadata: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Git for Windows release metadata request failed: {error}"))?
        .json::<GitHubRelease>()
        .await
        .map_err(|error| format!("Invalid Git for Windows release metadata: {error}"))?;
    managed_git_artifact_from_release(&release, architecture)
}

fn managed_git_artifact_from_release(
    release: &GitHubRelease,
    architecture: &str,
) -> Result<ManagedGitArtifact, String> {
    let suffix = match architecture {
        "x86_64" => "-64-bit.zip",
        "aarch64" => "-arm64.zip",
        other => {
            return Err(format!(
                "Unsupported Windows architecture for MinGit: {other}"
            ));
        }
    };
    let tag = release.tag_name.trim();
    if tag.is_empty() {
        return Err("Git for Windows release metadata did not include a tag".into());
    }

    let asset = release
        .assets
        .iter()
        .find(|asset| {
            let name = asset.name.trim();
            name.starts_with("MinGit-") && name.ends_with(suffix) && !name.contains("-busybox-")
        })
        .ok_or_else(|| {
            format!(
                "Git for Windows release {tag} does not provide a MinGit archive for {architecture}"
            )
        })?;
    let sha256 = parse_sha256_digest(asset.digest.as_deref()).ok_or_else(|| {
        format!(
            "Git for Windows release {tag} does not provide a valid SHA-256 for {}",
            asset.name
        )
    })?;
    let github_download_url = asset.browser_download_url.trim();
    if !github_download_url.starts_with(GITHUB_RELEASE_DOWNLOAD_PREFIX) {
        return Err(format!(
            "Git for Windows release {tag} returned an unexpected download URL for {}",
            asset.name
        ));
    }

    Ok(ManagedGitArtifact {
        version: tag.trim_start_matches('v').to_string(),
        tag: tag.to_string(),
        filename: asset.name.trim().to_string(),
        sha256,
        github_download_url: github_download_url.to_string(),
    })
}

fn parse_sha256_digest(raw: Option<&str>) -> Option<String> {
    let (algorithm, digest) = raw?.trim().split_once(':')?;
    (algorithm.eq_ignore_ascii_case("sha256")
        && digest.len() == 64
        && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
    .then(|| digest.to_ascii_lowercase())
}

/// A known-good archive used only if current publisher metadata is unavailable.
///
/// Keeping this fallback pinned and digest-verified lets a user with a blocked
/// GitHub API still use an explicitly selected portable Git directory without
/// weakening archive verification.
pub(crate) fn verified_fallback_managed_git_artifact(
    architecture: &str,
) -> Result<ManagedGitArtifact, String> {
    match architecture {
        "x86_64" => Ok(pinned_artifact(
            "2.55.0.windows.3",
            "v2.55.0.windows.3",
            "MinGit-2.55.0.3-64-bit.zip",
            "f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05",
        )),
        "aarch64" => Ok(pinned_artifact(
            "2.55.0.windows.3",
            "v2.55.0.windows.3",
            "MinGit-2.55.0.3-arm64.zip",
            "f7748965d5068e81ad93ca1923650db6742d6e22332b1ae7567a841c59f6bde5",
        )),
        other => Err(format!(
            "Unsupported Windows architecture for MinGit: {other}"
        )),
    }
}

fn pinned_artifact(version: &str, tag: &str, filename: &str, sha256: &str) -> ManagedGitArtifact {
    ManagedGitArtifact {
        version: version.to_string(),
        tag: tag.to_string(),
        filename: filename.to_string(),
        sha256: sha256.to_string(),
        github_download_url: format!(
            "https://github.com/git-for-windows/git/releases/download/{tag}/{filename}"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release_with_assets(assets: Vec<GitHubReleaseAsset>) -> GitHubRelease {
        GitHubRelease {
            tag_name: "v2.56.0.windows.1".into(),
            assets,
        }
    }

    fn asset(name: &str, digest: Option<&str>) -> GitHubReleaseAsset {
        GitHubReleaseAsset {
            name: name.into(),
            browser_download_url: format!(
                "https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.1/{name}"
            ),
            digest: digest.map(str::to_string),
        }
    }

    #[test]
    fn latest_release_uses_the_matching_non_busybox_mingit_archive() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let release = release_with_assets(vec![
            asset("MinGit-2.56.0.1-busybox-64-bit.zip", Some(&digest)),
            asset("MinGit-2.56.0.1-arm64.zip", Some(&digest)),
            asset("MinGit-2.56.0.1-64-bit.zip", Some(&digest)),
        ]);

        let artifact = managed_git_artifact_from_release(&release, "x86_64").unwrap();
        assert_eq!(artifact.version, "2.56.0.windows.1");
        assert_eq!(artifact.filename, "MinGit-2.56.0.1-64-bit.zip");
        assert_eq!(artifact.sha256, "a".repeat(64));
        assert!(artifact.sources()[0].0.contains("registry.npmmirror.com"));
        assert!(artifact.sources()[1].0.contains("github.com"));
    }

    #[test]
    fn latest_release_rejects_missing_or_invalid_publisher_digests() {
        let release = release_with_assets(vec![asset(
            "MinGit-2.56.0.1-64-bit.zip",
            Some("sha512:abcdef"),
        )]);
        let error = managed_git_artifact_from_release(&release, "x86_64").unwrap_err();
        assert!(error.contains("valid SHA-256"));
        assert_eq!(parse_sha256_digest(Some("sha256:abc")), None);
    }

    #[test]
    fn verified_fallback_uses_china_mirror_first_and_a_publisher_digest() {
        let artifact = verified_fallback_managed_git_artifact("aarch64").unwrap();
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sources()[0].0.contains("registry.npmmirror.com"));
        assert!(artifact.sources()[1].0.contains("github.com"));
    }
}
