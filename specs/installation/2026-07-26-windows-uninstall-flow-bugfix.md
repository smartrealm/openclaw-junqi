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
