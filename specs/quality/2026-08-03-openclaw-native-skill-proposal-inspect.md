# OpenClaw 原生技能提案详情对齐规格

日期：2026-08-03

## 目标

让 JunQi 在既有 agent-scoped Skill Workshop 清单内只读查看官方 `skills.proposals.inspect` 草稿，
且不泄露 workspace 文件信息、不混淆 agent scope、不创造提案生命周期行为。

## 契约

1. 调用使用官方 `skills.proposals.inspect`，参数为非空 proposal id 和可选 agent id。
2. agent id 只能由现有 proposal scope 解析器给出；详情必须使用发起清单时当前选择的相同 scope。
3. Gateway methods 明确不含 inspect 时不显示入口且不得调用；methods 未广告时可按官方 RPC 尝试读取。
4. 成功回包必须包含匹配请求 id 的 `openclaw.skill-workshop.proposal.v1` record、完整 target、scan 和
   support file 结构及 string 正文；缺失或未知枚举必须失败。
5. React 状态和 UI 只保留安全投影：id、title、description、skill key、status、可选 revision hash 和
   content。不得保留或显示路径、support file、origin、scan finding 或 evaluation。
6. 草稿必须作为纯文本显示；不得使用 HTML 渲染、下载、文件写入或提案状态变更。
7. scope、连接或 capability 变化及关闭弹窗必须废弃在途结果；过时响应不得写入页面。

## 非目标

- 不实现 OpenClaw 未提供的 proposal、任务图、恢复或语音运行时能力。
- 不接入 history、events、evaluate 和任意管理员写方法。
- 不从 `/skill-hub`、本地 workspace 或开发机状态读取替代数据。

## 验收

1. 完整官方样式回包可得到安全投影，错误 id 或缺失嵌套字段被拒绝。
2. 显式 agent scope 原样进入 inspect RPC；默认 scope 省略 `agentId`。
3. 明确未广告 inspect 时无 RPC 调用。
4. 类型检查、服务回归、全量验证、文档链接和 Emoji 扫描通过。
