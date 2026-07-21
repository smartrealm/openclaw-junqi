# JunQi Namespace Fix Plan

## Phase A - User data and destructive startup behavior

| Bug | Area | Change |
| --- | --- | --- |
| BUG-01 | settings, hooks, skills | Store under `paths::app_config_dir()` only. |
| BUG-02 | task event watcher | Use the JunQi event directory and never delete the root at startup. |
| BUG-03 | hook lifecycle | Install lazily from task execution; use JunQi script, environment, and marker names. |

## Phase B - Project namespace

| Bug | Area | Change |
| --- | --- | --- |
| BUG-04 | project config and git worktrees | Use `.junqi`, `junqi-task/*`, and protect `.junqi`. |

## Phase C - Product namespace cleanup

| Bug | Area | Change |
| --- | --- | --- |
| BUG-05 | frontend | Rename persisted keys, DOM events, CSS classes, and helper files without fallback reads. |
| BUG-06 | Rust legacy tree | Move the two live assets, then delete the uncompiled tree. |

## Validation

1. Tracked product source contains no case-insensitive `nezha` reference.
2. A clean isolated HOME launch-path test cannot resolve or create `~/.nezha`.
3. Rust tests, frontend tests, TypeScript build, and boundary checks pass.
