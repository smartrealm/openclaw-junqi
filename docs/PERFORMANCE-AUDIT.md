# Performance Optimization Audit

Last updated: 2026-07-08

## Method

- Built production assets with source maps:
  - `pnpm exec vite build --sourcemap`
- Parsed `dist/assets/*.js.map` to identify source-level contributors per chunk.
- Checked generated build logs for Rollup execution-order warnings:
  - no `Circular chunk`
  - no `Generated an empty chunk`
- Classified candidates by:
  - user-visible route or global path
  - lazy-loaded vs startup/preloaded
  - estimated benefit
  - regression risk

## Current High-Level Findings

Most large dependencies are already isolated behind lazy route or feature boundaries:

| Chunk | Size | Gzip | Classification | Decision |
| --- | ---: | ---: | --- | --- |
| `pdfjs` | ~513 KB | ~156 KB | File/PDF preview only | Keep isolated; do not split further. |
| `xterm` | ~468 KB | ~123 KB | Terminal only | Keep isolated; now loads only when terminal mounts. |
| `charts-recharts` | ~302 KB after React split | ~86 KB | Analytics/Dashboard charts | Keep route/section lazy; no broad changes. |
| `codemirror-core` | ~408 KB | ~133 KB | File/editor surfaces | Keep isolated; language chunks already split. |
| `app-core` | ~340 KB | ~114 KB | Shared gateway/store/i18n | Candidate for careful future work only. |
| `motion` | ~117 KB after React split | ~39 KB | Pet/page animations | Keep for page/pet routes; no global trigger. |
| `markdown` | ~157 KB | ~48 KB | Markdown rendering | Already lazy through message/file previews. |
| `syntax-highlighter` | ~115 KB | ~35 KB | Code blocks | Do not split further for now; prior language split produced poor tradeoffs. |

## Changes Kept

### Terminal / Agent

- `src/components/Workspace/WorkspaceView.tsx`
  - Shell and agent panes now lazy-load `ShellTerminalPanel` and `AgentRunView`.
  - Prevents workspace shell from statically pulling terminal/agent-heavy modules.

- `src/pages/AgentRunView.tsx`
  - `@xterm/xterm`, fit addon, unicode addon, and xterm CSS now load when the terminal container is mounted.
  - Agent setup/config UI no longer eagerly loads xterm.

### Motion Triggers

- `src/components/Toast/ToastContainer.tsx`
  - Replaced `framer-motion` with CSS transitions/keyframes.
  - Toasts can appear without loading `motion`.

- `src/components/Chat/InlineButtonBar.tsx`
  - Replaced `motion.div` with CSS keyframe entry animation.

- `src/components/Chat/QuickReplyBar.tsx`
  - Replaced `AnimatePresence` / `motion.button` with CSS animation and `active:scale`.

- `src/components/CommandPalette.tsx`
  - Replaced `framer-motion` overlay/panel animation with CSS keyframes.

### Vendor Boundary

- `vite.config.ts`
  - Added `react-vendor` manual chunk for:
    - `react`
    - `react-dom`
    - `scheduler`
    - `use-sync-external-store`
  - This prevents React runtime exports from being hosted by the `motion` chunk.
  - After this change, the main App chunk statically imports `react-vendor`, not `motion`.

### Config Manager

- `src/pages/ConfigManager/providerConnectionTest.ts`
  - Extracted provider connection precheck helpers out of `ProvidersTab.tsx`.
  - This lets the Config Manager route keep save-time connection checks without eagerly loading the full Providers tab UI.

- `src/pages/ConfigManager/index.tsx`
  - Lazy-loads `ProvidersTab`, `AgentsTab`, `ChannelsTab`, `ToolsTab`, `AdvancedTab`, and `SecretsTab`.
  - Keeps the existing tab props and save/precheck flow unchanged.

Observed production build after the change:

- Config Manager route chunk: `index-BkY0dWDU.js`, ~78 KB / gzip ~22 KB.
- Providers tab chunk: `ProvidersTab-li8Uf18F.js`, ~65 KB / gzip ~16 KB.
- Other config tabs are split into their own chunks (`AgentsTab`, `ChannelsTab`, `ToolsTab`, `AdvancedTab`, `SecretsTab`).

### Chat Input Interaction Panels

- `src/components/Chat/MessageInput.tsx`
  - Lazy-loads `VoiceRecorder` only when voice recording mode opens.
  - Lazy-loads `ScreenshotPicker` only when the screenshot picker opens.
  - Keeps emoji picker behavior unchanged; it already lazy-loads `@emoji-mart` data after opening.

Observed production build after the change:

- `MessageInput`: ~53 KB / gzip ~16 KB, down from ~65 KB / gzip ~19 KB.
- `VoiceRecorder`: ~9 KB / gzip ~4 KB, loaded on record.
- `ScreenshotPicker`: ~9 KB / gzip ~4 KB, loaded on screenshot.

### Message Bubble Media

- `src/components/Chat/MessageBubble.tsx`
  - Lazy-loads `ChatImage`, `ChatVideo`, `AudioPlayer`, and `SystemNoteBubble`.
  - Plain text messages no longer eagerly load image/video/audio UI.
  - Fallbacks reserve lightweight media space during lazy loading.

Observed production build after the change:

- `MessageBubble`: ~28 KB / gzip ~9 KB, down from ~44 KB / gzip ~13 KB.
- Media chunks now load only when needed:
  - `ChatImage`: ~8 KB / gzip ~3 KB
  - `ChatVideo`: ~6 KB / gzip ~2 KB
  - `AudioPlayer`: ~6 KB / gzip ~3 KB
  - `SystemNoteBubble`: ~2 KB / gzip ~1 KB

### I18n Vendor Boundary

- `vite.config.ts`
  - Added `i18n-vendor` manual chunk for `i18next` and `react-i18next`.
  - Keeps translation runtime cacheable and removes it from the gateway/store-heavy `app-core` chunk.

Observed production build after the change:

- `app-core`: ~290 KB / gzip ~97 KB, down from ~340 KB / gzip ~114 KB.
- `i18n-vendor`: ~50 KB / gzip ~16 KB.

## Items Intentionally Not Optimized Further

### Pet Window Motion

The main-window `PetRuntime` is only hook wiring and does not import `framer-motion`. The heavier animated pet UI is rendered by the separate pet window (`PetWindow`) or break overlay.

Decision: do not rewrite pet animations unless there is measured pet-window performance trouble or `motion` becomes part of the normal app startup path again.

### React Syntax Highlighter

Attempted approach:

- dynamically load Prism language modules
- split language chunks

Observed issue:

- splitting `refractor/lang/*` created Rollup circular chunk warnings
- wrapper chunks increased request count
- benefit was not clean enough

Decision: keep current lazy `CodeBlock` boundary and do not split syntax highlighting further.

### PDF.js / Xterm / CodeMirror / Recharts

These are large but already isolated. Splitting internals would likely add request count, complicate execution order, or fight library packaging.

Decision: only revisit if a specific route has measured slow interaction.

## Future Candidates

### `app-core`

Current contributors from sourcemap:

- `i18next`
- `chatStore`
- `gateway/ChatHandler`
- `gateway/Connection`
- Tauri API helpers

Potential work:

- split pure i18n initialization from gateway/chat runtime
- reduce shared store imports in boot paths
- inspect `chatStore` for logic that can move behind route-level boundaries

Risk:

- high, because previous store/gateway splits can produce execution-order cycles.

Decision:

- i18n vendor split completed.
- Do not split `chatStore` / gateway internals without a dedicated execution-order audit.

### Icons / ChatView

Findings:

- `icons` is primarily the shared semantic icon registry and Phosphor provider/agent palette.
- lucide icons are already emitted as small per-icon chunks.
- `ChatView` is dominated by `react-virtuoso`; splitting it would mostly move bytes into a vendor chunk without reducing the chat route's total required code.

Decision:

- Do not split `shared/icons.tsx` further in this pass; the registry is widely shared and the risk is not justified by current evidence.
- Do not split `react-virtuoso` just to reduce the named `ChatView` chunk; it would add a request without a clear route-load win.

## Validation

Latest validation after kept changes:

- `pnpm lint`: passed
- `pnpm test`: passed
- `pnpm build`: passed
- build log check: no circular or empty chunk warnings
