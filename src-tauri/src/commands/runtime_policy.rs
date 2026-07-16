use crate::commands::node_runtime::ManagedNodePlatform;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ManagedRuntimeCapabilities {
    pub(crate) node: bool,
    pub(crate) git: bool,
}

impl ManagedRuntimeCapabilities {
    pub(crate) fn for_target(os: &str, architecture: &str) -> Self {
        let supported_architecture = matches!(architecture, "x86_64" | "aarch64");
        Self {
            node: ManagedNodePlatform::for_target(os, architecture).is_ok(),
            git: os == "windows" && supported_architecture,
        }
    }

    pub(crate) fn current() -> Self {
        Self::for_target(std::env::consts::OS, std::env::consts::ARCH)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bug_rp_05_platform_capabilities_have_one_policy() {
        assert_eq!(
            ManagedRuntimeCapabilities::for_target("windows", "x86_64"),
            ManagedRuntimeCapabilities {
                node: true,
                git: true
            }
        );
        assert_eq!(
            ManagedRuntimeCapabilities::for_target("macos", "aarch64"),
            ManagedRuntimeCapabilities {
                node: true,
                git: false
            }
        );
        assert_eq!(
            ManagedRuntimeCapabilities::for_target("linux", "x86_64"),
            ManagedRuntimeCapabilities {
                node: false,
                git: false
            }
        );
        assert_eq!(
            ManagedRuntimeCapabilities::for_target("windows", "riscv64"),
            ManagedRuntimeCapabilities {
                node: false,
                git: false
            }
        );
    }
}
