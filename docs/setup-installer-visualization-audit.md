# Setup Installer Visualization Audit

## Findings

### BUG-V01 - High - Docker image installation is a buffered black box

**Location**: `src-tauri/src/commands/docker.rs`, `src/hooks/useSetupFlow.ts`

`docker pull` waits on `.output()` and emits only plain strings before and after the command. The UI cannot show image layers, transfer activity, or the stage that failed.

**Fix**: stream Docker stdout and stderr, normalize every update to the structured `setup-progress` contract, and derive monotonic layer progress when the CLI reports bytes or phase changes.

### BUG-V02 - High - Per-step progress is discarded by the timeline

**Location**: `src/hooks/useSetupFlow.ts`, `src/components/setup/SetupFlowPanels.tsx`

Rust already emits local progress in the 0..1 range, but `StepState` stores only status and detail. Running steps therefore render a fixed indeterminate bar even while exact download or extraction progress is available.

**Fix**: retain normalized local progress on each step and render a determinate bar and percentage whenever the producer supplies it.

### BUG-V03 - Medium - Installation logs lose event semantics

**Location**: `src/pages/SetupPage.tsx`, `src/stores/app-store.ts`

The log collector keeps only `message`. Step, severity, event progress, and structured errors are discarded. Error styling only searches for the literal word `error`, so npm `ERR!`, warnings, retries, and successful transitions are misclassified.

**Fix**: normalize event payloads once, retain step and level in the store, and render a timestamped live console with semantic tones and auto-follow.

### BUG-V04 - Medium - Back navigation presents a false cancellation contract

**Location**: `src/pages/SetupPage.tsx`, `src/hooks/useSetupFlow.ts`

`goBack()` invalidates the frontend run identifier but does not terminate Node, npm, or Docker work. Showing a Back action during installation implies the operation stopped when it continues in the background.

**Fix**: remove Back while an installer command is active. Keep recovery navigation on terminal error and after installation reaches a safe boundary; true process cancellation remains a separate backend capability.

### BUG-V05 - High - Immediate step patches can target stale state

**Location**: `src/hooks/useSetupFlow.ts`

The flow calls `setSteps(initial)` and then immediately patches the first step through `stepsRef.current`. React has not rendered the new array yet, so the patch may operate on an empty or previous-mode step list. Fast progress events can overwrite each other for the same reason.

**Fix**: route every step-array write through one commit helper that updates the synchronous ref before scheduling React state.

## Positive baseline

- Native setup already emits detailed download, extraction, registry fallback, lifecycle, and validation activity.
- Aggregate progress is monotonic.
- Install target and post-install runtime validation are already visible.
- Installation logs are sanitized before they reach the frontend.
