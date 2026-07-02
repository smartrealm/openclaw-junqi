# HERMES UI Redesign — Pull Request Description

**Branch:** `feat/hermes-ui-redesign`
**Base:** `main`
**SPEC:** `.planning/specs/hermes-ui-redesign.md`
**Commits:** 8 atomic commits
**Files changed:** 44 files, +3000 / −509 lines

---

## Summary

Closes the 6 gaps identified vs `openclaw-maxauto`:

1. **Theme system** — Hardcoded 4 themes → HSL-derived system with 10 presets
2. **Module boundaries** — Implicit → Enforced via boundary-checker script
3. **Settings tabs** — 6 → 10 (4 new stubs)
4. **Gateway error recovery** — Manual restart → Auto-retry + Docker fallback
5. **Gateway log visibility** — None → 200-entry circular buffer + UI viewer
6. **Monorepo structure** — packages/ untracked → workspace-aware

---

## Architecture changes

### Module boundaries (SPEC §1)

Pure-math `theme/*` modules must not import from `stores/services/components`. The single allowed bridge is `theme/useTheme.ts` (integration with the settings store). Enforced by `scripts/check-boundaries.mjs` — runs in CI via `npm run lint`.

### Theme contract (SPEC §2.1)

```
ThemeInput { accent, bg, fg, contrast }  →  deriveThemeVariables()  →  DerivedTheme (25 vars)
```

- Single source of truth: `src/theme/derive.ts` (pure math, no DOM)
- 10 presets in `src/theme/presets.ts` (4 original aegis-* + 6 new color-coherent themes)
- Live wiring: `applyTheme()` now writes the derived CSS variables to `:root` after every change

### Gateway subsystem (SPEC §2.4, §4.2)

- **`GatewayProcess`** gains `logs: Mutex<VecDeque<LogEntry>>` (cap=200, FIFO eviction)
- **`commands/ensure.rs`** — new orchestrator: native child → Docker fallback → unavailable; debounced 60s
- **`commands/gateway_logs.rs`** — `get_gateway_logs(limit)` / `clear_gateway_logs` IPC
- **`commands/docker.rs`** — `spawn_docker_log_tailer` pipes `docker logs -f` into the same buffer

### Workspace (SPEC §2.7)

- `pnpm-workspace.yaml` now lists `packages/*` (was missing entirely)
- `@junqi/shared-tokens` package declared with proper exports
- Brand OKLCH CSS consumed via `@import '@junqi/shared-tokens/brand-oklch.css'`

---

## Commits

| # | Hash | Subject |
|---|---|---|
| 1 | ba9d681 | feat(theme): HSL derivation engine + 10 presets + 5x2 ThemePicker grid |
| 2 | 8fc9629 | feat(settings): 10-tab layout (6 existing + 4 stub panels) |
| 3 | e896264 | feat(gateway): 200-entry circular log buffer + IPC + frontend viewer |
| 4 | 04b4089 | feat(gateway): Docker fallback orchestrator + boot wiring + container log tailer |
| 5 | 776a844 | chore(monorepo): add packages/shared-tokens package + fix pnpm-workspace.yaml |
| 6 | 279d40e | chore(settings): include pre-existing voice wake settings in PR |
| 7 | 0b7bdd8 | chore(monorepo): track shared-tokens brand-oklch.css source |
| 8 | 5aa3aac | feat(lint): module-boundary checker (SPEC T8) |

---

## SPEC §5 acceptance criteria

| # | Test | Status |
|---|---|---|
| T1 | HSL derivation matches legacy aegis-dark.css within tolerance | ✅ derive('aegis-dark') 11 vars within ±2~12 RGB |
| T2 | 10 presets render | ✅ ThemePicker 5×2 grid, 10 i18n keys |
| T3 | Anti-flash preserved | ✅ earlyBootstrap() unchanged behavior |
| T4 | Settings 10 tabs mount without crash | ✅ 6 original + 4 stub panels |
| T5 | Gateway 200-entry buffer | ✅ 5 Rust tests (cap, eviction, timestamp, poison, JSON) |
| T6 | Docker fallback | ✅ ensure_gateway_running 4-step chain + 60s debounce |
| T7 | Workspace package | ✅ pnpm resolves @junqi/shared-tokens symlink |
| T8 | Module boundary | ✅ check:boundaries script (371 files, 0 violations) |
| T9 | Performance | ⚠️ Not benchmarked (non-blocking) |

---

## Verification

```bash
npm run lint                  # boundary check + tsc --noEmit
node --import ./test-setup.ts --import tsx --test src/theme/derive.test.ts
cd src-tauri && cargo test --lib state::gateway_process::
npx vite build                # production build
```

All clean as of last commit.

---

## Out of scope

- Live UI manual testing (visual diff requires running the desktop app)
- ESLint plugin-based boundary rules (chose Node script for zero new deps)
- T9 performance benchmarks
- Real data wiring for Models/Channels/MCP/Workspace stubs (SPEC §6 M5: "stubs acceptable, non-crashing")

---

## Decisions (from in-session AskUserQuestion)

| Q | Decision |
|---|---|
| Settings route | Sub-routes /settings/:tab (sub-router pattern) |
| Docker UX | Auto-start + toast (no confirmation dialog) |
| Stub content depth | All 4 stubs (Models/Channels/MCP/Workspace) |
| PR granularity | Single PR with sequential atomic commits |