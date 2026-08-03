# P0 IPC 与 Gateway 边界收敛计划

## 顺序

1. 扩展 `scripts/check-boundaries.mjs` 的页面规则，禁止 `@tauri-apps/api/core` 与页面内直接 `invoke`，并同步边界测试矩阵。
2. 在 `src/api/tauri-commands.ts` 增加任务、终端工作区、会话导出、项目初始化、宠物窗口和 QuickChat 的严格 wrapper。
3. 迁移受影响页面，删除原始 core import，保留原有错误处理和 UI 状态行为。
4. 将 `Connection.ts`、`messageRouter.ts`、`AgentManagement.ts` 和 Gateway facade 的传输边界从 `any` 收敛到 `unknown`、记录类型和泛型。
5. 运行边界、TypeScript、前端测试、Rust 格式/编译/单元测试和生产构建，写入验证记录。

## 保护条件

- 不改变 Tauri command 名称和参数外层。
- 不在 wrapper 中静默补默认字段；可选字段按 Rust 契约显式声明。
- 不扩大到未被 P0 触及的页面、stores 或领域 service 重构。
- 现有 dirty worktree 改动保留，并在最终验证中单独记录。
