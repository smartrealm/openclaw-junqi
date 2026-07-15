use serde::Deserialize;
use std::time::Duration;

const OFFICIAL_NPM_REGISTRY: NpmRegistry = NpmRegistry {
    kind: NpmRegistryKind::Official,
    url: "https://registry.npmjs.org",
};
const CHINA_NPM_REGISTRY: NpmRegistry = NpmRegistry {
    kind: NpmRegistryKind::ChinaMirror,
    url: "https://registry.npmmirror.com",
};
const REGISTRY_PROBE_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NpmRegistryKind {
    Official,
    ChinaMirror,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NpmRegistry {
    pub kind: NpmRegistryKind,
    pub url: &'static str,
}

impl NpmRegistry {
    pub fn label(self) -> &'static str {
        match self.kind {
            NpmRegistryKind::Official => "npmjs.org (official)",
            NpmRegistryKind::ChinaMirror => "npmmirror.com (China mirror)",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NpmRegistrySelection {
    pub primary: NpmRegistry,
    pub fallback: Option<NpmRegistry>,
    pub package_version: Option<String>,
    pub node_requirement: Option<String>,
}

impl NpmRegistrySelection {
    pub fn candidates(self) -> Vec<NpmRegistry> {
        let mut candidates = vec![self.primary];
        if let Some(fallback) = self.fallback {
            candidates.push(fallback);
        }
        candidates
    }

    fn china_default() -> Self {
        Self {
            primary: CHINA_NPM_REGISTRY,
            fallback: Some(OFFICIAL_NPM_REGISTRY),
            package_version: None,
            node_requirement: None,
        }
    }
}

#[derive(Debug)]
struct RegistryProbe {
    registry: NpmRegistry,
    version: String,
    node_requirement: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PackageMetadata {
    version: Option<String>,
    dist: Option<PackageDist>,
    engines: Option<PackageEngines>,
}

#[derive(Debug, Deserialize)]
struct PackageEngines {
    node: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PackageDist {
    tarball: Option<String>,
}

/// JunQi primarily serves mainland China, so the reachable China mirror is
/// authoritative for installation. npmjs.org remains a last-resort fallback.
pub async fn select_npm_registry() -> NpmRegistrySelection {
    let client = match reqwest::Client::builder()
        .connect_timeout(REGISTRY_PROBE_TIMEOUT)
        .timeout(REGISTRY_PROBE_TIMEOUT)
        .user_agent("JunQi Desktop npm registry probe")
        .build()
    {
        Ok(client) => client,
        Err(_) => return NpmRegistrySelection::china_default(),
    };

    if let Some(mirror) = probe_registry(&client, CHINA_NPM_REGISTRY).await {
        return select_from_probes(None, Some(mirror));
    }
    select_from_probes(probe_registry(&client, OFFICIAL_NPM_REGISTRY).await, None)
}

async fn probe_registry(client: &reqwest::Client, registry: NpmRegistry) -> Option<RegistryProbe> {
    let response = client
        .get(format!("{}/openclaw/latest", registry.url))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }

    let metadata = response.json::<PackageMetadata>().await.ok()?;
    let version = metadata.version.filter(|value| !value.trim().is_empty())?;
    let node_requirement = metadata
        .engines
        .and_then(|engines| engines.node)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let tarball = metadata
        .dist
        .and_then(|dist| dist.tarball)
        .filter(|value| !value.trim().is_empty())?;
    let Ok(tarball_url) = url::Url::parse(&tarball) else {
        return None;
    };
    if !matches!(tarball_url.scheme(), "https" | "http") {
        return None;
    }

    Some(RegistryProbe {
        registry,
        version,
        node_requirement,
    })
}

pub async fn fetch_openclaw_node_requirement(
    registry: NpmRegistry,
    version: &str,
) -> Result<Option<String>, String> {
    if version.is_empty()
        || version.len() > 64
        || !version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character))
    {
        return Err("Invalid OpenClaw package version".to_string());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(REGISTRY_PROBE_TIMEOUT)
        .timeout(REGISTRY_PROBE_TIMEOUT)
        .user_agent("JunQi Desktop OpenClaw metadata resolver")
        .build()
        .map_err(|error| format!("Failed to initialize npm metadata resolver: {error}"))?;
    let response = client
        .get(format!("{}/openclaw/{}", registry.url, version))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("Failed to read OpenClaw {version} metadata: {error}"))?
        .error_for_status()
        .map_err(|error| format!("OpenClaw {version} metadata request failed: {error}"))?;
    let metadata = response
        .json::<PackageMetadata>()
        .await
        .map_err(|error| format!("Invalid OpenClaw {version} metadata: {error}"))?;
    if metadata.version.as_deref() != Some(version) {
        return Err(format!(
            "OpenClaw metadata version mismatch: requested {version}, received {}",
            metadata.version.as_deref().unwrap_or("unknown")
        ));
    }
    Ok(metadata
        .engines
        .and_then(|engines| engines.node)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty()))
}

pub async fn resolve_openclaw_node_requirement(
    preferred: NpmRegistry,
    version: &str,
) -> Result<Option<String>, String> {
    if preferred.kind == NpmRegistryKind::Official {
        return fetch_openclaw_node_requirement(OFFICIAL_NPM_REGISTRY, version).await;
    }
    match fetch_openclaw_node_requirement(preferred, version).await {
        Ok(requirement) => Ok(requirement),
        Err(mirror_error) => {
            fetch_openclaw_node_requirement(OFFICIAL_NPM_REGISTRY, version)
                .await
                .map_err(|official_error| {
                    format!(
                        "Mirror and official OpenClaw metadata failed: {mirror_error}; {official_error}"
                    )
                })
        }
    }
}

fn select_from_probes(
    official: Option<RegistryProbe>,
    mirror: Option<RegistryProbe>,
) -> NpmRegistrySelection {
    match (official, mirror) {
        (Some(official), Some(mirror)) => NpmRegistrySelection {
            primary: mirror.registry,
            fallback: Some(official.registry),
            package_version: Some(mirror.version),
            node_requirement: mirror.node_requirement,
        },
        (Some(official), None) => NpmRegistrySelection {
            primary: official.registry,
            fallback: None,
            package_version: Some(official.version),
            node_requirement: official.node_requirement,
        },
        (None, Some(mirror)) => NpmRegistrySelection {
            primary: mirror.registry,
            fallback: None,
            package_version: Some(mirror.version),
            node_requirement: mirror.node_requirement,
        },
        (None, None) => NpmRegistrySelection::china_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(registry: NpmRegistry, _latency_ms: u64, version: &str) -> RegistryProbe {
        RegistryProbe {
            registry,
            version: version.to_string(),
            node_requirement: Some(">=24.15.0 <25".to_string()),
        }
    }

    #[test]
    fn keeps_the_china_registry_first_when_both_are_healthy() {
        let selection = select_from_probes(
            Some(probe(OFFICIAL_NPM_REGISTRY, 80, "2026.7.1")),
            Some(probe(CHINA_NPM_REGISTRY, 50, "2026.7.1")),
        );

        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
        assert_eq!(selection.package_version.as_deref(), Some("2026.7.1"));
    }

    #[test]
    fn chooses_the_china_mirror_when_the_matching_official_source_is_slow() {
        let selection = select_from_probes(
            Some(probe(OFFICIAL_NPM_REGISTRY, 900, "2026.7.1")),
            Some(probe(CHINA_NPM_REGISTRY, 90, "2026.7.1")),
        );

        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
        assert_eq!(selection.package_version.as_deref(), Some("2026.7.1"));
    }

    #[test]
    fn a_reachable_mirror_remains_usable_when_it_lags_official() {
        let selection = select_from_probes(
            Some(probe(OFFICIAL_NPM_REGISTRY, 900, "2026.7.1")),
            Some(probe(CHINA_NPM_REGISTRY, 90, "2026.7.0")),
        );

        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
        assert_eq!(selection.package_version.as_deref(), Some("2026.7.0"));
    }

    #[test]
    fn uses_the_mirror_when_the_official_registry_is_unavailable() {
        let selection = select_from_probes(None, Some(probe(CHINA_NPM_REGISTRY, 90, "2026.7.1")));

        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, None);
        assert_eq!(selection.package_version.as_deref(), Some("2026.7.1"));
    }

    #[test]
    fn unavailable_registries_fall_back_without_claiming_a_version() {
        let selection = select_from_probes(None, None);

        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
        assert_eq!(selection.package_version, None);
        assert_eq!(selection.node_requirement, None);
    }

    #[test]
    fn engine_metadata_comes_from_the_selected_china_mirror() {
        let official = probe(OFFICIAL_NPM_REGISTRY, 900, "2026.7.1");
        let mut mirror = probe(CHINA_NPM_REGISTRY, 50, "2026.7.1");
        mirror.node_requirement = Some(">=26".to_string());
        let selection = select_from_probes(Some(official), Some(mirror));
        assert_eq!(selection.primary.kind, NpmRegistryKind::ChinaMirror);
        assert_eq!(selection.fallback, Some(OFFICIAL_NPM_REGISTRY));
        assert_eq!(selection.node_requirement.as_deref(), Some(">=26"));
    }
}
