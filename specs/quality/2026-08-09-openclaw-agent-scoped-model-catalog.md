# OpenClaw 智能体作用域模型目录规格

## 问题

默认智能体的模型目录不能证明其他智能体可选择同一模型。

## 约束

1. `models.list` 仅作为默认通用目录。
2. 会话模型选择必须按会话所属 `agentId` 调用 `chat.metadata`。
3. 回包缺少 `models`、模型未明确 `available: true` 或读取失败时，作用域目录为空。
4. Gateway 断开时清除作用域目录，不能跨运行时复用。
5. Provider 页的 `models.authStatus`、`models.probe` 与 `models.authLogout` 必须使用用户选择的
   Gateway 智能体 `agentId`，不得隐式落入默认智能体。

## 验收

- 非默认智能体会话不会读取或展示默认目录作为可选项。
- 请求参数只含官方 `agentId`。
- 切换会话后模型控件只绑定当前智能体目录。
- 会话输入的 Provider 缺失状态也只使用当前会话智能体目录，不能以默认智能体目录掩盖不可用状态。
- Provider 页切换智能体后，认证状态、实时验证结果和注销动作只作用于新选择的智能体。
- 测试、类型检查和构建通过。
