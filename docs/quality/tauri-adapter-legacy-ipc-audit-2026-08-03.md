# Tauri 适配器遗留 IPC 审计

日期：2026-08-03

## 依据

- Tauri [官方 JavaScript core 文档](https://v2.tauri.app/reference/javascript/api/namespacecore/) 将 `invoke` 的返回类型保留给调用方声明；未验证的泛型不会形成运行时契约。
- Tauri [官方 window 文档](https://v2.tauri.app/reference/javascript/api/namespacewindow/) 定义 `getCurrentWindow()` 返回当前窗口实例；窗口最小化、关闭和最大化查询是异步操作，且部分窗口能力在 Linux 桌面环境可能不可用。
- 当前安装的 `@tauri-apps/api` 为 `2.11.1`，其声明与上述 `invoke` 和 `getCurrentWindow()` 契约一致；安装版本只记录复现范围，不作为功能分支。
- JunQi Rust command：`get_platform_info` 返回 `os`、`arch` 与本地目录；`get_storage_setup_status` 返回 `stateDir`、`workspaceDir` 等 camelCase 字段；`terminal_create` 返回 `{ id, pid }`；系统指标通过 `system-metrics` event 推送。

## 审计范围

- `src/api/tauri-adapter.ts`
- `src/types/global.d.ts`
- `src/pages/Performance.tsx`
- `src/pages/SettingsPage.tsx`
- `src/services/notifications.ts`
- `src/services/runtimeDataDirectory.ts`
- `src-tauri/src/commands/system.rs`
- `src-tauri/src/commands/storage.rs`
- `src-tauri/src/commands/system_metrics.rs`
- `src-tauri/src/commands/terminal.rs`

## 问题

### BUG-TAURI-ADAPTER-01 高：遗留桥接以 `any` 规避 IPC 契约

位置：`src/api/tauri-adapter.ts`。

当前适配器以 `any` 保存设备身份与窗口句柄，以 `any` 接收 `get_platform_info`，并把整个
`window.aegis` 以 `any` 写入全局对象。这样 Rust 的 serde 字段变化、Tauri 返回无效值或浏览器预览中
的窗口 API 不可用时，TypeScript 不能阻止错误扩散。

目标：将仍有调用方的 bridge 定义为严格 ambient contract；平台和存储结果在使用点验证所需字段；窗口
操作在非 Tauri 预览中明确返回 no-op 或 `false`，而不是由 `any` 隐藏 `undefined`。平台信息只向 UI
返回实际使用的 `os` 与 `arch`，不在 renderer 留存无调用方需要的目录字段。

### BUG-TAURI-ADAPTER-02 高：无产品调用方的 device 与 terminal bridge 继续暴露原生入口

全仓调用检索显示没有任何生产调用方访问 `window.aegis.device` 或 `window.aegis.terminal`。当前终端
工作台使用 OpenClaw PTY command 和事件，不使用该 legacy terminal multiplexer；Gateway 连接直接使用
`device-identity.ts`，不经过全局 bridge。

影响：未使用 API 仍可绕过类型化 command 层访问本地签名材料或终端 command，形成第二条不受产品测试
覆盖的 IPC 路径。保留它们还迫使 adapter 使用宽泛 `any`。

目标：从 adapter 与全局声明一并删除未调用的 device 和 terminal bridge，但不删除 Rust command 或
OpenClaw PTY 运行路径。该变更不是声称原生终端功能不存在，而是移除没有产品所有者的 renderer API。

### BUG-TAURI-ADAPTER-03 中：性能页绕过全局声明读取系统指标

位置：`src/pages/Performance.tsx:86`。

`systemMetrics` 已由 adapter 提供，但全局 `AegisAPI` 没有该字段，调用方只能使用 `(window.aegis as any)`。
这会让系统指标 event 的订阅函数、取消订阅函数和字段类型漂移失去编译期保护。

目标：将指标 stream 写入 `AegisAPI`，性能页以声明类型订阅；不捏造指标来源，也不为不存在的浏览器
能力添加 fallback 数据。

## 不在范围内

- 不改写 OpenClaw Gateway 协议、设备配对语义或凭据存储路径。
- 不删除 Rust terminal command；是否删除后端无调用 command 属于独立 Rust 生命周期审计。
- 不把 browser preview 描述为桌面原生能力；预览仅保留现有明确 no-op 行为。
- 不增加新的 Tauri command、平台专属路径或硬编码平台判断。
