# OpenClaw 会话目标入口围栏规格

日期：2026-08-04

## 问题

会话读取 facade 为缺失的目标参数自动使用主会话 key，且部分会话定向读写入口会让空 key
进入本地 mutation coordinator 或 Gateway 请求，违背 OpenClaw 会话范围必须由实际调用上下文
提供的约束。

## 目标

1. `tools.effective`、`sessions.preview`、`sessions.resolve` 和 `artifacts.list/get/download`
   必须接收显式、非空的 session key。
2. `sessions.describe`、`chat.history`、`chat.message.get`、`sessions.compact`、`sessions.delete`
   与 `sessions.reset` 的 facade 入口同样必须在请求或串行 mutation 前验证目标。
3. `sessions.patch` 的 `pinned`、`unread`、`archived` 与 `category` 写入必须在进入 mutation
   coordinator 前验证目标。
4. `sessions.compaction.list/get/branch/restore` 必须在读取连接、请求或 mutation coordinator 前验证目标。
5. 缺失、空白或非字符串目标必须在请求连接层或 mutation coordinator 之前以既有
   `OPENCLAW_SESSION_TARGET_REQUIRED` 失败。
6. 不修改 OpenClaw RPC 方法、参数名、权限、响应解码或会话选择行为。

## 验收

- TypeScript 调用面不再为这些方法声明默认 session key。
- 每个受影响 facade 入口的缺失目标测试均在 Gateway 连接请求或本地 mutation coordinator 前失败。
- 四种 `sessions.patch` 组织写入的客户端测试证明缺失目标不会进入 mutation coordinator 或 Gateway 请求。
- 四种 `sessions.compaction` 检查点操作的客户端测试证明缺失目标不会进入 mutation coordinator、读取连接或 Gateway 请求。
- 所有生产调用方显式传入当前或用户选择的真实 session key。
- 完整 TypeScript、测试、构建、官方文档链接与差异检查通过。
