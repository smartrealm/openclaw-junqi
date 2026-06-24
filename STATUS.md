# JunQi Desktop — Status

> **Last updated**: 2026-06-22
> **Project**: JunQi Desktop (OpenClaw Gateway desktop client)
> **Phase**: Post-porting stabilization

---

## TL;DR

JunQi is an Electron-to-Tauri desktop client for **OpenClaw Gateway**, with a Nezha-style AI-coding surface (skill hub, worktrees, terminal, agent PTY) layered on top.

**As of 2026-06-22**:
- 26/26 nezha porting PRs complete
- 22 Rust unit tests passing
- CI workflow active (cargo check + test + tsc + vite build on every push)
- All user-facing ported features show real (mocked) data instead of "not wired"

---

## What works end-to-end

### Frontend (UI surfaces)
| Surface | Status | Notes |
|---|---|---|
| `StatusIcon` (`src/components/shared/`) | ✅ wired | Renders in Workshop column headers + per-task cards |
| `TimelineView` + `/timeline` route | ✅ wired | Reads from chatStore + workshopStore, groups by today/yesterday/earlier |
| `NotificationBell` (in TopBar) | ✅ wired | Polls backend every 60s, displays 5 mock notifications |
| `UsagePopover` (in NavSidebarFooter) | ✅ wired | Renders mock Claude 5h/7d + Codex primary/secondary usage bars |
| `Make Target` (in FileViewer) | ✅ wired | Parses Makefile, shows Run buttons, dispatches to TerminalPage |
| `@ file mention` (in ChatMessageInput) | ✅ wired | `@` picker merges skills + workspace files |
| `SkillHubManager` + `/skill-hub` route | ✅ wired | New minimal view; full SkillHubView is a future sprint |
| `NavSidebarFooter` | ✅ wired | Theme cycle + UsagePopover + Settings link |

### Backend (Tauri commands)
| Command | Module | Status |
|---|---|---|
| `run_task` / `agent_send_input` / `agent_resize_pty` / `cancel_task` / `get_active_task_ids` | `agent_task_pty.rs` | ✅ Spawns Claude/Codex in PTY (no session watcher yet) |
| `git_status` / `git_log` / `git_stage` / ... (40+ commands) | `git_neu.rs` | ✅ Full Git workflow |
| `read_file_content` / `write_file_content` / `create_file` / `delete_path` / ... | `fs_neu.rs` | ✅ File system operations |
| `open_shell` / `kill_shell` / `send_input` (shell) / `resize_pty` (shell) | `pty_neu.rs` | ✅ Multi-session terminal |
| `create_task_worktree` / `merge_task_worktree` / `remove_task_worktree` / `worktree_diff_stats` | `git_neu.rs` | ✅ Per-task worktree isolation |
| `read_session_metrics` / `read_session_messages` | `session_analytics.rs` | ✅ Claude/Codex JSONL parsing |
| `init_project_config` / `read_project_config` / `write_project_config` | `project_config.rs` | ✅ `.nezha/config.toml` CRUD |
| `load_app_settings` / `save_app_settings` / `detect_agent_paths` | `app_settings.rs` | ✅ `~/.nezha/settings.json` + agent detection |
| `get_hook_readiness` | `hooks.rs` | ✅ Detects Claude/Codex version + node availability |
| `list_skills` / `list_skill_installations` / `install_skill` / `delete_skill` | `skills.rs` | ✅ Frontmatter parsing + symlink management |
| `get_notifications` / `mark_notification_read` / `mark_all_notifications_read` | `notification.rs` | ✅ Returns 5 mock items + local read state |
| `read_usage_snapshot` | `usage.rs` | ✅ Returns mock Claude/Codex 5h/7d data |
| `get_workspace_path` | `workspace.rs` | ✅ Returns `~/.openclaw/workspace` |

---

## Architecture at a glance

```
src/
├── components/
│   ├── shared/                  # ← Ported components live here (copy-out from nezha)
│   │   ├── StatusIcon.tsx
│   │   ├── TimelineView.tsx
│   │   ├── NotificationBell.tsx
│   │   ├── UsagePopover.tsx
│   │   ├── NavSidebarFooter.tsx  (in Layout/)
│   │   └── index.ts              (barrel)
│   ├── Chat/                    # junqi's chat UI (gateway-driven)
│   ├── Git/                     # Ported: GitChanges, GitHistory, GitDiffViewer
│   ├── FileExplorer/            # Ported: FileExplorer, FileViewer
│   └── nezha/                   # Reference mirror (tsconfig excluded)
├── pages/                       # junqi's 24 routes + new /skill-hub, /timeline
├── hooks/                        # junqi's React hooks
├── stores/                      # Zustand stores (app, chat, settings, ...)
└── _nezha_root/                 # nezha reference root (excluded by tsconfig)

src-tauri/src/
├── commands/
│   ├── git_neu.rs               # 40+ git commands (ported)
│   ├── fs_neu.rs                # file ops (ported)
│   ├── pty_neu.rs               # shell terminal (ported)
│   ├── agent_task_pty.rs        # agent PTY (NEW minimal)
│   ├── session_analytics.rs     # session JSONL parsing (NEW)
│   ├── project_config.rs        # .nezha/config.toml (NEW)
│   ├── app_settings.rs          # ~/.nezha/settings.json (NEW)
│   ├── hooks.rs                 # hook readiness (NEW minimal)
│   ├── skills.rs                # skill hub (NEW)
│   ├── notification.rs          # notifications (NEW, mock data)
│   ├── usage.rs                 # usage snapshots (NEW, mock data)
│   └── workspace.rs             # workspace path (NEW)
└── nezha/                       # nezha reference Rust source (unused)
```

---

## Phase history

| Phase | Status | Deliverables |
|---|---|---|
| **P0 — Porting** | ✅ Complete (2026-06-22) | 26 PRs: backend modules + frontend components all wired |
| **P1 — Mock data** | ✅ Complete | `usage.rs` + `notification.rs` return real-shaped mock data |
| **P2 — Real data sources** | ⬜ Future | OAuth for Claude usage, codex app-server RPC, real notification API |
| **P3a — Rust tests** | ✅ Complete (2026-06-22) | 22 unit tests covering TOML/JSONL/frontmatter/sanitize/store |
| **P3b — Frontend tests** | ⬜ Deferred | No `tsx` / `vitest` runner; needs dep changes |
| **P4 — CI/CD** | ✅ Complete (2026-06-22) | `.github/workflows/ci.yml` runs rust + frontend + build on every push |
| **P5a — TimelineView** | ✅ Complete (2026-06-22) | `/timeline` route |
| **P5b — More nezha components** | ⬜ Future | WelcomePage, ProjectAvatar, AppSettingsDialog full version |

---

## Development commands

```bash
# Frontend
pnpm install              # install deps
pnpm dev                  # Vite dev server on :5173
pnpm build                # tsc + vite build
npx tsc --noEmit          # type check (no JS output)

# Backend
cd src-tauri
cargo check               # type-check Rust
cargo test --lib          # run unit tests (22 tests)
cargo clippy              # lint

# Full app
pnpm tauri dev            # run Tauri app in dev mode
pnpm tauri build          # produce .app / .exe / .AppImage
```

---

## CI

Every push and PR runs:
- **rust**: `cargo fmt --check`, `cargo clippy`, `cargo check --all-targets`, `cargo test --lib` (22 tests)
- **frontend**: `npx tsc --noEmit`, `npx eslint .`
- **build**: `pnpm build` (Vite production bundle)

See `.github/workflows/ci.yml`. All three jobs must pass for the summary check to be green.

---

## Porting reference docs

- [`docs/NEZHA-PORT-PLAN.md`](docs/NEZHA-PORT-PLAN.md) — original 26-PR plan + phased delivery
- [`docs/NEZHA-FEATURES-AND-UI.md`](docs/NEZHA-FEATURES-AND-UI.md) — feature inventory
- [`docs/NEZHA-VISUAL-DNA.md`](docs/NEZHA-VISUAL-DNA.md) — design system port notes
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — chronological change log (§0 = porting)

---

## Open follow-ups (not blocking)

1. **Real OAuth integration** for `usage.rs::read_usage_snapshot` (currently mock)
2. **Real notification source** for `notification.rs::get_notifications` (currently mock list)
3. **`hooks::ensure_installed`** — currently a stub; real installer would write to `~/.claude/settings.json`
4. **Frontend test runner** — add `tsx` (or `vitest`) + scripts; write tests for shared/ components
5. **`agent_task_pty` session watcher** — currently only spawns PTY; no session discovery / resume
6. **Nezha WelcomePage** — copy-out full home page (timeline + projects + skill hub views)
