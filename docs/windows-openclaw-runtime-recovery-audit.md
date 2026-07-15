# Windows OpenClaw Runtime Recovery Audit

Date: 2026-07-15

## Findings

### Critical: incompatible Node.js was accepted

JunQi accepted Node.js 24.14.x while current OpenClaw requires one of these
ranges: `>=22.22.3 <23`, `>=24.15.0 <25`, or `>=25.9.0`. Both update and
Gateway startup could therefore launch a CLI that immediately exited.

### High: detection disagreed with child PATH precedence

An incompatible JunQi-managed Node could be present while detection selected a
compatible system Node. Child processes still placed the managed directory
first on PATH, so the runtime reported by detection was not the runtime used.

### High: update output was buffered and opaque

The update panel showed a generic busy message until the command exited. The
first JSON lines could also hide the actionable Node.js diagnostic.

### Medium: Windows verbatim paths leaked into UI

Canonical Windows paths may use `\\?\` or `\\?\UNC\` prefixes. Those prefixes
are valid internally but should not be shown to users.

## Resolution

- Derive the Node support range from installed/target OpenClaw package metadata.
- Select a compatible published Node.js LTS dynamically for the current platform.
- Added one runtime guard shared by update checks, updates, and Gateway starts.
- Automatically repairs with JunQi-managed Node.js without changing the user's
  system installation.
- Streams redacted update output through the existing progress event contract.
- Displays progress, bounded logs, binary path, and runtime path in the panel.
- Normalizes Windows paths for display while retaining original execution paths.

## Regression Coverage

- npm-semver range behavior and dynamic compatible-release selection.
- Windows drive and UNC display path normalization.
- Node.js diagnostics take priority over wrapper JSON.
- Update reducer progress monotonicity and duplicate-log suppression.
