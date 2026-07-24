use crate::commands::node_runtime::ManagedNodePlatform;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ManagedRuntimeCapabilities {
    /// A user-selected portable Node.js directory can be maintained by JunQi.
    pub(crate) node: bool,
    /// A user-selected portable Git directory can be maintained by JunQi.
    pub(crate) git: bool,
    /// JunQi can update system Node.js on Windows through vendor installers,
    /// with Windows Package Manager as a fallback.
    pub(crate) system_node_update: bool,
    /// JunQi can update system Git on Windows through vendor installers,
    /// with Windows Package Manager as a fallback.
    pub(crate) system_git_update: bool,
}

impl ManagedRuntimeCapabilities {
    pub(crate) fn for_target(os: &str, architecture: &str) -> Self {
        let supported_architecture = matches!(architecture, "x86" | "x86_64" | "aarch64");
        Self {
            node: ManagedNodePlatform::for_target(os, architecture).is_ok(),
            git: os == "windows" && supported_architecture,
            system_node_update: os == "windows" && supported_architecture,
            // Git for Windows 2.55 still publishes x86 MinGit, but no x86
            // full installer; keep x86 on the managed portable path.
            system_git_update: os == "windows" && matches!(architecture, "x86_64" | "aarch64"),
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
                git: true,
                system_node_update: true,
                system_git_update: true,
            }
        );
        assert_eq!(
            ManagedRuntimeCapabilities::for_target("windows", "x86"),
            ManagedRuntimeCapabilities {
                node: true,
                git: true,
                system_node_update: true,
                // Current Git for Windows publishes x86 MinGit but no x86
                // full installer. Portable Git remains the safe path.
                system_git_update: false,
            }
        );
        assert_eq!(
            ManagedRuntimeCapabilities::for_target("macos", "aarch64"),
            ManagedRuntimeCapabilities {
                node: true,
                git: false,
                system_node_update: false,
                system_git_update: false,
            }
        );
        assert_eq!(
            ManagedRuntimeCapabilities::for_target("linux", "x86_64"),
            ManagedRuntimeCapabilities {
                node: false,
                git: false,
                system_node_update: false,
                system_git_update: false,
            }
        );
        assert_eq!(
            ManagedRuntimeCapabilities::for_target("windows", "riscv64"),
            ManagedRuntimeCapabilities {
                node: false,
                git: false,
                system_node_update: false,
                system_git_update: false,
            }
        );
    }
}
