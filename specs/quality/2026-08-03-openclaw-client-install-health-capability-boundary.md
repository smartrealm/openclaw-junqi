# OpenClaw Client Install Health Capability Boundary

## Goal

Make native OpenClaw installation health report the verified local launch
contract without inventing a general OpenClaw version-support policy.

## In Scope

- `OpenclawStatus` Rust-to-TypeScript IPC contract.
- Setup installation health classification and repair decision.
- Setup runtime detail UI and localized defect labels.
- External collaboration plugin compatibility metadata and its package
  contract validator.
- Regression tests for the complete Rust, IPC, classifier, and UI chain.

## Out Of Scope

- Adding, removing, or simulating Gateway RPC methods.
- Changing OpenClaw's own installer, Wizard, runtime selection, or package
  discovery rules.
- Claiming Windows, macOS, CentOS, or Ubuntu device validation without a real
  target-runtime test.

## Required Behavior

1. `installed` is true when the discovered package is structurally valid and
   its Gateway entry is usable by the selected Node.js runtime. It must not
   depend on a JunQi-maintained OpenClaw version range.
2. `version`, when present, is package metadata for display and diagnostics;
   it is not a capability verdict.
3. A discovered binary requires repair only for a failed package or Gateway
   command check. A reported version cannot independently cause repair.
4. The IPC contract and UI must not expose `version_ok` or
   `version_beyond_verified_range` as a user-facing health state.
5. Gateway operation support continues to be decided by each integration's
   official protocol discovery, scopes, request result, and strict response
   decoder.
6. External code plugin `openclaw.compat.pluginApi` remains governed by the
   official plugin installer, independently of this client installation-health
   contract. Its range expresses the evidenced SDK API floor without a
   JunQi-maintained upper ceiling; its concrete build metadata remains
   informational provenance.

## Failure Behavior

- Missing or invalid package metadata, a failing entry smoke check, or a
  legacy wrapper leaves `installed` false and returns the existing specific
  diagnostic.
- An informational package version that cannot satisfy a JunQi-local range
  cannot produce a false install failure.
- Unknown Gateway feature support remains unavailable until an official
  discovery/result contract confirms it; the desktop must not infer it from
  version text.

## Acceptance

- No general OpenClaw version floor or ceiling is used by native installation
  health.
- Rust, TypeScript, and UI contracts agree on the remaining health fields.
- Focused regression tests cover healthy, package-invalid, and
  command-invalid installations and prove version is not a repair defect.
- Documentation records the official Gateway and external-plugin distinction.
