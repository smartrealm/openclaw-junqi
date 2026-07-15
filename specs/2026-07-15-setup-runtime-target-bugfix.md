# Setup Runtime Target Bugfix

## BUG-RT-01 - Active Docker target

**Current**: configuration reads always resolve the native config path.

**Target**: the persisted runtime selection selects one authoritative Gateway
configuration path for onboarding, connection resolution, config UI, status,
and port probing.

**Acceptance**:
- [x] Docker wizard completion retains Docker URL and token.
- [x] native remains the compatibility default for existing bootstrap files.

## BUG-RT-02 - Mode-preserving recovery

**Current**: Docker retry and repair invoke native commands.

**Target**: selected Docker starts or recreates Docker only; native recovery may
use its existing Docker fallback without changing the selected target.

**Acceptance**:
- [x] Docker direct retry never calls native start.
- [x] Docker automatic repair never calls `openclaw update repair`.
- [x] boot restart honors selected Docker.

## BUG-RT-03 - Forced reinstall

**Current**: a detected OpenClaw package is always skipped.

**Target**: explicit reinstall bypasses that skip and forces npm to refresh the
package using the same locking and validation path.

**Acceptance**:
- [x] normal existing-install detection still skips installation.
- [x] reinstall requests force npm installation and revalidation.

## BUG-RT-04 - Docker terminal launcher

**Current**: Docker leaves a launcher that only works for a native binary.

**Target**: Docker writes a portable `docker exec` proxy after the container is
ready, without embedding credentials.

**Acceptance**:
- [x] Docker terminal integration reports a ready launcher.
- [x] launcher includes no token or credential.

## BUG-RT-05 - Runtime update capability

**Current**: unsupported Node update actions remain clickable.

**Target**: the backend reports whether automatic update is supported and the
frontend only enables executable actions.

**Acceptance**:
- [x] Windows keeps automatic Node update.
- [x] macOS/Linux cannot invoke the unsupported command from the UI.

## BUG-RT-06 - Runtime-aware CLI operations

**Current**: configuration validation and maintenance assume a host OpenClaw
binary, even after Docker is selected.

**Target**: all CLI-backed operations resolve the persisted runtime target.
Docker commands execute inside JunQi's owned container, and candidate configs
are temporary, credential-safe, and removed after the command completes.

**Acceptance**:
- [x] Docker configuration validation does not require a host OpenClaw binary.
- [x] Docker maintenance executes against the selected container.
- [x] candidate configuration is passed without shell interpolation and is cleaned up.

## Validation

- `cargo test --lib`: 298 passed, 2 ignored.
- `npm test`: 768 frontend tests and 16 script tests passed.
- `npm run lint`, `npm run build`, `cargo fmt --check`, and `git diff --check` passed.
