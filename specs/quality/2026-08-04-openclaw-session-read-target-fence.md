# OpenClaw 会话读取目标围栏规格

日期：2026-08-04

## 问题

会话读取 facade 为缺失的目标参数自动使用主会话 key，违背 OpenClaw 会话范围必须由实际
调用上下文提供的约束。

## 目标

1. `tools.effective`、`sessions.preview`、`sessions.resolve` 和 `artifacts.list/get/download`
   必须接收显式、非空的 session key。
2. 缺失、空白或非字符串目标必须在请求连接层之前以既有
   `OPENCLAW_SESSION_TARGET_REQUIRED` 失败。
3. 不修改 OpenClaw RPC 方法、参数名、权限、响应解码或会话选择行为。

## 验收

- TypeScript 调用面不再为这些方法声明默认 session key。
- 每个 facade 入口的缺失目标测试均在 Gateway 连接请求前失败。
- 所有生产调用方显式传入当前或用户选择的真实 session key。
- 完整 TypeScript、测试、构建、官方文档链接与差异检查通过。
