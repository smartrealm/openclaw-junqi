use node_semver::{Range, Version};
use serde::Deserialize;

pub(crate) const FALLBACK_NODE_REQUIREMENT: &str = "*";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NodeArchiveFormat {
    Zip,
    TarGz,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ManagedNodePlatform {
    distribution_os: &'static str,
    archive_os: &'static str,
    architecture: &'static str,
    pub(crate) archive_format: NodeArchiveFormat,
}

impl ManagedNodePlatform {
    pub(crate) fn for_target(os: &str, architecture: &str) -> Result<Self, String> {
        let architecture = match architecture {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            other => return Err(format!("Unsupported Node.js architecture: {other}")),
        };
        match os {
            "windows" => Ok(Self {
                distribution_os: "win",
                archive_os: "win",
                architecture,
                archive_format: NodeArchiveFormat::Zip,
            }),
            "macos" => Ok(Self {
                distribution_os: "osx",
                archive_os: "darwin",
                architecture,
                archive_format: NodeArchiveFormat::TarGz,
            }),
            other => Err(format!("Managed Node.js is not supported on {other}")),
        }
    }

    pub(crate) fn current() -> Result<Self, String> {
        Self::for_target(std::env::consts::OS, std::env::consts::ARCH)
    }

    pub(crate) fn distribution_artifact(self) -> String {
        let format = match self.archive_format {
            NodeArchiveFormat::Zip => "zip",
            NodeArchiveFormat::TarGz => "tar",
        };
        format!("{}-{}-{format}", self.distribution_os, self.architecture)
    }

    pub(crate) fn archive_filename(self, version: &str) -> String {
        let extension = match self.archive_format {
            NodeArchiveFormat::Zip => "zip",
            NodeArchiveFormat::TarGz => "tar.gz",
        };
        format!(
            "node-v{version}-{}-{}.{}",
            self.archive_os, self.architecture, extension
        )
    }

    /// Windows vendor installers use the same release catalog as portable
    /// archives but let the official MSI choose its standard installation
    /// location. Other platforms do not expose this artifact type.
    #[cfg(any(windows, test))]
    pub(crate) fn installer_distribution_artifact(self) -> Option<String> {
        (self.archive_format == NodeArchiveFormat::Zip)
            .then(|| format!("{}-{}-msi", self.distribution_os, self.architecture))
    }

    #[cfg(any(windows, test))]
    pub(crate) fn installer_filename(self, version: &str) -> Option<String> {
        (self.archive_format == NodeArchiveFormat::Zip).then(|| {
            format!(
                "node-v{version}-{}-{}.msi",
                self.archive_os, self.architecture
            )
        })
    }

    pub(crate) fn extracted_root(self, version: &str) -> Option<String> {
        (self.archive_format == NodeArchiveFormat::TarGz)
            .then(|| format!("node-v{version}-{}-{}", self.archive_os, self.architecture))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NodeDistributionSource {
    base_url: &'static str,
    log_label: &'static str,
    display_name: &'static str,
}

const NODE_DISTRIBUTION_SOURCES: &[NodeDistributionSource] = &[
    NodeDistributionSource {
        base_url: "https://npmmirror.com/mirrors/node",
        log_label: "npmmirror.com（国内）",
        display_name: "npmmirror.com",
    },
    NodeDistributionSource {
        base_url: "https://mirrors.aliyun.com/nodejs-release",
        log_label: "阿里云镜像（国内）",
        display_name: "阿里云",
    },
    NodeDistributionSource {
        base_url: "https://mirrors.cloud.tencent.com/nodejs-release",
        log_label: "腾讯云镜像（国内）",
        display_name: "腾讯云",
    },
    NodeDistributionSource {
        base_url: "https://mirrors.ustc.edu.cn/node",
        log_label: "中科大镜像（国内）",
        display_name: "中科大",
    },
    NodeDistributionSource {
        base_url: "https://mirror.nju.edu.cn/nodejs-release",
        log_label: "南京大学镜像（国内）",
        display_name: "南京大学",
    },
    NodeDistributionSource {
        base_url: "https://mirrors.huaweicloud.com/nodejs",
        log_label: "华为云镜像（国内）",
        display_name: "华为云",
    },
];
pub(crate) fn node_index_sources() -> Vec<String> {
    NODE_DISTRIBUTION_SOURCES
        .iter()
        .map(|source| format!("{}/index.json", source.base_url))
        .collect()
}

pub(crate) fn node_checksum_sources(version: &str) -> Vec<(String, &'static str)> {
    // The checksum resolver requires a matching digest from at least two
    // independent mirrors. This keeps installation available on mainland
    // networks without trusting the same endpoint that serves the archive.
    NODE_DISTRIBUTION_SOURCES
        .iter()
        .map(|source| {
            (
                format!("{}/v{version}/SHASUMS256.txt", source.base_url),
                source.log_label,
            )
        })
        .collect()
}

pub(crate) fn node_archive_sources(
    platform: ManagedNodePlatform,
    version: &str,
) -> Vec<(String, &'static str)> {
    let filename = platform.archive_filename(version);
    NODE_DISTRIBUTION_SOURCES
        .iter()
        .map(|source| {
            (
                format!("{}/v{version}/{filename}", source.base_url),
                source.log_label,
            )
        })
        .collect()
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn node_macos_installer_filename(version: &str) -> String {
    format!("node-v{version}.pkg")
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn node_macos_installer_sources(version: &str) -> Vec<(String, &'static str)> {
    let filename = node_macos_installer_filename(version);
    NODE_DISTRIBUTION_SOURCES
        .iter()
        .map(|source| {
            (
                format!("{}/v{version}/{filename}", source.base_url),
                source.log_label,
            )
        })
        .collect()
}

/// Domestic mirrors host the official Windows MSI alongside the portable ZIP.
/// The MSI is used only for the default system-runtime path, never for a
/// user-selected portable runtime directory.
#[cfg(any(windows, test))]
pub(crate) fn node_installer_sources(
    platform: ManagedNodePlatform,
    version: &str,
) -> Vec<(String, &'static str)> {
    let Some(filename) = platform.installer_filename(version) else {
        return Vec::new();
    };
    NODE_DISTRIBUTION_SOURCES
        .iter()
        .map(|source| {
            (
                format!("{}/v{version}/{filename}", source.base_url),
                source.log_label,
            )
        })
        .collect()
}

pub(crate) fn node_download_order() -> Vec<String> {
    NODE_DISTRIBUTION_SOURCES
        .iter()
        .map(|source| source.display_name.to_string())
        .collect()
}

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

    #[test]
    fn bug_rp_02_platform_model_owns_index_and_archive_names() {
        let windows = ManagedNodePlatform::for_target("windows", "x86_64").unwrap();
        assert_eq!(windows.distribution_artifact(), "win-x64-zip");
        assert_eq!(
            windows.installer_distribution_artifact().as_deref(),
            Some("win-x64-msi")
        );
        assert_eq!(
            windows.archive_filename("24.18.1"),
            "node-v24.18.1-win-x64.zip"
        );
        assert_eq!(
            windows.installer_filename("24.18.1").as_deref(),
            Some("node-v24.18.1-win-x64.msi")
        );
        assert_eq!(windows.extracted_root("24.18.1"), None);

        let macos = ManagedNodePlatform::for_target("macos", "aarch64").unwrap();
        assert_eq!(macos.distribution_artifact(), "osx-arm64-tar");
        assert_eq!(
            macos.archive_filename("24.18.1"),
            "node-v24.18.1-darwin-arm64.tar.gz"
        );
        assert_eq!(
            macos.extracted_root("24.18.1").as_deref(),
            Some("node-v24.18.1-darwin-arm64")
        );
        assert!(ManagedNodePlatform::for_target("linux", "x86_64").is_err());
        assert!(ManagedNodePlatform::for_target("macos", "riscv64").is_err());
    }

    #[test]
    fn bug_rp_03_node_urls_and_ui_order_share_one_catalog() {
        let platform = ManagedNodePlatform::for_target("windows", "x86_64").unwrap();
        let indexes = node_index_sources();
        let checksums = node_checksum_sources("24.18.1");
        let archives = node_archive_sources(platform, "24.18.1");
        let installers = node_installer_sources(platform, "24.18.1");
        let order = node_download_order();

        assert_eq!(indexes.len(), NODE_DISTRIBUTION_SOURCES.len());
        assert_eq!(indexes.len(), archives.len());
        assert_eq!(indexes.len(), installers.len());
        assert_eq!(indexes.len(), order.len());
        for (index, (archive, _)) in indexes.iter().zip(archives.iter()) {
            let base = index.strip_suffix("/index.json").unwrap();
            assert!(archive.starts_with(base));
        }
        assert!(indexes.iter().all(|url| !url.contains("nodejs.org")));
        assert_eq!(checksums.len(), NODE_DISTRIBUTION_SOURCES.len());
        assert!(checksums.iter().all(|(url, _)| {
            url.ends_with("/v24.18.1/SHASUMS256.txt") && !url.contains("nodejs.org")
        }));
        assert!(installers
            .iter()
            .all(|(url, _)| url.ends_with("node-v24.18.1-win-x64.msi")));
        assert!(node_macos_installer_sources("24.18.1")
            .iter()
            .all(|(url, _)| url.ends_with("node-v24.18.1.pkg")));
    }
}
