# 2026-07-12 Code Quality Audit

Scope: the current JunQi desktop runtime, with emphasis on recently integrated
workspace, terminal, task, session, update, and release paths. The review uses
the compiled `src-tauri/src/lib.rs` command graph as the runtime authority;
files outside that graph are not treated as shipped behavior.

## Critical Findings

### BUG-CQ01 - Task tool-call watcher can report another task and never stops

**Location**: `src-tauri/src/commands/agent_task_pty.rs:475`,
`src-tauri/src/commands/agent_task_pty.rs:749`

`run_task` starts `spawn_toolcall_watcher` before session discovery. The watcher
then chooses the most recently modified Claude/Codex JSONL file globally rather
than the file emitted for this task. Its tail loop has no task-lifecycle exit
condition.

**Impact**:

- Concurrent tasks can display another task's tool activity in `AgentRunView`.
- Every discovered task leaves a 500 ms polling thread alive after completion.

**Fix**: start the watcher only after the existing session watcher has selected
and emitted a session path. Tail that exact path and exit once the task leaves
the live PTY registry. Remove the global newest-session scan.

## Medium Findings

### BUG-CQ02 - Claude session discovery was not project-scoped

**Location**: `src-tauri/src/commands/agent_task_pty.rs:632`

The Claude branch scans every `~/.claude/projects/*` directory and selects the
first JSONL newer than the task start timestamp. Concurrent tasks can therefore
persist the wrong resume/session path even after BUG-CQ01 is fixed.

**Fix**: use Claude's existing project-directory encoding (`non-alphanumeric`
characters become `-`) and scan only `~/.claude/projects/<encoded-project>`.

### BUG-CQ04 - CI claimed linting while ESLint was absent and failures were masked

**Location**: `.github/workflows/ci.yml:111`, `package.json`

The frontend workflow runs `npx eslint ... || true`, while ESLint is not in the
dependency graph. The job cannot act as a lint gate.

**Fix**: use the repository-maintained `pnpm lint` gate instead. It enforces
architectural boundaries and TypeScript without claiming an unavailable ESLint
check.

## Low Findings

### BUG-CQ05 - Desktop version fallback is duplicated and stale after release

**Location**: `src/api/tauri-adapter.ts:220`,
`src/components/settings/AboutPanel.tsx:11`,
`src/components/shared/AppSettingsDialog.tsx:399`

Three UI fallbacks embed `0.5.0` although release metadata is `0.5.1`.

**Fix**: use one build-time version constant in all renderer fallback surfaces.

## Verified Non-findings

- Workspace path comparison keeps Windows drive and UNC normalization isolated
  to Windows-looking paths and has dedicated tests.
- Terminal watcher registration carries a generation and its native registry
  prevents stale cleanup from deleting a newer watcher.
- Session label migration only removes legacy labels after the Gateway confirms
  the native label operation.
- `src-tauri/src/nezha/` is an intentional, uncompiled 1:1 reference mirror
  (commit `cf60fd2`), not an accidental parallel runtime. It remains out of
  the build graph until individual features are ported into their host modules.
- Windows CI now starts native x64 compilation/NSIS packaging, and the release
  matrix starts both x64 and ARM64 Windows jobs.
