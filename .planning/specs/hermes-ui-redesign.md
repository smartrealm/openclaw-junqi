# HERMES UI Redesign — Architecture SPEC

**Status:** APPROVED — 2026-07-01, all 4 user decisions accepted (Q1–Q4). Q5 default accepted.
**Branch:** `feat/hermes-ui-redesign`
**Scope:** Close 6 gaps identified vs `openclaw-maxauto`. Single PR. Implementation begins M1.

---

## 0. Why this SPEC exists

openclaw-maxauto demonstrated a clean architecture for theme/theme-derivation/settings/error-recovery that openclaw-junqi does not yet have. Closing the gaps requires touching 6 modules that already work and that the rest of the app depends on. A mis-shaped contract here will leak into 3900+ utility classes and every settings user. So: contract first.

---

## 1. Module boundaries — the dependency graph that must not be violated

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  src/                                                                       │
│                                                                             │
│  theme/         (pure: types, math, resolver, DOM-side-effect in apply.ts) │
│    ├─ types.ts        ◄── NO imports of stores, services, gateway           │
│    ├─ constants.ts    ◄── only types from types.ts                          │
│    ├─ resolver.ts     ◄── pure                                              │
│    ├─ derive.ts       ◄── NEW — pure math                                   │
│    ├─ presets.ts      ◄── NEW — 10 preset ThemeInput tuples                 │
│    ├─ apply.ts        ◄── DOM side-effects only                             │
│    ├─ earlyBootstrap  ◄── sync, no React                                    │
│    └─ useTheme.ts     ◄── React hook, calls theme/* only                    │
│                                                                             │
│  stores/        (state; imports theme/, services/; no DOM side-effects)     │
│                                                                             │
│  components/    (UI; imports stores/, theme/useTheme; no IPC)               │
│                                                                             │
│  services/      (IPC adapters; no state; no theme/)                         │
│                                                                             │
│  pages/         (routes; orchestrates stores/components/services)           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  src-tauri/src/                                                             │
│                                                                             │
│  commands/      (Tauri IPC handlers; pure business logic)                   │
│    ├─ gateway.rs       ◄── uses state/, paths/                              │
│    ├─ docker.rs        ◄── existing                                         │
│    ├─ gateway_logs.rs  ◄── NEW — circular buffer                            │
│    └─ ensure.rs        ◄── NEW — native→docker fallback orchestrator       │
│                                                                             │
│  state/         (process/lifecycle singletons; no business logic)           │
│    └─ gateway_process.rs   ◄── + gateway_logs: Mutex<VecDeque<LogEntry>>    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  packages/                                                                  │
│                                                                             │
│  shared-tokens/   (zero-dep CSS+TS tokens; consumed by src/ via workspace)  │
│  shared-ui/       (cross-package UI primitives; consumed by src/)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Forbidden cross-imports (enforced by ESLint rule + code review):**

- `theme/*` → `stores/`, `services/`, `components/` ❌
- `services/*` → `stores/`, `theme/` ❌
- `state/*` → `commands/*` ❌
- `components/*` → `services/*` directly (must go through stores) ❌
- `pages/*` → `state/*` Rust directly (only via services + IPC) ❌

**Why this matters:** it is the only way to keep theme derivation unit-testable, to swap the Rust gateway backend later (e.g. for a Python one), and to move `shared-tokens` out as a standalone package without rewriting all consumers.

---

## 2. Contracts

### 2.1 ThemeInput — the new 4-input root type

```ts
// theme/types.ts (additive — does not break existing AegisTheme)

/** A single hex color in `#rrggbb` form. */
export type HexColor = `#${string}`;

/**
 * The 4 inputs that uniquely determine all ~25 derived CSS variables.
 * contrast is 0..1 (0 = flat low-contrast, 1 = sharp high-contrast).
 * Mode is decided by callers (dark/light); the derive function is mode-agnostic.
 */
export interface ThemeInput {
  accent: HexColor;   // primary brand color
  bg:     HexColor;   // page background
  fg:     HexColor;   // main text color
  contrast: number;   // 0..1 — controls surface scale spacing
}

/** Every variable the rest of the app reads, in RGB-triplet form (so Tailwind alpha works). */
export interface DerivedTheme {
  // Backgrounds (5 stops from bg → elevated)
  '--aegis-bg':            string;
  '--aegis-surface':       string;
  '--aegis-surface-elevated': string;
  '--aegis-elevated':      string;
  '--aegis-card':          string;

  // Text (4 stops from fg → muted)
  '--aegis-text':           string;
  '--aegis-text-secondary': string;
  '--aegis-text-muted':     string;
  '--aegis-text-dim':       string;

  // Borders (3 stops)
  '--aegis-border':         string;
  '--aegis-border-hover':   string;
  '--aegis-border-active':  string;

  // Primary (4 stops + glow/surface)
  '--aegis-primary':         string;
  '--aegis-primary-hover':   string;
  '--aegis-primary-deep':    string;
  '--aegis-primary-glow':    string;
  '--aegis-primary-surface': string;

  // Status (semantic — derived from hue rotation, not user-set)
  '--aegis-success':         string;
  '--aegis-warning':         string;
  '--aegis-danger':          string;

  // Surface for status chips
  '--aegis-success-surface': string;
  '--aegis-warning-surface': string;
  '--aegis-danger-surface':  string;

  // Native chrome mode (for Tauri title bar)
  __nativeTitleBarMode: 'dark' | 'light';
}

/** Pure math: 4 inputs → 25+ CSS variables. Testable, no DOM. */
export function deriveThemeVariables(input: ThemeInput): DerivedTheme;
```

### 2.2 AegisThemeId — extended to 10 presets

```ts
// theme/types.ts (ADD — keep existing 4 for backward compat)

export const AEGIS_THEMES = [
  // Existing (no behavior change — derived from canonical inputs)
  'aegis-dark', 'aegis-midnight', 'aegis-light', 'aegis-eyecare',
  // New (HSL-derived, hand-tuned 4-tuples)
  'ocean', 'rosewood', 'forest', 'solar', 'slate', 'lavender',
] as const;
export type AegisTheme = typeof AEGIS_THEMES[number];

// theme/presets.ts (NEW)
export const THEME_PRESETS: Record<AegisTheme, ThemeInput> = {
  'aegis-dark':    { accent:'#7f9aff', bg:'#1d212a', fg:'#f1f4fb', contrast:0.5 },
  'aegis-midnight':{ accent:'#a78bfa', bg:'#0f1117', fg:'#e6e6e6', contrast:0.4 },
  'aegis-light':   { accent:'#3b82f6', bg:'#f5f7fb', fg:'#171b24', contrast:0.5 },
  'aegis-eyecare': { accent:'#a07a3c', bg:'#f5ecd7', fg:'#5a4a30', contrast:0.3 },
  'ocean':         { accent:'#38bdf8', bg:'#0c1e2e', fg:'#e0f2fe', contrast:0.5 },
  'rosewood':      { accent:'#f43f5e', bg:'#2a1414', fg:'#fef2f2', contrast:0.45 },
  'forest':        { accent:'#4ade80', bg:'#0f1f15', fg:'#dcfce7', contrast:0.5 },
  'solar':         { accent:'#f59e0b', bg:'#1c1410', fg:'#fef3c7', contrast:0.45 },
  'slate':         { accent:'#94a3b8', bg:'#1e293b', fg:'#e2e8f0', contrast:0.4 },
  'lavender':      { accent:'#a855f7', bg:'#faf5ff', fg:'#3b0764', contrast:0.4 },
};
```

### 2.3 CSS variable application — single source of truth

```ts
// theme/apply.ts (EXTEND — additive)
export function applyTheme(theme: AegisTheme): void {
  applyToDocument(theme);   // existing — sets data-theme attribute
  applyDerivedVars(theme);  // NEW — writes --aegis-* from derived theme
  syncNativeTitleBar(theme);
}

/** Writes the 25 derived CSS variables to :root. Synchronous, idempotent. */
function applyDerivedVars(theme: AegisTheme): void {
  const derived = deriveThemeVariables(THEME_PRESETS[theme]);
  const html = document.documentElement;
  for (const [k, v] of Object.entries(derived)) {
    if (k.startsWith('--')) html.style.setProperty(k, v);
  }
}
```

### 2.4 GatewayLog — circular buffer contract

```rust
// src-tauri/src/state/gateway_process.rs (ADD)
#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp_ms: i64,        // unix epoch ms
    pub level: LogLevel,           // Trace|Debug|Info|Warn|Error
    pub source: LogSource,         // ChildStdout|ChildStderr|DockerStdout|DockerStderr|Lifecycle
    pub message: String,           // raw line, may contain newlines (split upstream)
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel { Trace, Debug, Info, Warn, Error }

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogSource { ChildStdout, ChildStderr, DockerStdout, DockerStderr, Lifecycle }

pub struct GatewayProcess {
    pub child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
    pub restarting: Mutex<bool>,
    pub logs: Mutex<VecDeque<LogEntry>>,  // NEW — cap=200, evict-oldest
}

// src-tauri/src/commands/gateway_logs.rs (NEW)
#[tauri::command]
pub async fn get_gateway_logs(limit: usize) -> Result<Vec<LogEntry>, String>;

#[tauri::command]
pub async fn clear_gateway_logs() -> Result<(), String>;
```

### 2.5 Docker fallback orchestrator

```rust
// src-tauri/src/commands/ensure.rs (NEW)

#[derive(Debug, Serialize)]
pub struct EnsureResult {
    pub mode: GatewayMode,        // Native | Docker | Unavailable
    pub healthy: bool,
    pub port: u16,
    pub token: Option<String>,
    pub attempted_fallback: bool,
    pub error: Option<String>,
}

/// Boot-time orchestrator: try managed child → if failing N consecutive
/// healthz probes within 10s, attempt docker fallback. Never called more
/// than once per minute (debounced internally).
#[tauri::command]
pub async fn ensure_gateway_running(state: State<'_, GatewayProcess>) -> Result<EnsureResult, String>;
```

### 2.6 Settings tabs — extend from 6 to 10

Existing tabs: `appearance | notify | pet | connect | storage | about`

New tabs:

| Key        | Title   | Purpose                                              | Source data            |
|------------|---------|------------------------------------------------------|------------------------|
| `models`   | Models  | Provider catalog, default model, API key vault       | new `modelsStore.ts`   |
| `channels` | Channels| IM integrations (Discord/Slack/Telegram/Feishu)      | new `channelsStore.ts` |
| `mcp`      | MCP     | MCP server list, enable/disable, restart             | new `mcpStore.ts`      |
| `workspace`| Workspace | Workspace path, indexing options, ignore patterns  | existing managedFiles  |

Each new tab is a standalone component file: `src/components/settings/{Models,Channels,Mcp,Workspace}Panel.tsx`, mounted in the same way as existing `ThemePicker`.

### 2.7 Workspace packages

```yaml
# pnpm-workspace.yaml (FIX — currently has no `packages:` list)
packages:
  - 'packages/*'
```

```json
// packages/shared-tokens/package.json (NEW)
{
  "name": "@junqi/shared-tokens",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    "./css/*": "./src/*.css",
    ".": "./src/index.ts"
  }
}
```

Then in root `package.json`:

```json
"dependencies": {
  "@junqi/shared-tokens": "workspace:*"
}
```

---

## 3. Invariants

These MUST hold at every point in time. Linter + tests enforce.

1. **`document.documentElement[data-theme]` is set before first paint.** The synchronous `earlyBootstrap()` call in `main.tsx` line 27 is non-negotiable. Tests assert via DOM inspection at `<script>` execution boundary.

2. **The 4 ThemeInputs uniquely determine all 25+ CSS vars.** Given the same input, `deriveThemeVariables` produces identical output. Property-based test: `derive(preset).deepEqual(derive(preset))`.

3. **`accentColor` writes happen AFTER preset vars are applied.** Order in `applyTheme`: preset vars → `accentColor` overrides on `--aegis-primary*`. Otherwise preset's primary bleeds through.

4. **Gateway log buffer never exceeds 200 entries.** Insertion path: push then truncate to 200. Property test: insert 1000, length === 200, oldest evicted.

5. **Docker fallback is debounced: never more than once per 60s.** Stored in `GatewayProcess` state. A `tokio::sync::Mutex<Instant>` of last-attempt time.

6. **No theme module reaches across into services/stores.** Verified by `eslint-plugin-boundaries` (or a custom import-restrictions rule).

7. **Status poller does NOT see a flap during restart.** Already handled by `restarting` flag — preserved.

---

## 4. Behavior rules

### 4.1 Theme application flow

```
boot:
  earlyBootstrap()
    → read localStorage.aegis-theme (or 'system')
    → resolveTheme(setting, osPreference)
    → applyTheme(resolved)            // sets data-theme + writes 25 CSS vars + native title bar

setTheme(newSetting):                  // user action
  validate(isThemeSetting)
  localStorage.setItem('aegis-theme', newSetting)
  applyTheme(resolveTheme(newSetting, currentOsPreference))

accentColor change:
  setAccentColor(color)                // in settingsStore
    → applyAccentOverride(color)       // writes --aegis-primary* on top of preset vars
                                        // does NOT re-apply preset (preserves other vars)

OS preference flips (user on 'system'):
  usePrefersDark() returns new value
  useTheme() recomputes → useEffect fires applyTheme()
```

### 4.2 Gateway error recovery flow

```
boot → ensure_gateway_running():
  1. If GatewayProcess.child.is_some() && healthz(port) == 200 → return Native/healthy
  2. If docker container present && healthz(dockerPort) == 200 → return Docker/healthy
  3. If docker container present but stopped → docker start + retry healthz (30s)
  4. If no docker but `openclaw` binary on PATH → spawn native + retry healthz (10s)
  5. Else → Unavailable + show UI banner with "Install Docker" / "Install openclaw"
  Debounce: if called again within 60s and previous attempt succeeded, return cached.
```

### 4.3 Log capture flow

```
Child process spawned:
  spawn_task reads stdout → for each line → gateway_logs.push({source: ChildStdout, ...})
  spawn_task reads stderr → for each line → gateway_logs.push({source: ChildStderr, ...})

Docker container started:
  after dockerGatewayStatus==true, spawn `docker logs -f maxauto-openclaw` → push to buffer

Lifecycle events:
  start_gateway, stop_gateway, restart_local_gateway, ensure_gateway_running
  → push {source: Lifecycle, level: Info|Warn|Error, message: "..."} on each transition

Frontend:
  Settings → Storage tab → "Gateway Log" section
    → on mount: invoke('get_gateway_logs', {limit:200})
    → button "Refresh" re-invokes
    → button "Clear" invokes 'clear_gateway_logs'
    → auto-refresh every 5s while tab is open
```

---

## 5. Acceptance criteria

| #  | Task                         | Acceptance test                                                                                                                              |
|----|------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| T1 | HSL derivation               | `deriveThemeVariables(THEME_PRESETS['aegis-dark'])` produces output that matches the current `aegis-dark.css` ±2 per RGB channel on all 25 vars. Regression test: render `applyTheme('aegis-dark')`, screenshot diff against baseline. |
| T2 | 10 presets render            | Each of 10 presets selectable in `ThemePicker`; none crash; first paint <100ms with each. Unit: `THEME_PRESETS` has all 10 keys with valid hex+contrast 0..1. |
| T3 | Anti-flash                   | With `localStorage.aegis-theme='aegis-midnight'`, capture DOM at `<head>` parse → attribute `data-theme="aegis-midnight"` already present. Manual: launch with theme=midnight, no flash. |
| T4 | Settings 10 tabs             | Each tab mounts without crash; navigation via keyboard (arrow keys) works; deep-linkable URL `?tab=models`. |
| T5 | Gateway 200-entry buffer     | Spawn gateway; insert 1000 fake log entries via test; `get_gateway_logs(500).len === 200`, oldest 800 evicted. Order is FIFO (oldest first). |
| T6 | Docker fallback              | Kill native gateway 3× within 10s; on 4th boot, `ensure_gateway_running` returns `mode: Docker` with `attempted_fallback: true`. No flap (debounced 60s). |
| T7 | Workspace package            | `pnpm install` resolves `@junqi/shared-tokens`; `import { ... } from '@junqi/shared-tokens'` works in src/; CSS imported once in `index.css` via `import '@junqi/shared-tokens/css/brand-oklch'`. |
| T8 | Module boundary enforcement  | `eslint-plugin-boundaries` (or equivalent custom rule) configured; CI fails on `theme/*` → `services/*` import. |
| T9 | Performance                  | Theme switch end-to-end <50ms on M1; `get_gateway_logs(200)` IPC roundtrip <20ms. |

---

## 6. Migration plan

To avoid a big-bang break, the change is staged so each step keeps the app bootable:

1. **M1 (no UI change):** Add `deriveThemeVariables`, `THEME_PRESETS`, new types. Tests only.
2. **M2 (CSS-only):** Replace `aegis-dark.css` etc. content with `applyDerivedVars('aegis-dark')` output (literal values, identical to today). Visual diff = zero.
3. **M3 (live derivation):** Wire `applyTheme` to call `applyDerivedVars` instead of relying on CSS files. Delete the 4 hand-written `aegis-*.css` files. Visual diff still zero (same values).
4. **M4 (preset expansion):** Add 6 new presets. Update `ThemePicker` to a 2×5 grid.
5. **M5 (settings tabs):** Add Models / Channels / MCP / Workspace panels (stubs acceptable, non-crashing).
6. **M6 (gateway logs):** Add `LogEntry` capture paths, IPC, frontend viewer.
7. **M7 (docker fallback):** Add `ensure_gateway_running`, wire into boot.
8. **M8 (workspace packages):** Fix `pnpm-workspace.yaml`, declare `@junqi/shared-tokens`, import in `index.css`.

---

## 7. Resolved decisions

- **Q1 ✅** Sub-router: `/settings/{appearance|notify|pet|connect|storage|about|models|channels|mcp|workspace}`.
- **Q2 ✅** New i18n keys for the 6 new presets; existing 4 keep their keys. (TBD in M4 — minimal new strings.)
- **Q3 ✅** Auto-start Docker container on healthz failure; show a toast `gateway.mode.switched` to inform the user. No confirmation dialog.
- **Q4 ✅** Leave `shared-ui` package alone (only node_modules present, no source); only fix `shared-tokens`.
- **Q5 ✅** Commit `packages/shared-tokens/` and `packages/shared-ui/` (the latter with `.gitkeep` so the directory stays). The workspace fix in pnpm-workspace.yaml depends on this.

---

## 8. Out of scope (explicit)

- Migrating the rest of `aegis-light.css / aegis-eyecare.css / aegis-midnight.css` to fully derived form beyond M2 (visual diff identical).
- Rewriting `ThemePicker` visual design (only structural change to fit 10 presets).
- New model provider catalog (the panel will be a stub reading from existing config).
- New IM channel integrations (panel is a stub listing currently-supported channels).
- MCP server runtime (panel is a stub reflecting existing servers list).
- Refactoring `App.tsx` (no change needed for this scope).

---

## 9. Approval record

- **Spec content:** ✅ approved (Q1–Q4 user-decisions accepted, Q5 default accepted)
- **Migration plan M1–M8:** ✅ single PR, sequential commits
- **Next action:** begin M1 — `derive.ts` (pure math) + `presets.ts` + tests, no UI change.