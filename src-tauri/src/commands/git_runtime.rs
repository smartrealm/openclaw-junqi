#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedGitArtifact {
    pub(crate) version: &'static str,
    pub(crate) tag: &'static str,
    pub(crate) filename: &'static str,
    pub(crate) sha256: &'static str,
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
            (
                format!(
                    "https://github.com/git-for-windows/git/releases/download/{}/{}",
                    self.tag, self.filename
                ),
                "GitHub（备用）",
            ),
        ]
    }
}

pub(crate) fn current_managed_git_artifact(
    architecture: &str,
) -> Result<ManagedGitArtifact, String> {
    match architecture {
        "x86_64" => Ok(ManagedGitArtifact {
            version: "2.55.0.windows.3",
            tag: "v2.55.0.windows.3",
            filename: "MinGit-2.55.0.3-64-bit.zip",
            sha256: "f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05",
        }),
        "aarch64" => Ok(ManagedGitArtifact {
            version: "2.55.0.windows.3",
            tag: "v2.55.0.windows.3",
            filename: "MinGit-2.55.0.3-arm64.zip",
            sha256: "f7748965d5068e81ad93ca1923650db6742d6e22332b1ae7567a841c59f6bde5",
        }),
        other => Err(format!(
            "Unsupported Windows architecture for MinGit: {other}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_artifact_uses_china_mirror_first_and_a_publisher_digest() {
        let artifact = current_managed_git_artifact("aarch64").unwrap();
        assert_eq!(artifact.sha256.len(), 64);
        assert!(artifact.sources()[0].0.contains("registry.npmmirror.com"));
        assert!(artifact.sources()[1].0.contains("github.com"));
    }
}
