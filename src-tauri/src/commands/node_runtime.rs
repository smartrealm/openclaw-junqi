use node_semver::{Range, Version};

pub(crate) const FALLBACK_NODE_REQUIREMENT: &str = "*";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NodeRequirementSource {
    InstalledPackage,
    RegistryPackage,
    LegacyFallback,
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
}
