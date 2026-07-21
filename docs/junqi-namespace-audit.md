# JunQi Namespace Audit

Scope: user-level persistence, agent hooks, task events, project metadata, worktrees, browser persistence, and tracked legacy modules.

Compatibility policy: none. JunQi must neither read nor write Nezha-owned paths or identifiers.

## Critical findings

### BUG-01 - Startup writes into another product's home namespace

`commands/app_settings.rs`, `commands/hooks.rs`, and `commands/skills.rs` resolve storage under `~/.nezha`. Application startup also installs hooks unconditionally and the frontend persists the native locale immediately.

Impact: a clean JunQi launch creates and mutates another product's directory.

### BUG-02 - Startup deletes a shared event directory

`agent_event_watcher` removes and recreates the complete `~/.nezha/events` tree.

Impact: JunQi can destroy another application's active task events.

### BUG-03 - Global agent configuration carries Nezha ownership

The generated hook, environment variables, and Codex managed block use Nezha names. Hook installation runs at application startup.

Impact: JunQi modifies global Codex configuration before the user starts an agent task and leaves misleading ownership markers.

## Medium findings

### BUG-04 - Project metadata and worktrees use `.nezha`

Project initialization creates `.nezha/config.toml` and `.nezha/attachments`; task worktrees use `.nezha/worktrees` and `nezha-task/*` branches.

### BUG-05 - Frontend persistence and events use Nezha keys

Terminal and workspace preferences, application events, CSS bridge names, and imported helper filenames retain Nezha identifiers.

## Cleanup finding

### BUG-06 - An uncompiled 11k-line legacy Rust tree remains tracked

`src-tauri/src/nezha` is not part of the crate module graph. Only two JavaScript assets are still included by active commands.
