# OpenClaw 智能体作用域模型目录实施计划

1. 核对 `models.list` 与 `chat.metadata` 官方 schema、handler 和 Control UI 调用。
2. 在 Gateway 服务层添加受约束的 `chat.metadata` 模型目录读取。
3. 在状态仓按智能体保存派生目录，并在断线时清空。
4. 将会话运行时控件与会话输入状态绑定到该目录。
5. 添加回归测试并执行完整验证。
6. 对照官方 Provider 页，为认证状态、实时验证和注销补齐所选智能体作用域。

## 执行结果

- 阶段一至四已实施：默认目录和会话智能体目录分离，后者只由 `chat.metadata` 投影。
- 定向测试、完整 `pnpm test`、TypeScript、模块边界检查和生产构建已通过；真实多智能体 Gateway
  验收留待后续全局验证阶段。
- 已补齐 Provider 页的模型认证作用域：`models.authStatus`、`models.probe`、`models.authLogout`
  均携带选择的 `agentId`，切换智能体时清空旧验证投影。客户端定向回归 14 项与 `pnpm lint` 通过。
