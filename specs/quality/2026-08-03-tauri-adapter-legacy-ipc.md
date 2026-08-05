# Tauri 适配器遗留 IPC 契约规格

## 问题

JunQi 的 Tauri adapter 是桌面 renderer 与 Rust command 的兼容层。它必须严格呈现已注册的本地
能力，不能通过 `any`、无调用方 bridge 或浏览器 fallback 伪造 OpenClaw 或原生桌面状态。

## 约束

- 以当前 Rust command、`serde(rename_all)`、已安装 Tauri 2 API 声明和官方 Tauri 文档为契约。
- 仍被产品使用的 `window.aegis` 字段必须在 `AegisAPI` 中完整声明；调用方不得以 `any` 绕过该声明。
- `get_platform_info` 只读取并暴露 UI 实际需要的 `os` 与 `arch`；缺失或非字符串字段必须让调用失败进入
  既有 UI fallback，不能制造平台值。
- 非 Tauri browser preview 中的窗口操作必须保持明确的 no-op 或 `false` 结果，且签名与 desktop
  contract 一致。
- 无产品调用方的 `device` 与 `terminal` bridge 必须从 adapter 和 ambient declaration 同时删除。
- 系统指标 event 只能由 Rust `system-metrics` event 提供；全局 bridge 必须声明取消订阅函数。
- 不改动 Gateway 身份、OpenClaw session、终端工作台的 OpenClaw PTY 路径或 Rust command 注册。

## 验收条件

1. `tauri-adapter.ts`、`Performance.tsx` 不含 `any`，并且没有 `window.aegis` 的 `any` 强制转换。
2. `AegisAPI` 包含仍在使用的 `systemMetrics` 契约，性能页能够直接订阅和取消订阅。
3. adapter 不再包含 `device` 或 `terminal` bridge，ambient declaration 也不再公开它们。
4. 平台与存储路径解析拒绝 malformed IPC 返回；平台展示仅使用已验证的 `os`、`arch`。
5. 回归测试覆盖正常和 malformed DTO；类型检查、相关 Rust 检查、边界检查和差异检查通过。

## 不在范围内

- 新增或删除 Rust terminal command。
- 新增系统指标、平台信息或本地签名能力。
- 任意 OpenClaw 原生协议扩展。
