# OpenClaw 原生会话变更边界实施计划

## 执行顺序

1. 将 `runtime/sessionLifecycle.ts` 收敛为 OpenClaw 原生删除和重置调用，保留会话身份读取、单会话互斥和回执校验。
2. 删除协作变更对话框、状态仓、协调器和仅为该链路存在的 outcome helper及其专属测试。
3. 从应用路由移除会话变更对话框宿主。
4. 重写生命周期定向测试，覆盖协作插件状态不影响原生 RPC、删除身份要求、重置身份回执和 Gateway 失败关闭。
5. 全局搜索确认无会话变更 RPC 消费者，执行定向测试、`pnpm lint`、构建与文档检查。

## 执行结果

已完成。前端会话生命周期不再访问 `junqi.collab.session.mutation.*`，已删除其对话框、状态仓、协调器、专属 outcome helper、客户端读取契约、解码器、文案和测试。协作插件仍可能作为独立的 Gateway 插件暴露其自身 RPC；该动态插件入口没有 JunQi Desktop 消费者，且不再参与原生会话生命周期。
