# CodexLoom、OpenClaw 与 JunQi 对齐记录

日期：2026-08-03

## 依据

- [CodexLoom README](https://github.com/yan5xu/codexloom/blob/main/README.zh-CN.md)：稳定 Domain Agent、主 Thread、全局 Activity、Needs You、Artifacts、Topics 和明确的人机边界。
- 本机 OpenClaw `2026.7.1-2` 的随包 schema、handler 和官方文档；OpenClaw 是 Gateway、会话、技能、渠道、定时任务和凭据的运行时权威。
- JunQi 当前 `src/`、`src-tauri/`、`packages/junqi-collab/`、测试和现有质量记录。

## 对照结论

| 优先级 | CodexLoom 的可借鉴点 | OpenClaw 原生能力边界 | JunQi 当前状态 | 处理结论 |
| --- | --- | --- | --- | --- |
| P0 | 全局 Activity 与 Needs You | 原生 Gateway 提供会话、任务、审批和协作插件 RPC；不会替 JunQi 组合跨页面决策入口 | Chat 协作抽屉已有待决事项，Activity Center 已有会话、工作台、Gateway task ledger 和审批，但此前没有协作运行投影 | 已完成应用级协作只读同步；三类权威状态进入 Activity Center，点击后以带 runId 的 Chat 路由打开原运行详情 |
| P0 | 稳定 Agent/Thread 连续性 | OpenClaw 提供 session key、session id、历史、预览、压缩、steering 等能力；每个 Agent 的 direct-chat main key 为 `agent:<agentId>:main`；不会提供 CodexLoom 的 Domain Agent 主 Thread 语义 | JunQi 已保留 origin、session identity、历史和跨会话运行记录；此前 AgentHub 会把普通会话误标为 main，且按列表顺序选择主卡片 | 已修正 canonical main 投影；继续保持 OpenClaw session 语义，不新增 Domain Agent/主 Thread 存储 |
| P1 | Agent Profile（Identity、Domain、Scope） | OpenClaw Agent 配置拥有 id、模型、工作区和技能等运行字段，不等于业务 Domain/Scope | AgentHub 继续管理运行时字段，并在本地 settings 保存受控 domain/scope 画像 | 已落地本地画像；不把未经上游契约支持的字段写入 OpenClaw 配置，删除 Agent 时显式清理并报告失败 |
| P1 | Artifacts 作为托管对象 | OpenClaw 已提供 artifacts.list/get/download；归属和权限由 Gateway 决定 | JunQi 已接入会话产物和协作最终产物预览/下载 | 保持双边界：OpenClaw 产物走官方 RPC，协作最终产物走插件快照，不再复制本地账本 |
| P1 | Schedules、触发器和运行状态 | OpenClaw cron 是定时任务权威，Gateway restart/start 负责运行时生命周期 | JunQi 已接入 cron status/get/runs、任务账本和 Windows 重启恢复；失败不静默切换 runtime | 继续以 Gateway/runtime 状态为准；平台服务只负责生命周期和观测 |
| P2 | 有界 Agent-to-Agent Message、Topics | OpenClaw 原生工具/会话消息不等于协作插件的有界消息模型 | JunQi 协作插件已有 work item、attempt、event、evidence 和 delivery 状态，没有通用 Topic/A2A 收件箱 | 暂不伪造通用消息协议；如要增加，先定义权限、保留期、投递确认和凭据边界 |

## 本轮实现

### 全局协作待决投影

- 新增应用级 `CollaborationActivityRuntime`，在已验证 Gateway 连接上同步 `junqi.collab.run.list`、`junqi.collab.tombstone.list`，并按需刷新三类待决运行的快照。
- `Activity Center` 复用与协作历史抽屉相同的纯投影函数，避免页面之间产生不同的 Needs You 判定。
- 点击 Activity Center 中的协作条目会导航到 `/chat?collaborationRun=<runId>`；Chat 消费该 runId 并打开同一权威运行详情，随后移除一次性查询参数。
- 应用断开或运行时身份不可验证时清空跨连接投影，避免把旧 Gateway 的运行状态显示给新连接。

### 不照搬的部分

- 不把 CodexLoom 的内部 Domain Agent、Thread、Topic 数据模型写入 OpenClaw 配置或协作插件数据库。
- 不因为 README 中的产品能力描述就猜测 OpenClaw RPC、字段、事件或成功条件。
- 不在 JunQi 前端保存 Gateway token、Provider key、设备凭据或协作归档内容。

### Agent Profile 本地元数据

- AgentHub 设置抽屉新增业务域和职责范围字段，数据只写入 JunQi 应用设置，不进入
  `agents.list[]`、`config.patch` 或 Agent 分享包。
- OpenClaw 的 Agent id、显示身份、模型、工作区、技能和渠道仍由 Gateway 负责；本地画像
  只是业务索引，不能改变运行时行为。
- 画像通过独立 Tauri command 持久化，空画像表示删除；删除 Agent 后会清理本地画像，清理
  失败会显式提示，不覆盖已发生的 OpenClaw 删除结果。

### Canonical Agent main session 投影

- OpenClaw 的 `agent:<agentId>:main` 是运行时主会话 key；session id 仍可能在 reset 后更换，
  不能把 key 当作 transcript id。
- AgentHub 现在按 Agent 精确选择 canonical main，普通渠道、group 和 fork session 保持
  `conversation` 分类；ChatTabs 对所有 Agent 的 main 标签统一保护。
- 本次只修正现有 OpenClaw session 的呈现和选择，不复制 CodexLoom 的 Domain Agent/Thread
  数据模型，也不改变 Gateway 生命周期。

### tools.invoke 受控调用

- Chat 上下文栏只从当前 `tools.effective` 投影选择工具，不提供任意字符串命令入口。
- 调用使用当前 session key 和 Agent id，通过日常 `operator.write` 连接发送，参数为 JSON object，
  每次调用前要求确认，并生成一次性幂等键。
- Gateway 的成功、拒绝、审批和工具错误保持结构化；真实外部效果工具和插件审批仍待手工验收。

## 验证与边界

- 当前批次已通过 TypeScript、模块边界、协作投影回归测试、Agent Profile IPC/输入回归测试、
  canonical main session 投影回归测试、
  前端既有测试、脚本测试、Rust 测试、官方文档链接校验、生产构建和 `git diff --check`。
- 本机未连接真实多实例 Gateway 做跨运行时手工验收；Windows Scheduled Task 和目标平台冷重启仍需目标平台验证。
- 本记录只确认 CodexLoom README 中的产品方向，不把其实现细节当作 OpenClaw 官方协议。
