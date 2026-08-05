# OpenClaw 会话模型选择锁对齐

## 依据

- 最新 [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) 规定，`sessions.list` 返回当前会话索引，`sessions.patch` 更新会话覆盖。
- 官方 [Gateway 会话行类型](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils.types.ts) 为每行定义可选 `modelSelectionLocked?: boolean`。
- 官方 [会话 patch 实现](https://github.com/openclaw/openclaw/blob/main/src/gateway/sessions-patch.ts) 在现有会话已锁定时拒绝任何包含 `model` 的 patch；官方测试同时覆盖切换模型、恢复默认模型被拒绝，以及其他会话元数据仍可修改。

## 当前行为

JunQi 读取了 `sessions.list` 的模型与其他会话覆盖，但丢弃 `modelSelectionLocked`。模型选择器因此仍可选择其他模型或恢复默认模型，直到 Gateway 在写入时拒绝请求；界面不能提前反映 OpenClaw 已给出的会话约束。

## 目标行为

1. 会话列表只在 Gateway 字段严格为 `true` 时投影模型选择锁；缺失或其他值不推断为锁定。
2. 锁定会话的模型候选项和“恢复默认模型”操作均不可用，并提供可访问的锁定说明；模型、思考、快速模式等独立会话设置仍在同一个控制面板中按各自契约处理。
3. 保存与恢复默认模型前从当前会话状态重新核验锁定标记，防止面板打开后 Gateway 刷新状态造成模型写入越界。
4. JunQi 不创建或写入 `modelSelectionLocked`，不尝试解除锁、不将模型错误包装为成功，也不以版本、模型名或 runtime 推测锁定状态。

## 验收

1. 严格布尔投影只能让 `true` 禁止模型选择，`false` 保持原有操作能力。
2. 锁定状态下模型切换和恢复默认模型都在客户端写入前被阻止。
3. 锁定后仍能单独保存 Gateway 已支持的非模型会话覆盖，且提交不携带 `model`。
4. 锁状态在会话列表完整刷新时随 Gateway 当前行更新，旧状态不得长期保留。
5. 中文、英文和繁体中文均具备锁定状态的可访问文案。

## 非目标

- 不新增锁定配置、会话权限模型、管理员解锁入口或模型目录规则。
- 不修改 OpenClaw 的 `sessions.patch` 授权、错误消息、模型路由或 runtime 选择。
- 不将本地 UI 禁用状态当作 Gateway 已成功执行某次会话变更的证据。

## 未验证边界

- 尚未在真实锁定的 Agent Harness 会话上完成 macOS、Windows、CentOS 和 Ubuntu 的桌面交互验收。
- 上游未来若扩展锁定字段的类型或可锁定的其他会话覆盖，需要重新查阅其官方协议和 handler 后再调整客户端。
