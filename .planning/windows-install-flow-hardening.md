# Windows Installation Flow Hardening

Status: completed 2026-07-15

1. Preserve and expand Windows PATH during dependency installation.
2. Make OpenClaw package promotion transactional and recoverable.
3. Resolve winget explicitly and provide an actionable unavailable path.
4. Remove the unused arbitrary package-install command.
5. Keep reinstall on the detected npm prefix.
6. Require and verify Authenticode signatures for tagged releases.
7. Run Rust, frontend, script, build, lint, and formatting validation.
