# Windows Uninstall Flow Bugfix Spec

## BUG-WUF-01 · Remove selected managed Docker container

**Current**：NSIS cleanup removes terminal integration and a selected Native service only. A JunQi-owned Docker container created with `--restart unless-stopped` survives uninstall.

**Target**：When the persisted runtime is Docker, cleanup resolves Docker, verifies the named container's complete JunQi ownership contract and selected state identity, then removes it. Foreign, unverifiable, or other-state containers remain untouched.

**Acceptance**：
- [x] Selected JunQi Docker container is removed with `docker rm -f`.
- [x] Foreign or different-state container is never removed.
- [x] Missing container is idempotent success where ownership-safe.
- [x] Docker resolution/inspection/removal failure makes the helper return nonzero.

## BUG-WUF-02 · Fail closed on cleanup exit code

**Current**：NSIS stores the helper exit code in `$0` but ignores it.

**Target**：The pre-uninstall hook continues only on exit code zero. Any nonzero result shows an actionable message and aborts uninstall so the helper remains available for retry.

**Acceptance**：
- [x] Both current and legacy binary-name branches share the same exit-code gate.
- [x] Exit code zero continues uninstall.
- [x] Nonzero exit code displays an error and aborts.
- [x] A source-contract regression test covers the hook and Docker ownership gate.

## BUG-WUF-03 · Skip Native runtime discovery when no service artifact exists

**Current**：Every persisted Native uninstall resolves npm prefixes, OpenClaw and a compatible Node runtime before determining whether an official Gateway service exists.

**Target**：On Windows, run the existing non-mutating Scheduled Task and Startup-entry artifact probe first. Return immediately only when absence is proven. A present or unverifiable artifact continues through the full selected-runtime ownership gate.

**Acceptance**：
- [x] Proven absence does not resolve Node, npm or OpenClaw.
- [x] Present and unverifiable artifacts still require selected state/config/runtime ownership proof.
- [x] Terminal integration cleanup remains independent and idempotent.

## BUG-WUF-04 · Remove duplicate official service lifecycle commands

**Current**：After ownership attestation, JunQi starts separate OpenClaw CLI processes for status, stop, uninstall and post-uninstall status.

**Target**：Keep one preflight status for ownership, then call the installed-version official `gateway uninstall --json` command, whose verified `2026.7.1-2` implementation performs stop-before-uninstall and checks that the service is no longer loaded. Keep JunQi's independent configured-port release postcondition.

**Acceptance**：
- [x] A selected installed service uses one ownership status command and one uninstall command.
- [x] Foreign or unverifiable service ownership never reaches uninstall.
- [x] The configured port must be released before cleanup reports success.
- [x] A regression test guards the two-command lifecycle contract without relying on source offsets.
