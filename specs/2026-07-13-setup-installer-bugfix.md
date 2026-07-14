# Setup Installer Bugfix Spec

## BUG-01 - npm progress and inactivity

**Current**: npm may be quiet while extracting or running scripts; HTTP lines are discarded and the process is killed after six minutes without a newline.

**Target**: sanitized fetch lines and lifecycle output remain visible, while a periodic UI heartbeat identifies the current registry and elapsed time.

**Acceptance**:

- [x] `npm http fetch` lines are displayed without leaking credentials.
- [x] lifecycle scripts run with output attached to the setup console.
- [x] the inactivity watchdog still terminates a genuinely silent hung process.

## BUG-02 - registry diagnostics

**Current**: the UI says the China mirror is preferred even when dynamic selection chooses another order.

**Target**: the chosen registry order and resolved OpenClaw version are emitted before installation.

**Acceptance**:

- [x] npm receives a process-scoped registry override for each attempt.
- [x] setup output names the actual primary and fallback registries.

## BUG-03 - version rows

**Current**: npm has no row and newly installed versions are not retained in the timeline.

**Target**: Git, Node.js, npm, and OpenClaw each finish with their detected version in the execution-step UI.

**Acceptance**:

- [x] npm has a dedicated step.
- [x] Node/npm are rechecked after managed Node installation.
- [x] OpenClaw is rechecked and its installed version is placed in the completed step.

## BUG-04 - silent Windows setup

**Current**: only selected subprocesses use `CREATE_NO_WINDOW`; Git opens an interactive installer.

**Target**: all non-interactive probes and installers are hidden, and Git uses an extracted managed MinGit runtime.

**Acceptance**:

- [x] setup and system dependency probes use the shared background-command helper.
- [x] Windows Git installation does not launch an installer wizard or CMD window.
- [x] managed Git is verified and its version is emitted.
