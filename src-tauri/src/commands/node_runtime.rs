use node_semver::{Range, Version};
use serde::Deserialize;

pub(crate) const FALLBACK_NODE_REQUIREMENT: &str = "*";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NodeRequirementSource {
    InstalledPackage,
    RegistryPackage,
    LegacyFallback,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct NodeDistributionRelease {
    pub(crate) version: String,
    #[serde(default, deserialize_with = "deserialize_lts")]
    pub(crate) lts: bool,
    #[serde(default)]
    pub(crate) files: Vec<String>,
}

fn deserialize_lts<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(matches!(value, serde_json::Value::String(ref name) if !name.trim().is_empty()))
}

pub(crate) fn current_platform_artifact() -> String {
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    if cfg!(windows) {
        format!("win-{arch}-zip")
    } else if cfg!(target_os = "macos") {
        format!("osx-{arch}-tar")
    } else {
        format!("linux-{arch}")
    }
}

pub(crate) fn select_preferred_release(
    requirement: &NodeRuntimeRequirement,
    releases: &[NodeDistributionRelease],
    artifact: &str,
) -> Option<String> {
    let mut compatible = releases
        .iter()
        .filter(|release| {
            requirement.supports(&release.version)
                && release.files.iter().any(|file| file == artifact)
        })
        .filter_map(|release| {
            Version::parse(release.version.trim_start_matches('v'))
                .ok()
                .map(|version| (release, version))
        })
        .collect::<Vec<_>>();
    compatible.sort_by(|left, right| right.1.cmp(&left.1));
    compatible
        .iter()
        .find(|(release, _)| release.lts)
        .or_else(|| compatible.first())
        .map(|(release, _)| release.version.trim_start_matches('v').to_string())
}

impl NodeRequirementSource {
    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::InstalledPackage => "installed",
            Self::RegistryPackage => "target",
            Self::LegacyFallback => "fallback",
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::InstalledPackage => "installed OpenClaw package",
            Self::RegistryPackage => "target OpenClaw package",
            Self::LegacyFallback => "JunQi legacy compatibility fallback",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NodeRuntimeRequirement {
    expression: String,
    source: NodeRequirementSource,
}

impl NodeRuntimeRequirement {
    pub(crate) fn parse(
        expression: impl Into<String>,
        source: NodeRequirementSource,
    ) -> Result<Self, String> {
        let expression = expression.into();
        let normalized = expression.trim();
        if normalized.is_empty() {
            return Err("OpenClaw returned an empty Node.js requirement".to_string());
        }
        Range::parse(normalized).map_err(|error| {
            format!("Invalid OpenClaw Node.js requirement {normalized:?}: {error}")
        })?;
        Ok(Self {
            expression: normalized.to_string(),
            source,
        })
    }

    pub(crate) fn fallback() -> Self {
        Self::parse(
            FALLBACK_NODE_REQUIREMENT,
            NodeRequirementSource::LegacyFallback,
        )
        .expect("the built-in Node.js fallback requirement must be valid")
    }

    pub(crate) fn expression(&self) -> &str {
        &self.expression
    }

    pub(crate) fn source(&self) -> NodeRequirementSource {
        self.source
    }

    pub(crate) fn supports(&self, version: &str) -> bool {
        let normalized = version.trim().trim_start_matches('v');
        let Ok(version) = Version::parse(normalized) else {
            return false;
        };
        Range::parse(&self.expression)
            .map(|range| range.satisfies(&version))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npm_semver_ranges_are_not_reimplemented_by_junqi() {
        let requirement = NodeRuntimeRequirement::parse(
            ">=22.22.3 <23 || ^24.15.0 || 25.x",
            NodeRequirementSource::InstalledPackage,
        )
        .unwrap();
        assert!(!requirement.supports("v22.22.2"));
        assert!(requirement.supports("v22.22.3"));
        assert!(requirement.supports("v24.18.1"));
        assert!(requirement.supports("v25.9.0"));
        assert!(!requirement.supports("v26.0.0"));
    }

    #[test]
    fn release_selection_prefers_latest_compatible_lts_with_artifact() {
        let requirement = NodeRuntimeRequirement::parse(
            ">=24.15.0 <25 || >=25.9.0 <26",
            NodeRequirementSource::RegistryPackage,
        )
        .unwrap();
        let releases = vec![
            NodeDistributionRelease {
                version: "v25.10.0".into(),
                lts: false,
                files: vec!["win-x64-zip".into()],
            },
            NodeDistributionRelease {
                version: "v24.18.1".into(),
                lts: true,
                files: vec!["win-x64-zip".into()],
            },
        ];
        assert_eq!(
            select_preferred_release(&requirement, &releases, "win-x64-zip").as_deref(),
            Some("24.18.1")
        );
    }
}
