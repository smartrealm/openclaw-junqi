# Nezha Visual DNA — Design System Port Plan

> **Status**: design contract
> **Source**: hanshuaikang/nezha (mirrored under `src/_nezha_root/`,
> `src/components/nezha/`, `src/styles/nezha/`, `src/hooks/nezha/`,
> `src-tauri/src/nezha/`)
> **Target**: openclaw-junqi (this repo)
> **Branch**: `feat/port-nezha-fullsuite`
>
> **See also**: 功能 / UI 交互盘点见 [`NEZHA-FEATURES-AND-UI.md`](./NEZHA-FEATURES-AND-UI.md)。

This document is the authoritative specification for porting nezha's
visual language into this codebase. Every claim has a citation
(`nezha/path/to/file.css:line`) so the audit is reproducible.

The "why" lives here. The "how" lives in the milestone sections.
PRs that touch surface-level visuals MUST cite a rule from this doc
or explain why they deviate.

> **文档分工**：
> - 本文档负责**视觉设计系统**（颜色、间距、排版、六维设计纪律）。
> - `NEZHA-FEATURES-AND-UI.md` 负责**功能模块与 UI 交互盘点**（含覆盖度矩阵）。
> 两者职责互不重叠，PR 同时涉及视觉与功能时应在两份文档中分别引用。

---

## 0 — Why this doc exists

User feedback, repeatedly:

> "线条和展示的 ui，为啥看着很舒服，很美，咱们的始终差点"
> (their lines and UI look comfortable and beautiful, ours always
> falls short.)

The gap isn't taste. It's six concrete design disciplines that
nezha applies consistently and we apply unevenly. This doc names
the six, measures our delta, and schedules the close.

---

## 1 — The six disciplines

### 1.1 Color — paper-stack, not glass-stack

**nezha** treats each surface as opaque paper laid on top of the
previous paper. Layers separate via 1px hairlines, never via blur.

| Surface | Light (nezha) | Dark (nezha) | Source |
|---|---|---|---|
| `--bg-root` | `hsl(240 6% 99.4%)` (≈#fdfdfe) | `#1d212a` | `themes.css:3,193` |
| `--bg-sidebar` | `#fdfdfd` | `#242a35` | `themes.css:6,196` |
| `--bg-sidebar-elevated` | `#fafafa` | `#202631` | `themes.css:7,197` |
| `--bg-panel` | `#ffffff` | `#2b313d` | `themes.css:8,198` |
| `--bg-card` | `#ffffff` (opaque) | `#313847` (opaque) | `themes.css:9,199` |

**ours** uses `bg-aegis-glass: rgba(43,49,61,0.72)` + `backdrop-blur-xl`
on cards. Looks fancy in screenshots, fights for focus in dense UI.

**Rule (P0)**: any persistent surface uses an OPAQUE token. Reserve
`backdrop-blur` for floating overlays (popover, dialog, command
palette) and titlebar/sidebar drag regions only.

### 1.2 Lines — every group is wrapped in a 1px hairline

This is the single biggest reason nezha "looks tight."

Survey of nezha's border use (citations from `layout.ts`, `common.ts`):

- `searchBox`: `1px solid border-medium`, `borderRadius: 12`
- `composeCard`: `1px solid border-medium`, `borderRadius: 24`
- `sidebar` (right edge): `borderRight: 1px solid border-dim`
- `sidebarBrand` (bottom): `borderBottom: 1px solid border-dim`
- `sidebarFooter` (top): `borderTop: 1px solid border-dim`
- `searchRow` (bottom): `borderBottom: 1px solid border-dim`
- `usagePopoverHeader` (bottom): `borderBottom: 1px solid border-dim`

The pattern: **every semantic group gets one line on the side that
separates it from the neighbor**. Lines are structural language,
not decoration.

Nezha runs three border tints (`--border-dim/medium/strong`,
`themes.css:15-18`) and never crosses into glow-edge / gradient-
divider territory.

**ours**:
- Dividers via `linear-gradient(90deg, transparent, primary/20%,
  transparent)` (`index.css:300, 376`)
- `nav-icon-active-glow` background + `shadow-glow-sm` instead of
  borders (`NavSidebar.tsx`, pre-port commit)
- Bordered components mix shimmer-edge with the border (`GlassCard.tsx`)

**Rule (P0)**: divider = `1px solid var(--aegis-border)`. Delete
`.divider-gradient`. No gradient lines except inside `prose / .markdown-body hr`.

### 1.3 Typography — half-step ramp

Inventory of nezha font sizes seen across `common.ts` /
`layout.ts` / `panels.ts` / `font.ts`:

```
9.5  →  metric-meta
10.5 →  branch-badge, project-tag
11   →  brand-mark, sidebar-section-title, badge
11.5 →  popover-title, thanks-name, project-meta, font-preview-meta
12   →  meta-chip, brand-meta, font-preview-label
12.5 →  new-task-meta
13   →  popover-content, font-section
13.5 →  primary-action, body
14   →  project-name, project-section-title
15   →  search-input
16   →  brand-title
22   →  page-title
```

Five **half-step** sizes (9.5 / 10.5 / 11.5 / 12.5 / 13.5). These
exist because dense tool UIs need micro-deltas — `11px meta` vs
`12px chip` is more separation than the eye should have to make.

Weight ramp likewise includes a half-step: `500 / 600 / 650 / 700 / 800`.
`fontWeight: 650` (`layout.ts:projectName`) is the canonical "list
item title" weight — heavier than meta-data 600, lighter than
section-heading 700.

**ours**: integer sizes only (`text-[11px]/[12px]/[13px]/[14px]`),
integer weights (`font-normal/medium/semibold/bold`).

**Rule (P1)**: introduce Tailwind utilities for the half-steps:
`text-[9.5px] text-[10.5px] text-[11.5px] text-[12.5px] text-[13.5px]`
and `font-[650]`. Migrate density-critical surfaces first
(sidebars, list items, badges, popovers).

Font stacks:
- nezha UI: `"SF Pro Display", "IBM Plex Sans", "PingFang SC", "Noto Sans SC", sans-serif`
- nezha mono: `"JetBrains Mono", "Fira Code", "Cascadia Mono", Consolas, "SF Mono", Menlo, ui-monospace`
- Ours UI: same + adds `"IBM Plex Sans Arabic", "Segoe UI", system-ui` (keep ours — Arabic + Windows fallback are real needs)
- Ours mono: same

Font *user choice* is missing: nezha ships `FontPanel` +
`FontSelector` + `get_system_fonts` Rust command
(`src-tauri/src/system.rs` → command name `get_system_fonts`). We
do not. **M2 ports the whole pipeline**.

### 1.4 Shadows — almost none

Nezha's shadow tokens, total **nine** (`themes.css:120-131`):

| Token | Use |
|---|---|
| `--shadow-xs` | primary action button rest |
| `--shadow-sm` | small popovers |
| `--shadow-md` | usage popover (floats over content) |
| `--shadow-popover` | popovers + tooltips |
| `--shadow-drawer` | side drawer slide-in |
| `--shadow-compose` | the ONE big card (new task composer) |
| `--shadow-control` | inset on toggles |
| `--shadow-switch-thumb` | switch knob |
| `--shadow-toast` | toasts |
| `--shadow-media` | image / video lightbox |

**Cards have no shadow**. They sit on the panel via border-only.
Hover doesn't add shadow — hover only swaps `background → bg-hover`.

**ours**: 30+ shadow utilities including `shadow-glow-sm/md/lg`,
`shadow-inner-glow`, plus per-component custom shadows. GlassCard
hovers with `whileHover={{ y: -2 }}` plus shadow change.

**Rule (P0)**: cap shadow inventory to nezha's nine (renamed under
our existing prefixes). Drop `shadow-glow-*` from any persistent
surface; allow them only on the FAB or the running-task badge
("attention" signals).

### 1.5 Radii — three sizes, one outlier

```
--radius-sm:  6px   icon buttons, badges, small inputs
--radius-md:  8px   buttons, search-input variants
--radius-lg: 12px   cards, search box, popovers
            24px    HARD-CODED, only used on composeCard — the one
                    "stage" surface (task composer)
```

(`themes.css:133-135`, `panels.ts:composeCard`)

**ours** uses `rounded-xl / 2xl` (12 / 16) for ~everything, with
zero hierarchy.

**Rule (P0)**: standardize on 6 / 8 / 12 with 24 reserved for one
designated "primary surface" per page (e.g. the chat composer).

### 1.6 Motion — quiet

Nezha's CSS contains **two** keyframe sets, both functional:

- `pulse` (status dot)
- `spin` (loading)

Hover transitions: `0.16-0.18s ease`, only on `background` and
`border-color`.

**ours** (`index.css`):

```
fadeIn, slideUp, slideDown, slideInRight, pulseSoft, pulseRing,
typingDot, shimmer, bounceSubtle, glowPulse, glowTeal, glowGreen,
glowAccent, dotPulse, beacon, shimmerEdge, float, iconGlow,
sparkDot, statusPulse, fabRotate, fabBeacon, agentGlow,
connectedPulse, particleLine, waveScroll, waveScan,
borderRun, borderPulse, thinking-border-shimmer
```

Plus 10+ `.animate-*` classes auto-applied via JSX (`.fab-glow`,
`.card-shimmer-edge`, `.connected-glow`, `.nav-icon-active-glow`,
`.agent-glow-ring`, etc.).

**Rule (P0)**: keep only the functional set:
- `pulse` / `pulseSoft` (status indicators)
- `spin` / `spin-slow` (loaders)
- `typingDot` (chat typing indicator)
- `fadeIn` / `slideUp` (modal/toast enter)
- `shimmer` (skeleton)
- `thinking-border-shimmer` (streaming border on the message bubble — *productive* signal)

Delete the rest. Replace decorative `whileHover={{ y: -2 }}` with
pure `bg-hover` swap. No FAB glow. No nav-icon halo.

---

## 2 — Gap matrix

| ID | Discipline | Defect | Fix | Files touched | M |
|---|---|---|---|---|---|
| **G1** | Color | GlassCard uses translucent + backdrop-blur on every persistent surface | Rewrite `GlassCard` to opaque `bg-aegis-card` + `1px border`; reserve glass for `Dialog/Popover/CommandPalette` | `components/shared/GlassCard.tsx` | M1 |
| **G2** | Color | Sidebar is flat color | Add `--aegis-surface-elevated` token (1 step deeper than `--aegis-surface`) and apply `linear-gradient(180deg, surface, surface-elevated)` to sidebar | `styles/themes/*.css`, `components/Layout/NavSidebar.tsx` | M1 |
| **G3** | Lines | Dividers use gradient | `divider-gradient` → flat `1px solid var(--aegis-border)`; remove `nav-icon-active-glow` shadow | `styles/index.css`, all consumers | M1 |
| **G4** | Typography | No user font choice | Port `FontSelector.tsx`, `FontPanel.tsx`, `utils/fonts.ts`, add `get_system_fonts` Tauri command, persist `--font-ui` / `--font-mono` to localStorage, apply at boot via `theme/earlyBootstrap.ts` | `components/settings/`, `src-tauri/src/commands/`, `theme/` | M2 |
| **G5** | Typography | Integer-only size/weight ramp | Add Tailwind arbitrary values `text-[9.5px] / [10.5px] / [11.5px] / [12.5px] / [13.5px]` and `font-[650]`; migrate sidebars, list items, badges, popovers | global search + adjust | M2 |
| **G6** | Motion | 20+ decorative keyframes | Delete `glowPulse/glowTeal/glowGreen/glowAccent/dotPulse/beacon/shimmerEdge/float/iconGlow/sparkDot/fabBeacon/agentGlow/connectedPulse/particleLine/waveScroll/waveScan/borderPulse` and their `.animate-*` classes | `styles/index.css`, JSX call sites | M1 |
| **G7** | Radii | Everything `rounded-xl/2xl` | Standardize 6/8/12; reserve `2xl` for the chat composer surface | global; mostly `components/ui/` + `Chat/` + `shared/` | M1 |
| **G8** | Motion | `whileHover={{ y: -2 }}` on cards | Remove translate-Y; replace with `bg-aegis-hover` swap | `components/shared/GlassCard.tsx`, `pages/SettingsPage.tsx` cards | M1 |

---

## 3 — Token changes (additions / renames / deletions)

### 3.1 Add

```css
/* aegis-light.css + aegis-dark.css + aegis-midnight.css + aegis-eyecare.css */
--aegis-surface-elevated: <one step deeper than --aegis-surface>;
--aegis-hover:            <bg swap on row/card hover>;
--aegis-input:            <input field background — opaque>;

/* primitives.css */
--font-ui-stack:    "SF Pro Display", "IBM Plex Sans", "IBM Plex Sans Arabic", "PingFang SC", "Noto Sans SC", "Segoe UI", system-ui, sans-serif;
--font-mono-stack:  "JetBrains Mono", "Fira Code", "Cascadia Mono", Consolas, "SF Mono", Menlo, ui-monospace, monospace;

/* user-overridable; set by FontPanel via document.documentElement.style.setProperty */
--font-ui:   var(--font-ui-stack);
--font-mono: var(--font-mono-stack);

/* index.css @theme */
--radius-2xl:  1rem;   /* ALREADY EXISTS — restrict its use to the composer surface */
```

Concrete values per theme (matches nezha):

| | light | dark | midnight | eyecare |
|---|---|---|---|---|
| `--aegis-surface-elevated` | `#fafafa` | `#202631` | `#1f2123` | `#f3e9cf` |
| `--aegis-hover` | `hsl(240 6% 97.7%)` | `#394154` | `#26282b` | `#ede2c4` |
| `--aegis-input` | `#ffffff` | `#343b4a` | `#222427` | `#fdf9ec` |

### 3.2 Delete

```
/* index.css */
--shadow-glow-sm
--shadow-glow-md
--shadow-glow-lg
--shadow-inner-glow
--shadow-glass
--shadow-glass-lg
--animate-glow-pulse
--animate-glow-teal
--animate-glow-green
--animate-glow-accent
--animate-dot-pulse
--animate-beacon
--animate-shimmer-edge
--animate-float
--animate-icon-glow
@keyframes glowPulse, glowTeal, glowGreen, glowAccent, dotPulse,
           beacon, shimmerEdge, float, iconGlow, sparkDot,
           fabBeacon, agentGlow, connectedPulse, particleLine,
           waveScroll, waveScan, borderPulse
.card-shimmer-edge
.fab-glow
.nav-icon-active-glow
.icon-halo-teal / .icon-halo-green / .icon-halo-accent
.agent-glow-ring
.dot-beacon
.spark-dot-pulse
.toggle-glow-teal
.connected-glow
.text-gradient                ← keep only on the brand logo, nowhere else
```

### 3.3 Keep (functional motion)

```
@keyframes pulseSoft, typingDot, shimmer, fadeIn, slideUp,
           thinking-border-shimmer, statusPulse
```

---

## 4 — Milestones

### M1 — Visual Bones (≈half a day)

**Goal**: a screenshot of any page should be visually
indistinguishable from nezha at the surface/line/shadow/motion
level. Typography stays integer for this milestone.

**Tasks**:
1. **Token deltas**: add the three new tokens per theme; delete the
   excess shadow/animation tokens. (G3, G6)
2. **GlassCard rewrite**: opaque `bg-aegis-card`, `1px solid
   var(--aegis-border)`, no backdrop-blur, no shimmer edge, no
   whileHover translate. Hover swaps to `bg-aegis-hover` and bumps
   border to `border-hover`. (G1, G8)
3. **Sidebar gradient**: `NavSidebar.tsx` background switches to
   `linear-gradient(180deg, var(--aegis-surface), var(--aegis-surface-elevated))`. Keep right edge `1px solid var(--aegis-border)`. (G2)
4. **Divider replacement**: replace every `.divider-gradient` and
   `nav-icon-active-glow` / `card-shimmer-edge` / `fab-glow` JSX usage
   with flat-border equivalents. (G3, G6)
5. **Radii downshift**: global `rounded-2xl` → `rounded-xl` (except
   chat composer / dialog wrappers); `rounded-xl` on icon buttons
   and badges → `rounded-md` (6-8px). (G7)
6. **Motion purge**: delete keyframes / utility classes per §3.2.
   Audit JSX for orphaned class names (`grep` + Tailwind warning
   in build). (G6)

**Acceptance**:
- 0 occurrences of `backdrop-blur-xl` on a persistent card
- 0 occurrences of `whileHover={{ y:` (except modal/popover)
- 0 occurrences of `.divider-gradient` or `linear-gradient(90deg, transparent.*primary` in JSX
- `index.css` keyframe count drops to ≤8
- `npx tsc --noEmit` clean
- Visual diff: chat page, settings page, sidebar, command palette match nezha screenshots within
  small absolute-value pixel tolerance

### M2 — Typography (≈half a day)

**Goal**: user can pick UI and mono fonts in Settings → Theme; the
choice persists across launches and applies before first paint.
Half-step sizes deployed to information-dense surfaces.

**Tasks**:
1. **Tauri command**: port `get_system_fonts` from
   `src-tauri/src/nezha/system.rs` into our `src-tauri/src/commands/`
   tree. Cache result for the session. Return `Vec<String>`.
2. **Frontend utils**: port `src/_nezha_root/utils.ts` font helpers
   (`loadSystemFonts`, `parseFirstFontName`, `quoteFontName`,
   `filterFonts`) into `src/utils/fonts.ts`.
3. **FontSelector component**: port `components/nezha/app-settings/FontSelector.tsx`,
   rewriting nezha tokens (`--text-primary` etc.) to our
   `--aegis-*` tokens. Combobox with autocomplete over system fonts.
4. **FontPanel component**: port `components/nezha/app-settings/FontPanel.tsx`.
   Two `FontSelector` (UI / Mono) + live preview block + "Reset to
   defaults" button.
5. **Persistence layer**: extend `theme/` module:
   - New `theme/fonts.ts`: `getStoredFonts() / setStoredFonts() /
     applyFontsToDocument()`. Persist under `aegis-font-ui` and
     `aegis-font-mono` localStorage keys.
   - Extend `theme/earlyBootstrap.ts`: apply stored fonts to
     `documentElement.style.setProperty('--font-ui', ...)` before
     React mounts (eliminates FOUC).
6. **Store integration**: add `uiFont`, `monoFont`, `setUiFont`,
   `setMonoFont` to `useSettingsStore`. The setters call
   `applyFontsToDocument` and `window.aegis?.settings?.save?.()`.
7. **SettingsPage wiring**: mount `<FontPanel />` directly under the
   `<ThemePicker />` card.
8. **Half-step rollout** (G5): introduce Tailwind utilities for
   `text-[9.5px / 10.5px / 11.5px / 12.5px / 13.5px]` and
   `font-[650]`. Migrate the following surfaces to half-steps:
   - `NavSidebar` (item label → 13.5/650; section title → 11/700 uppercase tracking)
   - `TopBar` (any meta chips → 11.5)
   - `pages/Settings*` cards (h3 → 13.5/650; body → 12.5)
   - Chat MessageBubble meta row (timestamp / model → 10.5)
   - Toast / Tooltip / Popover internals → 11.5/12

**Acceptance**:
- `Settings → Theme` shows a Fonts subsection with two combo boxes
- Picking a font flips both the live UI AND the chat content within ~16ms
- App restart preserves the choice; first paint uses it (no FOUC)
- localStorage keys `aegis-font-ui`, `aegis-font-mono` set
- Half-step utilities appear in at least 5 components
- `cargo check` clean; `npm run build` clean

### M3 — Git subsystem (out of scope this PR; pre-spec)

Will port `git.rs` + `GitChanges` + `GitHistory` + `GitDiffViewer`
under `/git` route. Tracked in a follow-up issue.

### M4 — File subsystem (pre-spec)

Will port `fs.rs` + `FileExplorer` + `FileViewer`; integrate or
replace the existing `pages/FileManager.tsx`. Tracked in a
follow-up.

### M5 — Terminal upgrade (pre-spec)

Will port `pty.rs` improvements + `ShellTerminalPanel` (multi-session)
+ `TerminalView` + xterm patches.

---

## 5 — Risk register

| Risk | Mitigation |
|---|---|
| Removing `--shadow-glow-*` breaks visual contracts elsewhere (status indicators) | M1 task 6 includes a JSX audit; surviving usages migrate to a single `--shadow-attention` token explicitly named for that role |
| Half-step font sizes break Tailwind purge (arbitrary values) | Tailwind v4 already supports `text-[X.5px]` natively; no config change |
| `get_system_fonts` slow on first call (Windows enumerates registry) | Cache in `OnceCell<Vec<String>>` for session lifetime; nezha's reference does this |
| RTL: Arabic font stack must still resolve | Keep `"IBM Plex Sans Arabic"` in the default UI stack; FontPanel's "Reset" returns to the platform default stack, not nezha's literal stack |
| Theme switching jank reappears when fonts change at runtime | `applyFontsToDocument` reuses the same `theme-switching` class suppression already in `theme/apply.ts` |

---

## 6 — Definition of Done

This document is "done" when:

1. Every gap row in §2 has a corresponding commit on `feat/port-nezha-fullsuite` whose subject begins with the gap ID.
2. The acceptance criteria in §4 M1 and M2 are all checked.
3. A side-by-side screenshot pair (nezha vs ours) is attached to the PR for: chat page, settings page, sidebar, command palette.
4. `npx tsc --noEmit` + `npm run build` + `cargo check` all clean from a fresh clone.

---

*Authored: 2026-06-21. Owner: Wei. Reviewer: design.*
