# 本地 main 对齐与客户端边界审计

## 依据

- 根 `AGENTS.md`：JunQi 只作为 OpenClaw 桌面客户端；没有 OpenClaw 原生契约的能力不得包装为 JunQi 功能。
- 本地 `main` 提交 `17eb600e`：包含 P0 IPC wrapper、Gateway 传输类型和生产分包收敛，也包含独立第三方 `ego-lite` CLI 探测。
- 当前分支在共同祖先 `0f8e4b03` 之后的会话身份围栏、Stop 检查点和本地发送队列交付原子性实现。

## 审计结论

1. 保留 `main` 的页面 IPC wrapper、Gateway `unknown` 传输边界、消息路由校验、生产分包及相应测试；这些是客户端边界收敛，不重新定义 OpenClaw 语义。
2. 保留当前分支的 Gateway 协议版本校验、连接身份围栏、可取消请求注册、`addCronAgentTurn` 契约和灵动岛预览事件路径；不得用较早分支实现覆盖。
3. 删除 `ego-lite` Provider、固定 macOS 门禁、CLI 路径探测、相关 UI、测试、本地化和文档。它是独立第三方应用，不是 OpenClaw Gateway 已声明的浏览器能力；JunQi 不能将其列为可用 Provider。
4. Workbench Browser 标签恢复为未实现状态，不嵌入页面、不启动浏览器、不伪造浏览器可用性。当前会话的 OpenClaw 工具能力仍由既有 `tools.effective` 契约呈现。

## 验证范围

- 合并冲突逐项核对 IPC Rust 注册、前端 wrapper、Gateway 请求生命周期、会话变更和原有页面调用方。
- 删除前全局检索静态导入、Tauri 注册、页面挂载、测试、国际化、文档和计划索引。
- 变更后执行 TypeScript、Rust、边界、构建、OpenClaw 文档与协作插件验证；目标平台真机行为单独记录，不能由本机自动化替代。

## 验证结果

- `pnpm lint` 通过：边界检查覆盖 851 个文件，TypeScript 无错误。
- `pnpm test` 通过；测试日志中的 Radix SSR `useLayoutEffect` 警告为既有警告，未导致用例失败。
- `pnpm test:rust` 通过：703 passed，3 ignored。
- `pnpm build` 通过：包含 collaboration bundle、TypeScript 与 Vite production build。
- `pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate`、`cargo fmt -- --check`、`cargo check --lib` 均通过。
- 全局引用扫描确认生产 `src/`、`src-tauri/` 不再包含 Provider、`ego-lite`、`probe_browser_providers` 或 `mcpTools` 消费者。

## 未验证边界

- Windows、Linux 与 macOS 打包后的 Tauri IPC 和 Gateway 连接仍需目标平台真机验证。
- 本记录不声明 OpenClaw Gateway 或浏览器工具在未连接、未授权或 Gateway 实际未知方法时可用；方法发现遗漏本身不决定调用资格。
