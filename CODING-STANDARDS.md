# JunQi Desktop — Coding Standards

> **Version**: 1.0.0 · **Applied to**: v0.5.0+ · **Enforcement**: all code MUST comply

---

## 0. Guiding Principles

| Principle | Meaning |
|-----------|---------|
| **Single Responsibility** | One file = one concern. One function = one thing. |
| **Don't Repeat Yourself** | Shared logic lives in exactly one place. |
| **Type Safety First** | No `any` escapes without documented justification. |
| **Fail Loudly, Recover Gracefully** | Errors are typed, matchable, and surfaced. |
| **Platform-Agnostic Core** | OS conditionals live in one central module, never scattered. |
| **Bundle Economy** | Every import costs bytes. Lazy-load what you can. |

---

## 1. File & Module Structure

### 1.1 Size Limits (Hard)

| Language | Max lines per file | Action if exceeded |
|----------|-------------------|---------------------|
| Rust | 300 | Split into submodules under `commands/<domain>/` |
| TypeScript/TSX | 400 | Extract hooks, utilities, or sub-components |
| CSS/Tailwind config | 200 | Split by concern |

### 1.2 Rust Module Layout

```
src-tauri/src/
├── main.rs                    # Entry point only (≤30 lines)
├── lib.rs                     # Plugin registration, app setup (≤120 lines)
├── error.rs                   # Unified Error enum + From impls
├── platform.rs                # All OS conditionals live HERE
├── paths.rs                   # desktop_dir(), config_path(), ALL path helpers
├── commands/
│   ├── mod.rs                 # Re-exports all public commands
│   ├── config.rs              # Config read/write (≤300 lines)
│   ├── gateway/
│   │   ├── mod.rs             # Re-exports
│   │   ├── commands.rs        # Tauri command handlers (thin wrappers)
│   │   ├── process.rs         # Child process lifecycle
│   │   ├── config.rs          # ensure_config_with_token, token generation
│   │   └── install.rs         # npm install / ensure_openclaw_installed
│   ├── docker.rs              # Docker gateway (≤300 lines)
│   ├── pairing.rs             # Device pairing (≤300 lines)
│   ├── setup.rs               # One-time setup wizard (≤400 lines)
│   └── system.rs              # Node/Git/OpenClaw checks (≤300 lines)
├── state/
│   ├── mod.rs
│   └── gateway_process.rs     # GatewayProcess state (≤50 lines)
└── tray/
    ├── mod.rs
    └── menu.rs                # Tray menu (≤80 lines)
```

### 1.3 TypeScript Module Layout

```
src/
├── api/
│   ├── tauri-adapter.ts       # Facade ONLY (≤200 lines), delegates to domain adapters
│   ├── tauri-commands.ts      # Typed invoke() wrappers
│   ├── tauri-gateway.ts       # Gateway-specific adapter
│   ├── tauri-files.ts         # File operations adapter
│   └── device-identity.ts
├── components/
│   ├── Chat/                  # One component per file (≤400 lines each)
│   ├── Layout/
│   └── shared/                # Reusable primitives
├── hooks/                     # One hook per file
├── pages/
│   ├── ConfigManager/         # Split into tabs + shared components + utilities
│   │   ├── index.tsx          # Router + tab switching only (≤150 lines)
│   │   ├── components.tsx     # Shared form components (≤400 lines)
│   │   ├── types.ts           # All ConfigManager types
│   │   ├── AgentsTab.tsx      # (≤500 lines)
│   │   ├── ProvidersTab.tsx   # Split into: (≤500 lines each)
│   │   ├── ChannelsTab.tsx
│   │   ├── ToolsTab.tsx
│   │   ├── AdvancedTab.tsx
│   │   ├── SecretsTab.tsx
│   │   ├── providerTemplates.ts
│   │   ├── providerModelSelection.ts
│   │   ├── providerTesting.ts   # Model testing utilities (extract from ProvidersTab)
│   │   ├── toolsProviderDetection.ts
│   │   └── toolsProviderMutation.ts
│   ├── FullAnalytics/         # Already well-structured — maintain this pattern
│   ├── Calendar/              # Already well-structured
│   └── ...
├── services/
│   └── gateway/
│       ├── index.ts           # Facade (≤200 lines)
│       ├── Connection.ts      # WebSocket lifecycle (≤400 lines)
│       ├── ChatHandler.ts     # Split into:
│       └── messagePipeline.ts # Message processing pipeline (extract from ChatHandler)
├── stores/                    # One store per domain (≤400 lines each)
├── types/                     # Shared types ONLY
├── utils/                     # Pure utility functions
└── locales/                   # i18n JSON
```

### 1.4 Barrel Exports

Every directory with >1 file MUST have an `index.ts` that re-exports the public API:

```typescript
// ✅ CORRECT
export { ChatView } from './ChatView';
export { MessageBubble } from './MessageBubble';
export type { ChatMessage } from './types';

// ❌ WRONG — consumers must know internal file names
import { ChatView } from '@/components/Chat/ChatView';
```

---

## 2. Design Patterns (Mandatory)

### 2.1 Rust Patterns

#### Error Type (REQUIRED)

```rust
// src-tauri/src/error.rs
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Configuration not found at {0}")]
    ConfigNotFound(PathBuf),

    #[error("Invalid configuration: {0}")]
    InvalidConfig(#[from] serde_json::Error),

    #[error("Process error: {0}")]
    Process(#[from] std::io::Error),

    #[error("Gateway not running")]
    GatewayNotRunning,

    #[error("{0}")]
    Other(String),
}

// All commands MUST return Result<T, AppError>
pub type AppResult<T> = Result<T, AppError>;
```

#### Path Helpers (REQUIRED — centralize in `paths.rs`)

```rust
// src-tauri/src/paths.rs — ONE source of truth for all paths
pub fn desktop_dir() -> PathBuf { ... }       // ~/.openclaw
pub fn config_path() -> PathBuf { ... }       // ~/.openclaw/openclaw.json — the ONLY gateway config
pub fn local_node_bin() -> PathBuf { ... }
```

> **Single config source (2026-06):** JunQi relies on the user's local OpenClaw,
> so `config_path()` (`~/.openclaw/openclaw.json`) is the one and only gateway
> config. There is no separate "isolated" config and no `standard_openclaw_config()`
> fallback helper — that dual-path design was removed (see ARCHITECTURE.md §7).

#### Platform Abstraction (REQUIRED — centralize in `platform.rs`)

```rust
// src-tauri/src/platform.rs
pub fn exe_name(base: &str) -> String {
    if cfg!(windows) { format!("{}.exe", base) } else { base.to_string() }
}

pub fn open_in_explorer(path: &Path) { ... }

pub fn suppress_window(cmd: &mut std::process::Command) { ... }
```

#### Command Builder Pattern (PREFERRED for gateway subprocesses)

```rust
struct GatewayCommand {
    cmd: tokio::process::Command,
}

impl GatewayCommand {
    pub fn new(binary: &Path) -> Self { ... }
    pub fn with_state_dir(mut self, dir: &Path) -> Self { ... }
    pub fn with_config(mut self, path: &Path) -> Self { ... }
    pub fn spawn(self) -> AppResult<tokio::process::Child> { ... }
}
```

### 2.2 TypeScript Patterns

#### Container/Presenter Split (REQUIRED for pages >400 lines)

```typescript
// Container — handles data, state, side effects
function useConfigManagerData() {
  const [config, setConfig] = useState<Config>(initial);
  useEffect(() => { /* fetch */ }, []);
  return { config, updateConfig, saveConfig };
}

// Presenter — renders UI from props ONLY
function ConfigManagerView({ config, onUpdate, onSave }: ConfigManagerProps) {
  return <div>...</div>;
}

// Page — composes them
export default function ConfigManagerPage() {
  const data = useConfigManagerData();
  return <ConfigManagerView {...data} />;
}
```

#### Custom Data-Fetching Hook (REQUIRED for any page with >1 API call)

```typescript
// Every page with data fetching MUST extract a hook:
function useMemoryExplorer() {
  const { data, loading, error, refresh } = useGatewayQuery('memory.list');
  return { memories: data, loading, error, refresh };
}
```

#### Error Boundary Per Route (REQUIRED)

```typescript
// In App.tsx — each lazy route gets its own boundary:
<ErrorBoundary fallback={<PageErrorFallback />}>
  <Suspense fallback={<PageSkeleton />}>
    <SettingsPage />
  </Suspense>
</ErrorBoundary>
```

#### Typed Gateway API (REQUIRED — eliminate all `any` from API layer)

```typescript
// types/gateway-api.ts
export interface GatewayAgent {
  id: string;
  name: string;
  model: string;
  workspace?: string;
}

export interface GatewaySession {
  sessionKey: string;
  topic?: string;
  agentId?: string;
  createdAt: number;
}

// services/gateway/index.ts
async function listAgents(): Promise<GatewayAgent[]> { ... }
async function createAgent(params: CreateAgentParams): Promise<GatewayAgent> { ... }
```

---

## 3. Type Safety

### 3.1 Rust

- **Every `#[tauri::command]`** returns `AppResult<T>`, never `Result<T, String>`.
- **No bare `.unwrap()`** on user-supplied data or I/O results. Use `?` or `.map_err()`.
- **No silent error drops** — every `let _ = ...` that drops a Result MUST have a comment explaining why the error is non-critical.

### 3.2 TypeScript

- **Zero `any` tolerance**: Every `any` requires a `// SAFETY:` comment and reviewer approval.
- **No `[key: string]: any`** in type definitions. Define concrete optional properties.
- **No `Record<string, any>`** — use `Record<string, unknown>` with type guards.
- **`window.aegis`** MUST have a type definition in `types/global.d.ts`:

```typescript
// types/global.d.ts
import type { AegisAPI } from './aegis-api';
declare global {
  interface Window {
    aegis: AegisAPI;
  }
}
```

---

## 4. Error Handling

### 4.1 Rust

```rust
// ✅ CORRECT — typed, matchable errors
pub async fn read_config() -> AppResult<ConfigData> {
    let path = config_path();
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Io(path.clone(), e))?;
    Ok(serde_json::from_str(&raw)?)
}

// ❌ WRONG — opaque string error
pub async fn read_config() -> Result<ConfigData, String> {
    let raw = std::fs::read_to_string(config_path())
        .map_err(|e| format!("Failed: {}", e))?;
    Ok(serde_json::from_str(&raw).map_err(|e| e.to_string())?)
}
```

### 4.2 TypeScript

```typescript
// ✅ CORRECT — typed result with discriminated union
type GatewayResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: number };

// ✅ CORRECT — try/catch with typed error logging
try {
  await gateway.connect();
} catch (err) {
  logError('gateway-connect', err);
  showToast(t('gateway.connectionFailed'));
}
```

---

## 5. Security (Hard Requirements)

### 5.1 CSP

CSP MUST NOT be `null`. Minimum policy:

```json
{
  "security": {
    "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; font-src 'self'"
  }
}
```

### 5.2 HTML Sanitization

- **`dangerouslySetInnerHTML`** is FORBIDDEN without DOMPurify sanitization.
- External content (API responses, skill READMEs, agent outputs) MUST be sanitized before HTML rendering.
- Prefer `react-markdown` with `rehype-sanitize` over raw HTML injection.

### 5.3 Path Validation

- All file paths from user input MUST be validated against allowed scopes.
- `open_folder(path)` MUST verify the path is within the user's home directory.

### 5.4 Token Generation

- Must use cryptographically secure random (Rust: `getrandom` crate or `OsRng`).

### 5.5 Build Configuration

- `devtools` Tauri feature MUST be gated: `#[cfg(debug_assertions)]` only.
- Unused Tauri plugins MUST be removed from Cargo.toml.

---

## 6. State Management (TypeScript)

### 6.1 Store Rules

- **One store per domain** — do NOT put everything in a single mega-store.
- **Max store size**: 400 lines.
- **No `getState()` in render paths** — it's for callbacks/event handlers only.

### 6.2 Store Split Strategy

Current `chatStore.ts` (1184 lines) MUST be split into:

| Store | Responsibility | Lines (max) |
|-------|---------------|-------------|
| `chatMessagesStore` | Messages, render blocks, streaming | 300 |
| `chatSessionsStore` | Session list, topics, model prefs | 300 |
| `chatTabsStore` | Tab state, typing indicators | 200 |
| `chatUIStore` | Scroll position, audio player, file browser | 200 |

---

## 7. Bundle Economy

### 7.1 Lazy Loading

- All route pages MUST use `React.lazy()` (already done ✅).
- Heavy non-route libraries MUST be dynamically imported:

```typescript
// ✅ CORRECT — lazy-load heavy library
const PdfViewer = lazy(() => import('./PdfPreview'));

// ✅ CORRECT — dynamic import for conditional feature
const { Terminal } = await import('@xterm/xterm');
```

### 7.2 Vite manualChunks

Every dependency >2 MB MUST be in `manualChunks`:

```typescript
// vite.config.ts
manualChunks: {
  'pdfjs': ['pdfjs-dist'],
  'recharts': ['recharts'],
  'syntax-highlighter': ['react-syntax-highlighter'],
  'markdown': ['react-markdown', 'remark-gfm'],
  'framer-motion': ['framer-motion'],
}
```

### 7.3 Icon Imports

```typescript
// ✅ CORRECT — tree-shakeable named import
import { Send, Settings, Trash2 } from 'lucide-react';

// ❌ WRONG — imports entire icon set
import * as Icons from 'lucide-react';
```

---

## 8. Naming Conventions

### 8.1 Rust

| Item | Convention | Example |
|------|-----------|---------|
| Modules | snake_case | `gateway_process` |
| Types/Structs | PascalCase | `GatewayProcess` |
| Functions | snake_case | `desktop_dir()` |
| Constants | UPPER_SNAKE | `MIN_NODE_VERSION` |
| Tauri commands | snake_case | `start_gateway` |

### 8.2 TypeScript

| Item | Convention | Example |
|------|-----------|---------|
| Files (components) | PascalCase | `MessageBubble.tsx` |
| Files (utilities) | camelCase | `formatDuration.ts` |
| React components | PascalCase | `function ChatView() {}` |
| Hooks | `use` prefix | `useKeyboardShortcuts` |
| Stores | `Store` suffix | `chatMessagesStore` |
| Types/Interfaces | PascalCase | `GatewayAgent` |
| Event handlers | `handle` prefix | `handleSendMessage` |
| Boolean vars | `is`/`has`/`should` prefix | `isStreaming` |

---

## 9. Import Order (TypeScript)

Enforced order, separated by blank lines:

```typescript
// 1. React / Router
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// 2. External libraries
import { motion } from 'framer-motion';
import { Send } from 'lucide-react';

// 3. Internal — types (use `import type` when value not needed)
import type { GatewayAgent } from '@/types/gateway-api';
import type { NormalizedMessage } from '@/types/NormalizedMessage';

// 4. Internal — services/stores/hooks
import { gateway } from '@/services/gateway';
import { useChatStore } from '@/stores/chatMessagesStore';

// 5. Internal — components
import { MessageBubble } from '@/components/Chat/MessageBubble';
import { GlassCard } from '@/components/shared/GlassCard';

// 6. Internal — utils
import { formatDuration } from '@/utils/format';
```

---

## 10. Comments & Documentation

### 10.1 When to Comment

| Situation | Action |
|-----------|--------|
| Public API (exported functions) | JSDoc required |
| Non-obvious algorithm | Explain WHY, not what |
| Workaround / hack | `// HACK:` with reason |
| Silent error drop | `// Non-critical: ...` |
| `any` escape hatch | `// SAFETY: ...` with justification |

### 10.2 When NOT to Comment

- Do NOT comment what the code says: `// Set loading to true` for `setLoading(true)`
- Do NOT leave commented-out code — delete it (git history exists)

---

## 11. Testing Standards

### 11.1 Rust

- Every `#[tauri::command]` with business logic MUST have a unit test.
- Path helpers MUST have tests for Windows/non-Windows paths.

### 11.2 TypeScript

- Utility functions MUST have tests (`.test.ts` co-located).
- Gateway response normalization MUST have tests (already done ✅ in `ChatHandler.test.ts`).
- Store selectors SHOULD have tests.

---

## 12. Refactoring Checklist

When touching any file, verify:

- [ ] File ≤ size limit (Rust 300, TS 400)
- [ ] No duplicated logic exists elsewhere
- [ ] Errors are typed (Rust: `AppError`, TS: typed Result)
- [ ] `any` count is zero or documented
- [ ] Platform conditionals are in `platform.rs`, not inline
- [ ] Path helpers come from `paths.rs`, not constructed inline
- [ ] Heavy imports are lazy-loaded
- [ ] External HTML is sanitized
- [ ] Error boundary wraps the route
- [ ] Public functions have JSDoc

---

> **Last updated**: 2026-06-12 · **Maintainer**: JunQi Desktop team
> **Note**: Single gateway config source = `~/.openclaw/openclaw.json` (`config_path()`); the dual/isolated-config design was removed. See ARCHITECTURE.md §7.
