# JunQi Desktop — 架构规范与编码标准

> 所有代码必须遵守本规范。功能实现优先，但代码质量不可妥协。

---

## 1. 项目定位

JunQi Desktop 是 OpenClaw Gateway 的 Tauri v2 桌面客户端。从 Electron 迁移而来，前端 154 个文件完整保留。

| 维度 | 值 |
|------|-----|
| 产品名 | JunQi Desktop |
| Bundle ID | com.junqi.junqidesktop |
| 前端框架 | React 18 + TypeScript + Vite 6 |
| 样式系统 | Tailwind CSS 3 + AEGIS 设计系统 |
| 后端 | Tauri v2 (Rust) |
| 状态管理 | Zustand 5 |
| 路由 | react-router-dom v7 (HashRouter) |
| 国际化 | i18next + react-i18next (zh/en/ar) |
| 网关/配置 | 依托本地 OpenClaw，单一真相源 `~/.openclaw/openclaw.json`（见 §7） |

---

## 2. 目录结构

```
src/
├── api/
│   ├── tauri-adapter.ts       # window.aegis 适配层（Electron → Tauri）
│   ├── tauri-commands.ts      # Rust invoke 类型化封装
│   └── device-identity.ts     # Ed25519 设备身份
├── components/                # 共享 UI 组件
│   ├── Layout/                # AppLayout, NavSidebar
│   ├── Chat/                  # 聊天组件（20+）
│   ├── shared/                # GlassCard, StatusDot, ErrorBoundary, etc.
│   └── Toast/                 # 通知组件
├── pages/
│   ├── SetupPage.tsx          # 安装向导 — 状态机编排
│   └── setup/                 # 安装向导子屏幕（可选拆分）
├── hooks/                     # 自定义 Hooks
│   └── useSetupFlow.ts        # 安装流程状态机逻辑
├── stores/                    # Zustand stores
│   ├── app-store.ts           # 全局 App 状态（安装步骤、模式）
│   ├── chatStore.ts           # 聊天状态
│   ├── settingsStore.ts       # 设置状态
│   └── ...
├── services/
│   └── gateway/               # WebSocket 客户端
├── locales/                   # i18n 翻译文件
├── types/                     # TypeScript 类型声明
└── styles/                    # AEGIS CSS 主题

src-tauri/                     # Rust 后端
├── src/
│   ├── lib.rs                 # Tauri Builder + 命令注册 + setup
│   ├── commands/              # Tauri commands
│   │   ├── gateway.rs         # gateway 启停/状态/探活
│   │   ├── config.rs          # 配置读写/检测/导入
│   │   ├── system.rs          # 系统检测（Node/Git/OpenClaw）
│   │   └── setup.rs           # 安装逻辑（Node/Git/OpenClaw）
│   ├── state/                 # 全局状态（GatewayProcess）
│   └── tray/                  # 系统托盘
├── tauri.conf.json
├── Cargo.toml
└── icons/
```

---

## 3. 设计模式

### 3.1 页面 = 状态机 模式

所有多状态页面使用 State Machine 模式：

```
SetupPage (orchestrator)
  └─ 根据 state 渲染对应 Screen 组件
       ├─ DetectingScreen
       ├─ GatewayStoppedScreen
       ├─ ModeSelectScreen
       ├─ ProgressScreen
       └─ GitMissingScreen
```

**规则**：
- 状态定义在 `app-store.ts` 的 `SetupStep` 类型中
- 业务逻辑抽取到自定义 Hook（如 `useSetupFlow`）
- 页面组件只做 `switch(state) { case: return <Screen /> }`
- 每个 Screen 是独立函数组件，只接收 `{ flow }` props

### 3.2 自定义 Hook 模式

```typescript
// ✅ 正确：逻辑在 hook 中
function useSetupFlow(...): SetupFlow { ... }

// ✅ 正确：页面组件只编排
function SetupPage() {
  const flow = useSetupFlow(...);
  switch (step) { case: return <Screen flow={flow} />; }
}
```

### 3.3 Store 模式（Zustand）

```typescript
// ✅ 简单 store
interface AppState {
  setupComplete: boolean;
  setupStep: SetupStep;
  setSetupComplete: (v: boolean) => void;
  setSetupStep: (step: SetupStep) => void;
}
```

---

## 4. Tauri API 调用规范

### 4.1 静态导入（推荐）

```typescript
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
```

`@tauri-apps/api` 模块由 Tauri CLI 自动处理，**不要在 vite.config.ts 中 externalize**。

### 4.2 invoke 调用必须处理错误

```typescript
// ✅ 正确：始终 try-catch
try {
  const status = await invoke("gateway_status");
} catch (e) {
  // 优雅降级
}
```

### 4.3 listen() 必须 catch

```typescript
// ✅ 正确：listen 返回 Promise，必须处理 rejection
listen("gateway-log", (event) => { ... })
  .then(fn => { unlistenFn = fn; })
  .catch(() => {});  // ← 必须有
```

### 4.4 Rust 到前端的通信

优先使用 Tauri events：
```rust
// Rust 端
app_handle.emit("event-name", payload)?;
```
```typescript
// 前端
listen("event-name", (event) => { ... }).catch(() => {});
```

---

## 5. 错误处理规范

### 5.1 全局错误边界

`main.tsx` 顶层包裹 `<ErrorBoundary>`，所有未捕获错误必须有友好降级。

### 5.2 async 函数

```typescript
// ✅ 正确
async function doSomething() {
  try {
    await risky();
  } catch (e) {
    console.error(e);
    // 降级逻辑
  }
}
```

### 5.3 Promise 链

```typescript
// ✅ 正确：每个 Promise 链末尾有 catch
fetch(url)
  .then(r => r.json())
  .then(data => { ... })
  .catch(() => { /* 降级 */ });
```

---

## 6. 国际化（i18n）规范

### 6.1 所有面向用户的文本必须用 `t()` 

```typescript
// ✅ 正确
const { t } = useTranslation();
<h1>{t("setup.title")}</h1>

// ❌ 错误
<h1>Welcome to JunQi Desktop</h1>
```

### 6.2 新增文案必须配三语

在 `locales/en.json`, `zh.json`, `ar.json` 同步添加 key。

### 6.3 语言检测

自动跟随系统语言（`navigator.language`），zh 开头 → 中文，否则英文。用户在 Settings 可手动切换。

---

## 7. 网关与配置（依托本地 OpenClaw）

> ⚠️ **架构已变更（2026-06）**：JunQi **不再维护独立的隔离配置**。它现在完全是用户本地 OpenClaw 的前端客户端，所有配置以本地 OpenClaw 的标准文件为唯一真相源。旧版「`~/.openclaw/config/openclaw.json` 隔离配置 / 隔离优先 / 写双份」的设计已废弃。

**唯一配置真相源（原生模式）**：

```
~/.openclaw/openclaw.json    # 本地 OpenClaw 的标准配置 = JunQi 读写的唯一文件
```

所有 Rust 端配置访问统一走 `paths::config_path()`（= `~/.openclaw/openclaw.json`）：
`detect_gateway_config`（连接 token 来源）、`read_config` / `write_config`、`get_gateway_token`、`start_gateway`、`run_doctor`。**禁止再引用 `~/.openclaw/config/` 子目录。**

**网关生命周期规则——「没跑才启动，绝不杀」**：

| 场景 | 行为 |
|------|------|
| 端口已有网关（用户自己的 `openclaw gateway`、hermes 等） | 直接连接，**绝不 kill / 重启** 外部进程 |
| 端口无网关 | 才用标准配置启动 JunQi 自管的子进程；只杀自己之前 spawn 的 child |
| 检测 | `gateway_status` 在无自管子进程时探测 18789；`is_gateway_serving` / `probe_gateway_port` 走 `/healthz` |

**连接要点**：
- 连接 token 与网关实际使用的 token 必须同源（都来自标准配置），这是历史「连不上」bug 的根因（曾经连接读标准路径、启动读 `config/` 子目录，token 不一致）。
- 网关默认即接受 `tauri://localhost` 与 `http://localhost:5173`（dev）来源，无需额外 `controlUi.allowedOrigins`；`http://tauri.localhost` 与缺失 Origin 会被拒。

**Docker 模式（独立的备选部署，与原生互斥）**：
- 容器把 `~/.openclaw/docker/` 整个目录挂载为容器内 `~/.openclaw` home，网关在容器内 `bind: lan`（0.0.0.0），端口仅映射到宿主 `127.0.0.1`。
- 这是**有意独立**于原生模式的环境，不共用标准配置（bind 需求互斥）。仅 `docker.rs` 引用 `~/.openclaw/docker/`。

---

## 8. 构建配置

### vite.config.ts

```typescript
export default defineConfig({
  base: './',  // ← 必须！Tauri webview 需要相对路径
  build: {
    rollupOptions: {
      output: { manualChunks: { ... } }
      // 不要加 external！Tauri CLI 自动处理 @tauri-apps/api
    }
  }
});
```

### tauri.conf.json 关键配置

```json
{
  "productName": "JunQi Desktop",
  "identifier": "com.junqi.junqidesktop",
  "build": {
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": false,
    "security": { "csp": null },
    "windows": [{
      "decorations": true,
      "titleBarStyle": "Overlay",
      "hiddenTitle": true,
      "title": "JunQi Desktop"
    }]
  }
}
```

### index.html 规范

```html
<!-- ❌ 禁止：外部 CSS 阻塞渲染 -->
<link href="https://fonts.googleapis.com/..." rel="stylesheet">

<!-- ✅ 允许：内联 loading 指示器 -->
<div id="app-root">
  <div style="...">JunQi Desktop</div>
</div>
```

---

## 9. 窗口外壳（TopBar）与显示缩放

macOS 采用 `titleBarStyle: "Overlay"`（原生交通灯悬浮于内容之上），自定义顶栏 `src/components/Layout/TopBar.tsx` 渲染窗口外壳：

```
[交通灯留白 ps-[78px]] 折叠按钮 · ── AI 实时状态（居中）── · 通知铃铛（右）
```

- **拖拽区**：顶栏根容器加 `data-tauri-drag-region`（macOS WKWebView 下 `-webkit-app-region` 无效，是 Electron 专属）；交互子元素不要带该属性。需要 ACL `core:window:allow-start-dragging`。
- **AI 实时状态**：从 `chatStore` 派生 `disconnected | connecting | working | idle`。`working` 时拼出详细标签 —— 阶段（`思考中`/`生成回复中`，按 `thinkingBySession[活动会话].text` 判定）· 会话 `label` · 模型短名（`currentModel` 取 `/` 后段）· 每秒刷新的计时；工作发生在非活动标签页时显示 `N 个会话运行中`。`working` 点击跳 `/chat`，`disconnected` 点击派发 `aegis:reconnect`。
- **通知中心**：`NotificationPanel` 读 `notificationStore.history`（上限 50，带 `read` 标记），支持标记已读/全部已读/清空/勿扰；勿扰需同时调 `setDndMode` 与 `notifications.setDndMode` 才能真正抑制弹窗。

### 9.1 显示缩放（关键约束）

显示缩放用 webview `setZoom`（整页等比），**不要**用 CSS `zoom` 套在 `#app-root` 上（`h-screen overflow-hidden` 会在 >100% 时裁掉内容）：

```ts
// src/App.tsx — uiScale ∈ [50,150]（百分比），存 localStorage 'aegis-ui-scale'
const factor = uiScale / 100;
getCurrentWebview().setZoom(factor).catch(() => { /* CSS zoom 兜底 */ });
```

需要 ACL `core:webview:allow-set-webview-zoom`。

**顶栏属于窗口外壳，必须保持像素固定、与原生交通灯对齐 —— 不得随显示缩放变大。** 由于 webview 缩放是整页放大，顶栏需套一层反向 zoom 抵消：

```tsx
<div data-tauri-drag-region style={{ zoom: uiScale > 0 ? 100 / uiScale : 1 }}>
```

净缩放 = `(uiScale/100) × (100/uiScale) = 1`，顶栏恒定。

---

## 10. 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `SetupPage`, `GatewayStoppedScreen` |
| Hooks | use + PascalCase | `useSetupFlow`, `useAutoUpdate` |
| Stores | use + PascalCase + Store | `useAppStore`, `useChatStore` |
| 事件 | kebab-case | `gateway-log`, `setup-progress` |
| Rust commands | snake_case | `gateway_status`, `check_openclaw` |
| i18n keys | camelCase 嵌套 | `setup.title`, `settings.displayScale` |

---

## 11. 禁止事项

- ❌ 在 `<head>` 中加载外部阻塞资源（Google Fonts 等）
- ❌ 硬编码面向用户的字符串（必须用 i18n）
- ❌ `listen()` 不 catch
- ❌ `invoke()` 不 try-catch
- ❌ 一个文件超过 400 行（拆成 hook + screen 组件）
- ❌ 在 vite.config.ts 中 manual externalize `@tauri-apps/api`
- ❌ 在 `index.html` 中写 `id="root"`（必须用 `id="app-root"`）
- ❌ 页面组件混合业务逻辑（抽到 hook）
- ❌ 忘记 `base: './'` 在 vite config 中
- ❌ 用 CSS `zoom` 套 `#app-root` 做显示缩放（裁内容；必须用 webview `setZoom`）
- ❌ 顶栏随显示缩放变大（窗口外壳须反向 zoom 保持像素固定、对齐交通灯）
- ❌ 在拖拽区的交互子元素上保留 `data-tauri-drag-region`

---

> 最后更新: 2026-06-12 · 适用于 JunQi Desktop v0.5.0+
> 变更: §7 重写为「依托本地 OpenClaw，单一配置真相源 `~/.openclaw/openclaw.json`，没跑才启动绝不杀」；废弃旧的隔离配置设计。
