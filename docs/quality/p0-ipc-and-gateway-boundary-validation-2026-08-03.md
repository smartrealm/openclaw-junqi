# P0 IPC 与 Gateway 边界收敛验证

## 依据

依据 `src-tauri/src/lib.rs` 的 command 注册、各 command 的 Rust 参数与 `serde` 命名规则、`src/api/tauri-commands.ts` 的现有 wrapper，以及 `scripts/check-boundaries.mjs` 的源码扫描规则。

## 当前验证状态

本记录在 P0 实施完成后更新。自动化结果必须区分 TypeScript、前端测试、Rust 检查、边界检查与生产构建；未执行的真机验证不能标记为通过。

## 结果

- 页面原始 IPC：通过。生产 `src/pages/` 不再导入 `@tauri-apps/api/core` 或直接调用 `invoke`；任务、终端、会话、宠物、项目初始化和 QuickChat 均通过 `src/api/tauri-commands.ts` 的命名 wrapper。
- Gateway 传输类型：通过。`Connection.ts`、`messageRouter.ts`、`AgentManagement.ts` 和 Gateway facade 的目标生产代码不含 `any`；请求参数使用对象契约，响应使用 `unknown`、记录类型或泛型；非法 WebSocket payload 有回归测试并被路由层丢弃。
- TypeScript 与边界检查：通过。`pnpm lint`、`node scripts/check-boundaries.mjs`、`node --test scripts/check-boundaries.test.mjs` 均通过；完整前端测试为 239 项、31 个套件全部通过。
- Rust 检查：通过。`cargo fmt -- --check`、`cargo check --lib` 通过；`cargo test --lib` 为 712 passed、0 failed、4 ignored。P0 本身未修改 Rust 文件，结果同时覆盖当前工作树既有 Rust 改动。
- 生产构建：通过。`pnpm build` 完成 collaboration bundle、TypeScript 与 Vite production build；本次构建没有 circular chunk 或 JavaScript chunk size warning。最大 JavaScript chunk 为按需加载的 `pdfjs`（513.31 kB），低于 550 kB 门禁；`xterm-core` 为 291.38 kB，`xterm-addons` 为 187.81 kB，`codemirror-core` 为 408.39 kB。

该结果取自 2026-08-03 当前工作树的完整构建输出。此前记录中的“大 chunk 警告”已不再复现，不能作为当前状态的判断依据。

## 未验证边界

Windows、Linux 和签名打包后的 Tauri WebView 尚未在本记录创建时进行真机验证。Gateway 认证、渠道插件和外部浏览器 Provider 仍以各自官方运行时返回为准。现有用户工作树中的长期运行测试子进程未由本轮终止，属于外部运行状态，不作为本轮验证结果。
