# OpenClaw 会话 Agent 状态投影

## 依据

- 最新 [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) 将 `sessions.list` 定义为当前会话索引。
- 官方 [会话 patch schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts) 定义 `statusNote`、`attention` 和 `ttlMinutes`；这些是 Gateway 控制面的会话状态输入。
- 官方 [会话状态解析器](https://github.com/openclaw/openclaw/blob/main/src/sessions/session-agent-status.ts) 只返回未过期、带非空说明且注意事项合法的状态；[会话行投影](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils-row.ts) 将该结果作为 `agentStatus` 返回。

## 当前行为

JunQi 的标签页状态卡展示模型、思考、用量和 runtime，但会话列表丢弃 Gateway 已过滤的 `agentStatus`。Agent 或其他 OpenClaw 原生入口写入的短期状态说明不会在桌面会话导航和当前会话栏中可见。

## 目标行为

1. 只接受 `agentStatus.note` 为非空字符串的 Gateway 状态；缺失、空白或畸形对象按未知处理。
2. 在所有会话标签与当前会话栏显示只读状态说明，完整文本通过可访问名称和原生提示提供，窄窗口只保留图标。
3. 会话完整刷新缺失该字段时清除旧投影；JunQi 不在本地维护过期计时器。
4. JunQi 不新增状态编辑、注意事项映射、TTL 修改、任务状态转换、灵动岛推送或本地持久化。

## 验收

1. 解析器仅保留合法的非空说明。
2. 完整快照可清除已消失的状态说明。
3. 标签与当前会话栏均使用三语可访问文案，且不影响错误、模型或会话操作。
4. 无 `sessions.patch`、本地计时器或自定义任务状态写入。

## 未验证边界

- 尚未在真实 Gateway 上验证过期、注意事项与状态说明更新的时序。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验证窄窗口和读屏体验。
