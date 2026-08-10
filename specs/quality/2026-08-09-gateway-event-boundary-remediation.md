# Gateway 实时事件边界整改规格

日期：2026-08-09

## 目标

关闭复审中的 GNE-11 与 GNE-12。JunQi 只投影由最新版 OpenClaw 正式协议或已安装协作插件真实发出的事件，不用未验证事件、局部字段或本地猜测推进会话运行状态。

## GNE-11：实时事件解码

### 输入契约

- Agent：必须是 `event: "agent"`，且 payload 含非空 `runId`、非负安全整数 `seq`、非空 `stream`、有限时间戳 `ts` 和非数组对象 `data`；`sessionKey`、`sessionId`、`agentId` 仅在非空字符串时保留。
- Chat：必须是 `event: "chat"`，且 payload 含非空 `runId`、`sessionKey` 和非负安全整数 `seq`。status、delta、final、aborted、error 分别遵循官方封闭 schema；delta 必须含字符串 `deltaText`。
- `session.tool` 保持现有工具生命周期规范化器，但只在完整外层 run 信息通过验证后进入序号栅栏。
- 未识别的顶层 Gateway 事件不进入聊天运行投影，仍可由独立的官方失效处理器读取。

### 行为

1. 解码失败时不调用 `acceptEvent`，不写入 store，不刷新或终止 run。
2. 已解码但 JunQi 不展示的 Agent stream 可以维护 run 序号；不得以其 data 派生 UI 状态。
3. 已解码的 Chat、Agent、Session Tool 事件才进入序号栅栏，随后由现有投影器处理。
4. 解析器只产出不可变判别联合；不得导入 store、Connection、React 或 Tauri。
5. 删除因此被替代的 `any` 参数和分散字段读取。

### 回归

- 畸形 Agent event 在有效同 seq assistant event 前到达时，后者仍能显示。
- 畸形 Chat delta 不推进序号；有效同 seq delta 仍能显示。
- 未知但完整 Agent stream 不产生消息或工具卡，也不阻断后续 seq。
- 缺失 runId、非法 seq、非对象 data、非法 Chat state 均不产生本地状态。
- 正常 status、delta、replace、final、aborted、error 和 session.tool 的既有回归保持通过。

## GNE-12：协作刷新提示

1. 只接受 `event: "agent"`、`payload.stream: "junqi-collab.changed"` 和通过 `parseCollaborationChangedHint` 的 data。
2. 顶层 `junqi-collab.changed` 一律当作未识别事件并交给普通路由，不通知协作 store。
3. runtime identity 的 events 只列官方顶层 event，例如 `agent`，不能把 Agent stream 写入 features.events。
4. 仍保持 listener 异常隔离和 malformed reserved agent stream 的失败关闭。

## 非目标

- 不把最新 OpenClaw 版本号写入运行时能力开关。
- 不新增协作 Gateway RPC、顶层 event 或本地任务状态机。
- 不改变官方 Agent stream 的可扩展性，也不把未知 stream 误报为错误。

## 实施状态

GNE-11 与 GNE-12 已完成实现和定向自动化验证。实时事件的传输边界已改为 `unknown`，解码成功后才进入
运行序号栅栏；协作刷新提示已收束为官方 Agent stream。完整前端测试、生产构建、真实 Gateway 回放和
三平台真机验证仍未完成，不能据此推断运行时兼容性已经全量验证。
