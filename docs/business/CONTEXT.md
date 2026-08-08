# 钉钉业务工作台领域上下文

更新时间：2026-08-08

本文只定义 JunQi 钉钉业务工作台的规范术语。根目录 `CONTEXT.md` 继续只定义 OpenClaw 持久化协作领域，两个上下文不得混用。

## 核心术语

| 术语 | 定义 | 不等于 |
| --- | --- | --- |
| 钉钉业务工作台 | JunQi 中面向钉钉业务能力的单平台桌面界面。 | OpenClaw 钉钉消息渠道、独立业务运行时。 |
| DWS 运行时绑定 | 某个已核验 Gateway 主机或受控 Node 上的 DWS 可执行文件、版本、配置目录和认证边界。 | 当前桌面机器的 PATH 命中、Gateway 健康。 |
| 钉钉身份绑定 | DWS `profile list` 返回的精确 `corpId:userId` 与当前业务操作身份的绑定。 | 展示名称匹配、聊天发送者身份、最近使用账号。 |
| 能力快照 | 由 OpenClaw `tools.effective`、插件运行时探测和当前 DWS leaf schema 共同形成的带时间戳能力投影。 | 静态前端目录、OpenClaw `hello-ok.features.methods` 的完整能力清单。 |
| 业务操作计划 | 在执行前冻结的工具、参数摘要、身份、目标实体、风险、确认要求和能力快照引用。 | 可复制的 shell 命令、执行成功。 |
| 业务操作尝试 | 使用一个 `idempotencyKey` 发起的一次 OpenClaw `tools.invoke` 请求及其正式响应或不确定结果。 | 自动重试、钉钉实体最终状态。 |
| 业务活动投影 | JunQi 对请求、插件审批、执行结果、恢复事件和权威重读的本地脱敏记录。 | OpenClaw transcript、钉钉审计日志、第三方状态权威源。 |
| 业务实体投影 | 最近一次通过只读工具重读得到的审批、待办、日程或考勤状态，包含观察时间和来源。 | 本地乐观状态、旧缓存继续写入的依据。 |
| 恢复交接 | DWS 返回恢复事件后，JunQi 向用户展示恢复标识和正式恢复入口的状态。 | 自动执行恢复、自动重放未知结果的写操作。 |

## 身份与运行时关系

```text
OpenClaw Gateway 运行时身份
  1 -- 1..n DWS 运行时绑定
  DWS 运行时绑定 1 -- 0..n 钉钉 profile
  当前业务会话 1 -- 1 精确钉钉身份绑定
  能力快照 1 -- 1 Gateway 运行时身份
  能力快照 1 -- 1 钉钉身份绑定
```

Gateway、DWS 和 profile 任一身份变化都会使旧能力快照失效。JunQi 必须重新探测，不能沿用旧快照继续写入。

## 操作状态

```text
planned
  -> awaiting_approval
  -> invoking
  -> succeeded_unverified
  -> verified

planned | awaiting_approval
  -> cancelled | denied

invoking
  -> failed | unknown

unknown
  -> verified | failed_after_reconciliation | requires_manual_recovery
```

`succeeded_unverified` 只表示 OpenClaw 工具调用返回成功，不表示钉钉实体已达到预期终态。写操作必须通过权威重读收敛为 `verified`；无法重读时保持 `unknown` 或 `requires_manual_recovery`。

## 上下文边界

- OpenClaw 负责 Session、Agent、工具暴露、工具策略、审批和 `tools.invoke` 语义。
- 钉钉 OpenClaw 插件负责把经过允许的 DWS leaf schema 映射为固定业务工具，并执行 DWS。
- DWS 负责钉钉认证、profile、命令参数、安全元数据、MCP 调用和恢复事件。
- JunQi 负责桌面交互、操作计划、审批展示、能力与实体投影，不重新定义上游成功条件。
- 钉钉服务端是审批、待办、日程、通讯录和考勤实体状态的最终权威源。
