# Setup Installer Visualization Spec

## BUG-V01 - Docker streaming

**Current**: Docker pull emits two plain strings around a buffered command.

**Target**: Docker pull and container startup use the same structured event shape as Native setup. Pull activity is streamed and local progress never moves backwards.

**Acceptance**:

- [x] Docker pull no longer uses `.output()`.
- [x] Pull output is emitted with `step = "pull"` and progress in 0..1.
- [x] Docker failures include a structured terminal error event.

## BUG-V02 - Step progress

**Current**: timeline rows show an indeterminate animation regardless of event progress.

**Target**: each running step retains its latest local progress and renders a determinate bar when known.

**Acceptance**:

- [x] `StepState` carries optional normalized progress.
- [x] step progress is monotonic and clamped to 0..100.
- [x] completed steps resolve to 100%.

## BUG-V03 - Live console

**Current**: setup logs retain only source, message, and timestamp.

**Target**: the installer console shows timestamp, step, semantic level, and message, follows new output, and can copy the retained log window.

**Acceptance**:

- [x] structured setup payloads retain `step` and classified `level`.
- [x] warnings, retries, npm errors, and successes receive distinct levels.
- [x] the install screen shows more than the last three records without opening a duplicate panel.

## BUG-V04 - Honest navigation

**Current**: Back remains available while an uncancellable backend command runs.

**Target**: Back is hidden during active installation and restored on error or safe completion states.

**Acceptance**:

- [x] active installer states expose no false cancellation action.
- [x] error and install-complete states retain recovery navigation.

## BUG-V05 - Synchronous step commits

**Current**: immediate patches and rapid events can read a stale `stepsRef` after `setSteps`.

**Target**: one commit helper updates the ref and React state from the same array.

**Acceptance**:

- [x] all whole-array setup writes use the commit helper.
- [x] the helper updates `stepsRef.current` before calling the state setter.

## Validation

- TypeScript: `npx tsc --noEmit`
- Frontend tests: 582 passed
- Module boundaries: 15 passed, 406 files checked
- Rust tests: 199 passed, 2 ignored
- Diff validation: `git diff --check`
