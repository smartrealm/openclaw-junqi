#[cfg(windows)]
use crate::commands::git_runtime::{
    verified_managed_git_artifact, verified_system_git_installer_artifact,
};
#[cfg(windows)]
use crate::commands::node_runtime::node_installer_sources;
use crate::commands::node_runtime::{
    node_archive_sources, node_checksum_sources, node_index_sources, select_preferred_release,
    ManagedNodePlatform, NodeArchiveFormat, NodeDistributionRelease, NodeRequirementSource,
    NodeRuntimeRequirement,
};
#[cfg(target_os = "macos")]
use crate::commands::node_runtime::{node_macos_installer_filename, node_macos_installer_sources};
use crate::commands::npm_registry;
#[cfg(test)]
use crate::commands::process_control::terminate_process_tree;
use crate::commands::process_control::terminate_process_tree_confirmed;
#[cfg(windows)]
use crate::commands::process_control::{
    process_tree_was_already_gone, request_windows_process_tree_termination,
    terminate_windows_process_tree,
};
#[cfg(windows)]
use crate::commands::setup_diagnostics::diagnostic_artifact_path;
use crate::commands::setup_diagnostics::{
    record_process_finished, record_process_output, record_process_started, record_timeline_note,
    reset_timeline_log,
};
use crate::commands::setup_progress::{
    emit, emit_coalesced, emit_diagnostic, emit_keyed, emit_keyed_with_params,
};
use crate::paths;
use crate::platform;
use crate::state::GatewayProcess;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};

static OPENCLAW_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static NODE_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static GIT_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static DEPENDENCY_INSTALL_OPERATIONS: OnceLock<Mutex<DependencyInstallOperationCoordinator>> =
    OnceLock::new();
#[cfg(windows)]
const WINGET_NODE_LTS_PACKAGE: &str = "OpenJS.NodeJS.LTS";
#[cfg(windows)]
const WINGET_NODE_CURRENT_PACKAGE: &str = "OpenJS.NodeJS";
#[cfg(windows)]
const WINGET_GIT_PACKAGE: &str = "Git.Git";
#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
const RUNTIME_NETWORK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// One dependency installation is a transaction. Individual mirrors and
/// package-manager operations may retry, but they must share one upper bound
/// so a slow Windows network or installer cannot hold the setup lock forever.
const DEPENDENCY_INSTALL_DEADLINE: std::time::Duration = std::time::Duration::from_secs(30 * 60);
/// A stalled mirror must not consume the full installation transaction before
/// the official fallback gets a chance. Continuous progress is still shown to
/// the user, but one source has a bounded attempt window.
const DOWNLOAD_SOURCE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2 * 60);
const DOWNLOAD_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const NODE_INDEX_STAGGER: std::time::Duration = std::time::Duration::from_millis(250);
// A normal Node.js/Git MSI or Inno Setup transaction completes well within a
// few minutes. A longer wait hides a blocked Windows Installer service and
// prevents the controlled fallback from producing a useful diagnostic.
#[cfg(any(windows, test))]
const WINDOWS_INSTALLER_MAX_WAIT: std::time::Duration = std::time::Duration::from_secs(5 * 60);
#[cfg(any(windows, test))]
const PROCESS_HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
#[cfg(windows)]
const WINDOWS_RUNTIME_SETTLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const PROCESS_REAP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

const DEPENDENCY_INSTALL_OPERATION_ID_MAX_LEN: usize = 160;
const DEPENDENCY_INSTALL_CANCELLED_MESSAGE: &str =
    "Dependency installation was cancelled before JunQi activated a runtime";

mod download;
mod git;
mod node;
mod npm;
mod openclaw;
mod operation;
mod runtime_staging;
mod windows_installer;

// The submodules were carved out of one file and still form a single unit. Each
// reads the shared imports and constants above through `use super::*`, and the
// globs below feed every sibling back into that view, so a helper stays callable
// from wherever it was called before the split.
//
// Internal-only modules: nothing they define crosses the crate boundary.
use download::*;
use npm::*;
use runtime_staging::*;
// Every item in `windows_installer` is `#[cfg(windows)]`, so this glob resolves
// to nothing on the other platforms.
#[allow(unused_imports)]
use windows_installer::*;

// Modules that also carry `#[tauri::command]` functions. A glob is required
// rather than named re-exports: it carries the macros the attribute generates
// beside each command, which is what keeps the pre-split
// `commands::setup::<command>` paths resolvable from `generate_handler!`.
pub use git::*;
pub use node::*;
pub use openclaw::*;
pub use operation::*;
