# Windows Runtime Recovery Bugfix Specification

Date: 2026-07-16

## BUG-WSR-01 - Exact compatible runtime command

**Current**: repair and some CLI paths independently resolve a Node executable
from PATH after an OpenClaw binary has been detected.

**Target**: the binary, package requirement, and compatible Node executable are
resolved dynamically as one command context. Windows npm shims execute their
verified package entry through that exact Node path.

**Acceptance**:
- A Node mismatch causes repair to ensure a compatible Node before spawn.
- Native update, start, repair, and CLI commands cannot silently switch to an
  incompatible PATH Node after compatibility validation.
- No user-specific install path is embedded in source.

## BUG-WSR-02 - Owned Windows process trees

**Current**: Gateway lifecycle cleanup can kill only the tracked parent.

**Target**: Windows cleanup terminates the tree rooted at the tracked child PID.

**Acceptance**:
- No external listener is targeted.
- Restart/start timeout/Docker switch share the same owned-child cleanup.

## BUG-WSR-03 - Migration-lock recovery plan

**Current**: boot and manual recovery immediately retry a migration lock.

**Target**: all entry points honor OpenClaw's retry-after timestamp with a
bounded delay and clear progress copy.

**Acceptance**:
- A migration lock does not cause an immediate competing restart.
- Cancellation/newer recovery invalidates a pending wait.

## BUG-WSR-04 - Terminal repair state

**Current**: repair emits non-terminal progress and hides its rejected error.

**Target**: progress events carry completed or failed state, and the panel
surfaces failure while leaving retry actions enabled.

**Acceptance**:
- Success ends at completed.
- Any error ends at failed with a bounded, redacted message.
- Retry controls are usable after failure.

## BUG-WSR-05 - External diagnostic redaction

**Current**: AI rescue receives raw Gateway/Docker diagnostic text.

**Target**: Rust redacts and bounds diagnostics just before outbound HTTP.

**Acceptance**:
- Authorization, API-key, token, secret, password, and credential values are
  excluded from both prompt error and prompt logs.
- API keys used to authenticate the direct provider are never added to prompts
  or emitted as diagnostics.

## BUG-WSR-06/07 - Dynamic npm ownership

**Current**: `.npmrc` prefix scanning and Windows `.bin` reinstall derivation
can miss a valid npm-owned package.

**Target**: prefix/package discovery walks real configuration and verified
filesystem relationships.

**Acceptance**:
- Unrelated `.npmrc` lines do not stop prefix detection.
- Both supported Windows shim layouts reinstall in place only after the package
  root is proven.
