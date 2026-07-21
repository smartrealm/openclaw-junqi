# JunQi Namespace Bugfix Specification

## Contract

JunQi owns one user configuration root returned by `paths::app_config_dir()` and one project metadata directory named `.junqi`.

There is intentionally no migration, fallback read, alias, or cleanup behavior for Nezha data.

## BUG-01 / BUG-02 - User persistence

Current: settings, hooks, skills, and events resolve beneath `~/.nezha`; the event watcher removes the shared event tree.

Target: all paths resolve beneath the JunQi application configuration directory. The watcher creates its own directory without deleting the root.

Acceptance:

- [x] No active Rust module joins a home directory with `.nezha`.
- [x] Starting the event watcher cannot remove a pre-existing foreign directory.
- [x] Settings, hooks, events, and skills share the canonical JunQi root.

## BUG-03 - Hook ownership and lifecycle

Current: startup installs `nezha-hook.mjs`, injects `NEZHA_*`, and writes a `nezha-managed` Codex block.

Target: task execution lazily prepares `junqi-agent-hook.mjs`, injects `JUNQI_*`, and writes a `junqi-managed` block.

Acceptance:

- [x] Normal application startup does not install agent hooks.
- [x] Starting an agent task prepares the hook and starts one event watcher.
- [x] Generated hook assets and configuration contain only JunQi ownership names.

## BUG-04 - Project metadata

Current: project configuration, attachments, and worktrees live under `.nezha`; task branches use a Nezha prefix.

Target: new project state lives under `.junqi`; task branches use `junqi-task/`.

Acceptance:

- [x] Project initialization creates `.junqi/config.toml` and `.junqi/attachments`.
- [x] Task worktrees are constrained to `.junqi/worktrees`.
- [x] No legacy project path is read.

## BUG-05 / BUG-06 - Namespace cleanup

Current: browser keys, events, CSS/helper filenames, comments, tests, and an uncompiled Rust tree retain Nezha identifiers.

Target: tracked product source contains no Nezha identifier; live assets are moved before the dead tree is deleted.

Acceptance:

- [x] Product source contains no Nezha identifier.
- [x] There is no `src-tauri/src/nezha` directory in tracked source.
- [x] No browser persistence fallback reads legacy keys.
