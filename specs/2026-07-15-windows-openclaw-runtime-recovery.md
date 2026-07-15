# Windows OpenClaw Runtime Recovery

## Acceptance Criteria

- [x] Node.js 24.14.x is rejected before OpenClaw starts.
- [x] JunQi dynamically installs a managed Node.js release accepted by OpenClaw.
- [x] Gateway startup retries through the compatible managed runtime.
- [x] Update checks and updates use the same runtime guard.
- [x] Update UI shows live phase, progress, and redacted bounded logs.
- [x] Update UI reports the normalized OpenClaw binary path.
- [x] `\\?\` and `\\?\UNC\` prefixes do not appear in display paths.
- [x] Network registry fallback remains supported.
- [x] Rust checks, frontend lint, full tests, and production build pass.
