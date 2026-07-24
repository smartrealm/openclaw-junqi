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
            "x86" => "x86",
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
        // Unlike portable archives (`win-x64.zip`), official Node.js MSI
        // artifacts omit the operating-system segment (`x64.msi`). Keeping
        // this distinct from `archive_filename` is required for every mirror
        // and nodejs.org URL to resolve.
        (self.archive_format == NodeArchiveFormat::Zip)
            .then(|| format!("node-v{version}-{}.msi", self.architecture))
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
    checksum_authority: NodeChecksumAuthority,
}

impl NodeDistributionSource {
    fn index_url(self) -> String {
        format!("{}/index.json", self.base_url)
    }

    fn release_url(self, version: &str, filename: &str) -> String {
        format!("{}/v{version}/{filename}", self.base_url)
    }
}

/// Identifies the operator that publishes a checksum endpoint. The checksum
/// resolver requires agreement from two distinct authorities, so aliases of
/// the same endpoint cannot accidentally count as independent confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NodeChecksumAuthority {
    NpmMirror,
    Aliyun,
    Tencent,
    Ustc,
    Nju,
    HuaweiCloud,
    NodeJs,
}

/// A checksum endpoint and the trust role it plays in the release resolver.
/// Mainland authorities are corroboration sources; Node.js itself is the
/// authoritative single-source fallback for networks where mirrors are not
/// reachable at all.
#[derive(Debug, Clone)]
pub(crate) struct NodeChecksumSource {
    pub(crate) url: String,
    pub(crate) label: &'static str,
    pub(crate) is_official: bool,
}

/// The single source of truth for every Node.js release URL JunQi uses.
///
/// Mainland mirrors stay first for installation speed and accessibility. The
/// official Node.js distribution endpoint is deliberately last: it is a
/// network fallback, not a bypass for checksum verification.
#[derive(Debug, Clone, Copy)]
struct NodeDistributionCatalog {
    sources: &'static [NodeDistributionSource],
}

impl NodeDistributionCatalog {
    fn index_sources(self) -> Vec<String> {
        self.sources
            .iter()
            .map(|source| source.index_url())
            .collect()
    }

    fn checksum_sources(self, version: &str) -> Vec<NodeChecksumSource> {
        let mut authorities = Vec::with_capacity(self.sources.len());
        self.sources
            .iter()
            .filter(|source| {
                if authorities.contains(&source.checksum_authority) {
                    false
                } else {
                    authorities.push(source.checksum_authority);
                    true
                }
            })
            .map(|source| NodeChecksumSource {
                url: source.release_url(version, "SHASUMS256.txt"),
                label: source.log_label,
                is_official: source.checksum_authority == NodeChecksumAuthority::NodeJs,
            })
            .collect()
    }

    fn release_sources(self, version: &str, filename: &str) -> Vec<(String, &'static str)> {
        self.sources
            .iter()
            .map(|source| (source.release_url(version, filename), source.log_label))
            .collect()
    }

    fn download_order(self) -> Vec<String> {
        self.sources
            .iter()
            .map(|source| source.display_name.to_string())
            .collect()
    }
}

const NODE_DISTRIBUTION_CATALOG: NodeDistributionCatalog = NodeDistributionCatalog {
    sources: &[
        NodeDistributionSource {
            base_url: "https://npmmirror.com/mirrors/node",
            log_label: "npmmirror.com（国内）",
            display_name: "npmmirror.com",
            checksum_authority: NodeChecksumAuthority::NpmMirror,
        },
        NodeDistributionSource {
            base_url: "https://mirrors.aliyun.com/nodejs-release",
            log_label: "阿里云镜像（国内）",
            display_name: "阿里云",
            checksum_authority: NodeChecksumAuthority::Aliyun,
        },
        NodeDistributionSource {
            base_url: "https://mirrors.cloud.tencent.com/nodejs-release",
            log_label: "腾讯云镜像（国内）",
            display_name: "腾讯云",
            checksum_authority: NodeChecksumAuthority::Tencent,
        },
        NodeDistributionSource {
            base_url: "https://mirrors.ustc.edu.cn/node",
            log_label: "中科大镜像（国内）",
            display_name: "中科大",
            checksum_authority: NodeChecksumAuthority::Ustc,
        },
        NodeDistributionSource {
            base_url: "https://mirror.nju.edu.cn/nodejs-release",
            log_label: "南京大学镜像（国内）",
            display_name: "南京大学",
            checksum_authority: NodeChecksumAuthority::Nju,
        },
        NodeDistributionSource {
            base_url: "https://mirrors.huaweicloud.com/nodejs",
            log_label: "华为云镜像（国内）",
            display_name: "华为云",
            checksum_authority: NodeChecksumAuthority::HuaweiCloud,
        },
        NodeDistributionSource {
            base_url: "https://nodejs.org/dist",
            log_label: "nodejs.org（官方）",
            display_name: "nodejs.org",
            checksum_authority: NodeChecksumAuthority::NodeJs,
        },
    ],
};

pub(crate) fn node_index_sources() -> Vec<String> {
    NODE_DISTRIBUTION_CATALOG.index_sources()
}

pub(crate) fn node_checksum_sources(version: &str) -> Vec<NodeChecksumSource> {
    // The caller accepts a digest only after two independent catalog entries
    // agree. The official fallback therefore remains verified even when it
    // serves the downloaded artifact.
    NODE_DISTRIBUTION_CATALOG.checksum_sources(version)
}

pub(crate) fn node_archive_sources(
    platform: ManagedNodePlatform,
    version: &str,
) -> Vec<(String, &'static str)> {
    let filename = platform.archive_filename(version);
    NODE_DISTRIBUTION_CATALOG.release_sources(version, &filename)
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn node_macos_installer_filename(version: &str) -> String {
    format!("node-v{version}.pkg")
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn node_macos_installer_sources(version: &str) -> Vec<(String, &'static str)> {
    let filename = node_macos_installer_filename(version);
    NODE_DISTRIBUTION_CATALOG.release_sources(version, &filename)
}

/// The source catalog hosts the official Windows MSI alongside the portable
/// ZIP. The MSI is used only for the default system-runtime path, never for a
/// user-selected portable runtime directory.
#[cfg(any(windows, test))]
pub(crate) fn node_installer_sources(
    platform: ManagedNodePlatform,
    version: &str,
) -> Vec<(String, &'static str)> {
    let Some(filename) = platform.installer_filename(version) else {
        return Vec::new();
    };
    NODE_DISTRIBUTION_CATALOG.release_sources(version, &filename)
}

pub(crate) fn node_download_order() -> Vec<String> {
    NODE_DISTRIBUTION_CATALOG.download_order()
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
            Some("node-v24.18.1-x64.msi")
        );
        assert_eq!(windows.extracted_root("24.18.1"), None);

        let windows_x86 = ManagedNodePlatform::for_target("windows", "x86").unwrap();
        assert_eq!(windows_x86.distribution_artifact(), "win-x86-zip");
        assert_eq!(
            windows_x86.installer_distribution_artifact().as_deref(),
            Some("win-x86-msi")
        );
        assert_eq!(
            windows_x86.archive_filename("22.22.3"),
            "node-v22.22.3-win-x86.zip"
        );
        assert_eq!(
            windows_x86.installer_filename("22.22.3").as_deref(),
            Some("node-v22.22.3-x86.msi")
        );

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
    fn node_catalog_keeps_mainland_sources_first_and_the_official_fallback_last() {
        let platform = ManagedNodePlatform::for_target("windows", "x86_64").unwrap();
        let indexes = node_index_sources();
        let checksums = node_checksum_sources("24.18.1");
        let archives = node_archive_sources(platform, "24.18.1");
        let installers = node_installer_sources(platform, "24.18.1");
        let order = node_download_order();
        let catalog = NODE_DISTRIBUTION_CATALOG.sources;

        assert_eq!(indexes.len(), catalog.len());
        assert_eq!(indexes.len(), archives.len());
        assert_eq!(indexes.len(), installers.len());
        assert_eq!(indexes.len(), order.len());
        for (index, (archive, _)) in indexes.iter().zip(archives.iter()) {
            let base = index.strip_suffix("/index.json").unwrap();
            assert!(archive.starts_with(base));
        }
        assert!(indexes[..indexes.len() - 1]
            .iter()
            .all(|url| !url.contains("nodejs.org")));
        assert_eq!(
            indexes.last().map(String::as_str),
            Some("https://nodejs.org/dist/index.json")
        );
        assert_eq!(order.last().map(String::as_str), Some("nodejs.org"));

        // The checksum resolver receives every independent authority, including
        // the official endpoint, but no alias can inflate the two-source quorum.
        assert_eq!(checksums.len(), catalog.len());
        for (index, source) in catalog.iter().enumerate() {
            assert_eq!(checksums[index].label, source.log_label);
            assert!(checksums[index].url.ends_with("/v24.18.1/SHASUMS256.txt"));
            for other in catalog.iter().skip(index + 1) {
                assert_ne!(source.checksum_authority, other.checksum_authority);
            }
        }
        assert!(checksums
            .last()
            .unwrap()
            .url
            .starts_with("https://nodejs.org/dist/"));
        assert!(checksums.last().unwrap().is_official);
        assert!(installers
            .iter()
            .all(|(url, _)| url.ends_with("node-v24.18.1-x64.msi")));
        assert!(installers
            .last()
            .unwrap()
            .0
            .starts_with("https://nodejs.org/dist/"));
        assert!(node_macos_installer_sources("24.18.1")
            .iter()
            .all(|(url, _)| url.ends_with("node-v24.18.1.pkg")));
        assert!(node_macos_installer_sources("24.18.1")
            .last()
            .unwrap()
            .0
            .starts_with("https://nodejs.org/dist/"));
    }
}
