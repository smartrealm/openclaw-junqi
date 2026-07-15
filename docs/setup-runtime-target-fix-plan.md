# Setup Runtime Target Fix Plan

## Phase A - Runtime target integrity

| Bug | Area | Fix |
| --- | --- | --- |
| BUG-RT-01 | paths, config, Gateway | Persist `native`/`docker` selection and resolve the active config and port from it. |
| BUG-RT-02 | setup, recovery, Gateway | Use the selected target for retry, repair, boot recovery, and restart. |
| BUG-RT-06 | CLI adapter, maintenance | Route configuration validation, provider/channel commands, and maintenance through the selected Native/Docker runtime. |

## Phase B - Installer correctness

| Bug | Area | Fix |
| --- | --- | --- |
| BUG-RT-03 | setup flow, installer | Carry force-reinstall intent and run a forced package install under the existing lock. |
| BUG-RT-04 | terminal integration, Docker flow | Generate a Docker-aware terminal proxy and validate it after container startup. |
| BUG-RT-05 | runtime settings | Return update capability from Rust and prevent unsupported actions. |

## Phase C - Verification

Add one regression contract per bug, run focused frontend and Rust tests, then
run type checking, formatting, and production builds.

Completed verification: `cargo test --lib`, `npm test`, `npm run lint`,
`npm run build`, `cargo fmt --check`, and `git diff --check`.
