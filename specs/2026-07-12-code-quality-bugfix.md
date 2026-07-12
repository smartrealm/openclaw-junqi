# Code Quality Bugfix Specification

## BUG-CQ01 - Task-scoped tool-call watcher

**Current**: `run_task` starts a watcher that selects a global newest session
file and polls indefinitely.

**Target**: the session discovery path starts the watcher only after it has
selected a session JSONL for that same task. The watcher receives that path and
stops when the task no longer has a live PTY registration.

**Acceptance**:

- [x] No `recent_session_files` global scan remains.
- [x] A tool-call watcher receives a task-specific session path.
- [x] The watcher exits after its task leaves the live registry.
- [x] The task remains able to emit tool-call events for its selected session.

## BUG-CQ05 - Single renderer version fallback

**Current**: three renderer surfaces hardcode `0.5.0` independently.

**Target**: all renderer fallback display uses a plain build-time `APP_VERSION`
module, while the existing hook remains a small formatting wrapper.

**Acceptance**:

- [x] No renderer `0.5.0` app-version fallback remains.
- [x] Browser-only fallback and settings display derive from the same constant.
- [x] Existing `useAppVersion` public API remains available.

## BUG-CQ04 - Enforced frontend quality gate

**Current**: CI invokes an unavailable ESLint binary and suppresses its exit
status.

**Target**: CI runs the repository-maintained `pnpm lint` script and fails when
the script fails.

**Acceptance**:

- [x] CI no longer invokes ESLint with `|| true`.
- [x] The configured CI command is present in `package.json`.
- [x] `pnpm lint` passes locally.

## BUG-CQ02 - Project-scoped Claude session discovery

**Current**: Claude tasks scan every `~/.claude/projects/*` directory for a
recent JSONL file.

**Target**: Claude tasks scan only the directory encoded from their own project
path, matching Claude's persisted-project naming convention.

**Acceptance**:

- [x] Claude project paths are encoded in one pure helper.
- [x] Claude session discovery uses only the encoded project directory.
- [x] Unix and Windows path spellings are covered by unit tests.
