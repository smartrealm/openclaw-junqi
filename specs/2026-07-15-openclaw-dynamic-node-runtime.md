# OpenClaw Dynamic Node Runtime Specification

## BUG-NR-01 - Dynamic compatibility contract

**Current**: JunQi duplicates one OpenClaw release's Node.js range in Rust.

**Target**: the selected installed package's `engines.node` is the Gateway
contract; the target npm package's `engines.node` is the install/update contract.

**Acceptance**:
- [x] npm OR/comparator/caret/wildcard ranges are parsed by a node-semver implementation.
- [x] installed OpenClaw metadata is read across Unix symlink and Windows shim layouts.
- [x] metadata fallback is explicit and covered by tests.

## BUG-NR-02 - Dynamic managed runtime

**Current**: repair always downloads Node.js 24.15.0.

**Target**: repair selects a compatible published Node.js release, preferring
the newest LTS available from verified Node distribution indexes.

**Acceptance**:
- [x] selected release satisfies the active OpenClaw range.
- [x] archive URL and filename use the selected release, not a constant.
- [x] an incompatible cached managed runtime is replaced.

## BUG-NR-03 - Update target preflight

**Current**: update makes only the currently installed CLI executable.

**Target**: before package replacement, JunQi also ensures compatibility with
the registry-selected target package.

**Acceptance**:
- [x] matching official/mirror metadata propagates `engines.node`.
- [x] stale mirror metadata cannot override official target requirements.
- [x] update logs state requirement source, selected Node version, and path.

## BUG-NR-04 - Independent managed runtime lifecycle

**Current**: npm cache has a Settings entry, while Node.js and Git can only be
installed indirectly during setup. Windows MinGit is pinned in source code.

**Target**: Node.js and Git are independently inspectable and updateable from
Settings. Runtime releases are selected from publisher metadata and installed
under the user-configured managed runtime directory.

**Acceptance**:
- [x] Windows MinGit version, architecture asset, URL, and digest come from
  Git-for-Windows release metadata rather than a source-code version constant.
- [x] archive digest is verified before extraction and source fallback remains
  domestic mirror first, publisher URL second.
- [x] Settings shows runtime directory, detected source/version/path, active
  OpenClaw Node.js requirement, and independent Node.js/Git actions.
- [x] Node.js update selects the newest compatible published LTS; it never
  substitutes a JunQi-owned concrete version requirement.
- [x] macOS/Linux identify Git as system-managed rather than pretending JunQi
  can replace the platform package manager's installation.
