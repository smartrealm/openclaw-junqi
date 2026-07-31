# 会话分组与后台活动下钻设计

日期：2026-07-31

## 依据与现状

- OpenClaw 2026.7.1 的 Gateway Protocol 规定 `sessions.list` 提供当前会话索引，`sessions.describe` 按精确 `sessionKey` 返回一条会话记录；`cron.runs` 支持以 `jobId` 和可选 `runId` 查询运行记录。
- OpenClaw 的会话管理文档将 cron、hook、heartbeat、ACP 和 subagent 列为合成运行条目；隔离 cron 运行具有独立会话和保留策略。
- 当前侧栏已经先将已识别 cron、子智能体和系统会话从用户会话日期分组中分离，但未知来源保守显示为用户会话。
- 当前后台活动导航生成 `session` 查询参数；Cron 页面只消费 `job`，活动中心不消费 `session`。页面跳转成立，精确记录选择不成立。

## 目标

1. 用户会话日期分组只展示明确属于对话的会话；有官方结构化证据的后台运行始终进入后台活动。
2. 未识别来源不得因为名称、提示词、语言或本机配置被猜测为后台任务，也不得静默隐藏。
3. 每次后台活动下钻都传递和消费精确身份。Cron 下钻定位同一任务及可确认的同一次运行；系统和子智能体下钻定位同一个会话实例。
4. 精确运行已被清理、当前 Gateway 未返回关联字段或身份不一致时，显示不可用状态和已验证范围，不跳转到最近记录。
5. 侧栏保持紧凑，但活动详情能显示时间、来源、状态、摘要、失败原因和可用的运行标识；没有上游字段时明确省略而不合成。

## 领域模型

新增独立 `background-activity` 领域，仅负责只读投影和导航意图：

```text
Gateway session/job/run snapshots
  -> SessionOriginClassifier
  -> BackgroundActivityProjection
  -> Sidebar summary / Activity detail / Cron run selection

UI intent
  -> BackgroundActivityReference codec
  -> route query
  -> target-page resolver
```

`BackgroundActivityReference` 是不可变身份而不是展示字符串，至少含：

- `kind`: `cron`、`subagent` 或 `system`；
- `sessionKey`；
- 在 Gateway 已提供时的 `sessionId`；
- Cron 已确认时的 `jobId` 与 `runId`；
- 来源快照的时间戳，仅用于陈旧检测和展示，不能替代身份匹配。

路由编解码器必须只接受完整、可解析的字段；非法或缺字段的深链显示无效目标，不以活动列表第一项、最近会话或当前会话替代。

## 分类规则

1. 先使用 OpenClaw 已返回的结构化 `origin`、父会话和运行状态字段。
2. 仅在官方文档明确的 session key 形态中解析 cron 与 subagent；解析函数集中在协议适配层，并以当前安装版本的文档和真实响应 fixture 覆盖。
3. cron 一律作为后台 cron 运行。不得以 job 名、描述、prompt 或正则关键词推断“梦境”。若未来官方或本项目持久化契约提供语义标签，可作为附加展示标签，不改变后台归属。
4. 未知会话保留在用户会话分组，并以诊断计数或开发期观测发现新增来源；生产 UI 不暴露内部 key 作为用户文案。

## 下钻行为

| 类型 | 目标 | 成功条件 | 无法确认时 |
| --- | --- | --- | --- |
| Cron | Cron 页面任务详情与对应运行详情 | `jobId` 匹配，且 `runId` 或官方返回的 session 关联精确匹配 | 仅定位任务，运行详情显示不可用原因 |
| 子智能体 | Chat 中的精确会话实例 | `sessionKey` 存在，`sessionId` 存在时也匹配 | 显示会话已不可用，不打开另一条会话 |
| 系统 | 活动中心的精确会话详情 | `sessions.describe` 或当前快照确认同一实例 | 保留 URL 并显示已不可用，不选中其他活动 |

Cron 页面不得从 session key 中自行伪造 run 详情。只有 Gateway 的 `cron.runs` 记录给出可验证的 `runId` 或会话关联后，才显示该次运行的摘要、错误、耗时与交付状态。

## UI 设计

侧栏行显示标题、来源、生命周期状态和相对或绝对时间；错误摘要只在上游已经提供且无敏感信息时显示。点击行打开详情，删除仍是独立确认操作。

活动中心新增被选择活动的详情面板。面板的标题使用 Agent、任务或会话已验证显示名；技术身份放在按需展开的技术详情中。Cron 页面保留任务主从布局，在运行历史中以稳定选中态标记精确 run。

三种页面共享同一投影和引用解析器；侧栏不直接调用 Gateway，Cron 页面不解析侧栏专用参数，活动中心不重建分类规则。

## 未验证边界

- 当前本地官方文档确认 RPC 能力，但 `cron.runs` 响应中 session 关联字段的实际形态必须在当前 Gateway 真实响应中记录后才能成为匹配契约。
- 已过保留期的 cron session 或运行日志不可恢复；产品只呈现不可用原因。
- 需要在 macOS、Windows 与 Linux 的桌面真机中验证深链、会话重置和 Gateway 重连行为。
