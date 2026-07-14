# Install Layout Hardening Specification

## BUG-IL01 - External terminal state

**Current:** Custom storage only affects JunQi child processes.

**Target:** An explicit terminal-integration option installs a stable launcher
that exports the selected state/config paths and runs the selected OpenClaw
binary with the managed runtime on its process `PATH`.

**Acceptance:**
- Integration is opt-in, idempotent, and removable.
- A new login shell resolves the JunQi launcher after integration.
- The launcher uses the persisted state and config paths.
- Unix profile updates fail closed when the file is unreadable or managed markers are malformed.
- Windows user PATH updates are case-insensitive, preserve REG_EXPAND_SZ, and broadcast WM_SETTINGCHANGE.
- Windows x64 and ARM64 use the same registry and launcher contract without architecture-specific paths.

## BUG-IL02 - npm prefix source

**Current:** Managed npm defaults can be presented as the user's terminal npm
prefix.

**Target:** Automatic selection uses npm resolved from the login environment.
When no writable user prefix exists, it uses a labeled user-owned fallback.

**Acceptance:**
- Managed npm without `~/.npmrc` is not labeled as a terminal npm prefix.
- A configured custom prefix is used exactly and fails clearly if unwritable.
- No command mutates `.npmrc`.

## BUG-IL03 - Managed runtime layout

**Current:** Node, Git, and npm cache are hidden under the state root.

**Target:** Setup persists and displays a runtime root and npm cache directory;
Node and Git remain protected child directories under that root.

**Acceptance:**
- Existing v1 bootstrap files retain their existing paths.
- New paths are absolute, validated, and never interpreted as direct deletion
  targets.
- New workspace, runtime, cache, and npm-prefix paths cannot be equal, nested,
  or aliases through an existing symbolic link; unchanged v1 overlap remains
  supported for backward compatibility.

## BUG-IL04 - Workspace placement

**Current:** Fresh setup always uses `<state>/workspace`.

**Target:** Setup accepts an explicit workspace directory and writes it to both
the bootstrap and `agents.defaults.workspace` when configuration exists.

**Acceptance:**
- Fresh setup creates the chosen workspace.
- Migration preserves the existing external workspace unless the user starts
  fresh and explicitly chooses another location.

## BUG-IL05 - Honest environment status

**Current:** Writable npm prefix is treated as proof of terminal availability.

**Target:** UI distinguishes application-only paths, terminal-ready paths, and
pending terminal integration.

**Acceptance:**
- Setup shows resolved state, workspace, runtime, cache, and npm prefix paths.
- Terminal status is based on backend verification, not path assumptions.
