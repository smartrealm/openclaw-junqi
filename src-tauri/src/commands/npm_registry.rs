use serde::Deserialize;
use std::time::{Duration, Instant};

const OFFICIAL_NPM_REGISTRY: NpmRegistry = NpmRegistry {
    kind: NpmRegistryKind::Official,
    url: "https://registry.npmjs.org",
};
const CHINA_NPM_REGISTRY: NpmRegistry = NpmRegistry {
    kind: NpmRegistryKind::ChinaMirror,
    url: "https://registry.npmmirror.com",
};
const REGISTRY_PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const OFFICIAL_SLOW_THRESHOLD: Duration = Duration::from_millis(350);
const MIRROR_MIN_ADVANTAGE: Duration = Duration::from_millis(150);

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
}

impl NpmRegistrySelection {
    pub fn candidates(self) -> Vec<NpmRegistry> {
        let mut candidates = vec![self.primary];
        if let Some(fallback) = self.fallback {
            candidates.push(fallback);
        }
        candidates
    }

    fn official_default() -> Self {
        Self {
            primary: OFFICIAL_NPM_REGISTRY,
            fallback: None,
            package_version: None,
        }
    }
}

#[derive(Debug)]
struct RegistryProbe {
    registry: NpmRegistry,
    latency: Duration,
    version: String,
}

#[derive(Debug, Deserialize)]
struct PackageMetadata {
    version: Option<String>,
    dist: Option<PackageDist>,
}

#[derive(Debug, Deserialize)]
struct PackageDist {
    tarball: Option<String>,
}

/// Select an npm registry from live package metadata instead of trying to infer
/// the user's location. The official registry stays the default. A China mirror
/// is selected only when it serves the same OpenClaw version and is materially
/// faster, or when the official registry cannot be reached.
pub async fn select_npm_registry() -> NpmRegistrySelection {
    let client = match reqwest::Client::builder()
        .connect_timeout(REGISTRY_PROBE_TIMEOUT)
        .timeout(REGISTRY_PROBE_TIMEOUT)
        .user_agent("JunQi Desktop npm registry probe")
        .build()
    {
        Ok(client) => client,
        Err(_) => return NpmRegistrySelection::official_default(),
    };

    let (official, mirror) = tokio::join!(
        probe_registry(&client, OFFICIAL_NPM_REGISTRY),
        probe_registry(&client, CHINA_NPM_REGISTRY),
    );
    select_from_probes(official, mirror)
}

async fn probe_registry(client: &reqwest::Client, registry: NpmRegistry) -> Option<RegistryProbe> {
    let started = Instant::now();
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
        latency: started.elapsed(),
        version,
    })
}

fn select_from_probes(
    official: Option<RegistryProbe>,
    mirror: Option<RegistryProbe>,
) -> NpmRegistrySelection {
    match (official, mirror) {
        (Some(official), Some(mirror))
            if official.version == mirror.version
                && should_prefer_china_mirror(official.latency, mirror.latency) =>
        {
            NpmRegistrySelection {
                primary: mirror.registry,
                fallback: Some(official.registry),
                package_version: Some(official.version),
            }
        }
        (Some(official), Some(mirror)) if official.version == mirror.version => {
            NpmRegistrySelection {
                primary: official.registry,
                fallback: Some(mirror.registry),
                package_version: Some(official.version),
            }
        }
        // A mirror that has not caught up must never become the source of truth.
        (Some(official), Some(_)) | (Some(official), None) => NpmRegistrySelection {
            primary: official.registry,
            fallback: None,
            package_version: Some(official.version),
        },
        (None, Some(mirror)) => NpmRegistrySelection {
            primary: mirror.registry,
            fallback: None,
            package_version: Some(mirror.version),
        },
        (None, None) => NpmRegistrySelection::official_default(),
    }
}

fn should_prefer_china_mirror(official_latency: Duration, mirror_latency: Duration) -> bool {
    official_latency >= OFFICIAL_SLOW_THRESHOLD
        && official_latency > mirror_latency.saturating_add(MIRROR_MIN_ADVANTAGE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(registry: NpmRegistry, latency_ms: u64, version: &str) -> RegistryProbe {
        RegistryProbe {
            registry,
            latency: Duration::from_millis(latency_ms),
            version: version.to_string(),
        }
    }

    #[test]
    fn keeps_the_official_registry_when_it_is_healthy() {
        let selection = select_from_probes(
            Some(probe(OFFICIAL_NPM_REGISTRY, 80, "2026.7.1")),
            Some(probe(CHINA_NPM_REGISTRY, 50, "2026.7.1")),
        );

        assert_eq!(selection.primary.kind, NpmRegistryKind::Official);
        assert_eq!(selection.fallback, Some(CHINA_NPM_REGISTRY));
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
    fn refuses_a_faster_but_stale_mirror() {
        let selection = select_from_probes(
            Some(probe(OFFICIAL_NPM_REGISTRY, 900, "2026.7.1")),
            Some(probe(CHINA_NPM_REGISTRY, 90, "2026.7.0")),
        );

        assert_eq!(selection.primary.kind, NpmRegistryKind::Official);
        assert_eq!(selection.fallback, None);
        assert_eq!(selection.package_version.as_deref(), Some("2026.7.1"));
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

        assert_eq!(selection.primary.kind, NpmRegistryKind::Official);
        assert_eq!(selection.fallback, None);
        assert_eq!(selection.package_version, None);
    }
}
