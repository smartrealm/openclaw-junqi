# OpenClaw Client Install Health Capability Boundary Plan

## Evidence

Read the current local installation chain, Setup classifier, IPC DTO, UI,
regression tests, collaboration package manifest, and the official OpenClaw
Gateway protocol, plugin manifest, plugin installer, and package contract at
`957bdd177f1ad5616abe34e71fbff5a1525fdb06`.

## Implementation Order

1. Record the distinction between Gateway runtime capability discovery and
   external plugin SDK API compatibility.
2. Remove the native hardcoded OpenClaw support-range parser, fields, errors,
   and tests. Keep package version as informational metadata only.
3. Change the collaboration plugin peer metadata and `compat.pluginApi` from a
   client-created ceiling to the evidenced official SDK API floor, then verify
   the published package contract.
4. Update the TypeScript IPC DTO, Setup health defects, repair predicate,
   localized labels, and runtime details UI to use only package and command
   validation.
5. Replace regression coverage with behavioral assertions across the same
   boundary. Do not use source-text assertions for implementation details.
6. Validate focused tests first, then Rust library tests, lint, official docs,
   collaboration package contract, diff whitespace, and modified-file emoji
   scans.
7. Record results and unverified platform boundaries, then create one Chinese
   commit for this coherent behavior change.

## Guardrails

- Do not use the collaboration plugin's SDK API range as a desktop Gateway
  health policy.
- Do not add a fallback version range, capability map, or artificial success
  state.
- Preserve all existing runtime ownership, Node selection, Windows shim, npm
  prefix, and selected-runtime behavior.
