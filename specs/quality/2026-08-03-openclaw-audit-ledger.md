# OpenClaw 审计账本对齐规格

日期：2026-08-03

## 背景

JunQi 的响应追溯此前只使用前端聚合的 Gateway transcript。OpenClaw 官方已经提供 metadata-only 审计查询：主线 Gateway 使用 `audit.activity.list`，旧 Gateway 保留 `audit.list`。JunQi 必须依托这两个原生方法，不得自行生成审计事件、审批事实或完整工具链。

## 约束

1. `hello-ok.features.methods` 只能作为当前 WebSocket 的保守发现信息，不能按 OpenClaw 版本号、当前开发机、安装路径或发现遗漏判断调用资格；正式 RPC 响应才裁决实际可用性。
2. `audit.activity.list` 需要 `operator.read`；JunQi 的日常连接已有该 scope，不得为了追溯增加 `operator.approvals` 或 `operator.admin`。
3. 旧 `audit.list` 只返回 agent run 和 tool action。消息 kind、direction、channel 过滤没有兼容路径时必须失败关闭。
4. 所有返回都必须保持 OpenClaw 的 metadata-only 语义；不得从 transcript 文本补造 event id、actor、审批人或 tool result。
5. Gateway 断开、重连、实际未知方法和账本无记录必须分别保留可解释状态。

## 验收条件

- 客户端优先调用 `audit.activity.list` 并能解析 agent run、tool action、inbound message、outbound message 的 V1 结构。
- Gateway 对 activity 返回正式未知方法后，运行/工具查询可回退 `audit.list`；消息专属过滤明确显示不支持。
- Gateway 对两种官方方法均返回正式未知方法时，不展示伪造记录。
- 追溯面板在有 `runId` 时展示上游返回的审计元数据，在无 `runId` 时说明没有可查询的上游运行标识。
- 解析器拒绝非法 schemaVersion、actor、status/action/errorCode 组合和非 metadata-only 数据。
- 主 Chat、QuickChat、Gateway 能力生命周期和三种语言文案都有回归覆盖。

## 不在本规格内

- JunQi 不实现 OpenClaw Gateway 审计写入、保留策略、配置修改或消息审计开关。
- JunQi 不把 transcript-only 的 inline button/decision 改写为 OpenClaw 正式审批。
- 本规格不宣称真实 Gateway 已支持主线 activity 方法；真实联机验证仍待目标环境提供对应 Gateway。
