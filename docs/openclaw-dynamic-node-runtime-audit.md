# OpenClaw Dynamic Node Runtime Audit

Date: 2026-07-15

## Critical Findings

### BUG-NR-01 - JunQi duplicated OpenClaw's Node.js policy

`system.rs` encoded the current OpenClaw range as Rust branches. A future
OpenClaw release can change `package.json.engines.node` without a JunQi release,
causing detection and execution to drift again.

### BUG-NR-02 - Managed Node.js download was pinned independently

`setup.rs` always downloaded Node.js 24.15.0. Even if compatibility detection
became dynamic, repair could still install a version rejected by a newer
OpenClaw package.

### BUG-NR-03 - Update preflight checked only the installed package

The updater made the current CLI executable, but did not ensure that the same
runtime satisfies the target npm package before replacement.

## Medium Findings

### BUG-NR-04 - Missing metadata had no explicit compatibility provenance

Legacy/manual packages may omit `engines.node`, and registry access can fail.
Fallback behavior must remain available but visible as fallback policy, rather
than pretending to be the package's declared requirement.

### BUG-NR-05 - Managed Git was pinned and had no lifecycle entry

Windows MinGit used a source-code constant, so a JunQi release was required for
every Git-for-Windows refresh. Settings also exposed npm cache management but no
independent Node.js or Git inspection/update workflow.

## Resolution Design

- Parse npm-compatible semver through a dedicated runtime policy type.
- Read installed requirements from the selected OpenClaw package metadata.
- Extend live npm metadata probes with the target package's `engines.node`.
- Select a compatible managed Node.js release from official/mirror distribution
  indexes, preferring the newest available LTS release.
- Revalidate the installed artifact after repair and before Gateway startup.
- Keep a visibly identified compatibility fallback only for legacy/offline
  metadata gaps; never present it as an OpenClaw-declared version policy.
- Resolve Windows MinGit from Git-for-Windows release metadata, select the
  architecture-specific asset, and verify the publisher-provided SHA-256 digest.
- Expose managed Node.js and Git status/update actions independently of the
  OpenClaw package updater while keeping the configured runtime directory.
