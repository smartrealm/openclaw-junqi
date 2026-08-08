# 项目交接状态

更新时间：2026-08-08

## 当前目标

完成 OpenClaw Cron 执行权限、日历提醒调度投影和 Cron 页面展示层收敛；保持所有计划、运行记录和权限
语义以官方 Gateway 协议为准，不在 JunQi 本地扩展调度器。

## 已完成内容

- 智能体中心默认进入 Office；树状、网格和活动视图仍可切换。Gateway 返回的配置智能体始终展示为静态员工席位，`junqi.collab.run.list` 与 `junqi.collab.run.get` 的真实运行与参与证据只作为同一工作区的运行覆盖层；不新增协作写语义或运行状态。
- 合并后的首次启动完成门禁区分 `verified`、`failed` 与 `unavailable`。官方模型实时验证不可用时保留待核验告警并允许进入工作区；明确验证失败才阻断。
- 会话工具栏移除会话旁问、会话变更与会话文件的本地入口、专属 Gateway 客户端、测试和文案；保留实际工具、浏览器控制、分支、会话上下文与会话产物的直接入口。
- Gateway 能力证据注册表记录保守的 hello 发现以及真实 RPC 成功、未授权、未知方法、连接失效和待核验结果，不把方法列表缺项视作不支持。
- 安装向导、Gateway 第三阶段和 Ready 页已收敛加载、交接、动效与窄窗口行为；四处发行版本当前统一为 `2.2.12`。
- 会话重命名、置顶、未读、归档和分组不再向 `sessions.patch` 发送 `expectedSessionId`，统一按 OpenClaw 字段级最小权限走 `operator.write`；模型与运行参数仍保留 `operator.admin`。
- Gateway 端点使用统一规范化规则识别等价回环地址，重启后继续读取所选 runtime 的认证凭据；旧的 `aegis-config`
  双轨存储路径已删除。
- 默认主会话以 OpenClaw `agents.list.mainKey` 为准，在会话状态层固定为最左侧不可关闭、不可拖拽的页签。
- 修复 `sessions.list` 先于 `sessions.create` 本地提交时的竞态：创建确认会合并到已存在的同 key 行，保留
  `sessionId`、Agent 身份和 `activeLeafEntryId: null`，新会话不再误触发历史加载。
- `cron.run` 已从普通读取连接迁入短生命周期管理员通道，`cron.runs` 继续走只读通道；客户端不在页面层处理权限令牌。
- 日历提醒改由纯调度构建器投影为 OpenClaw 官方 `at`、`every`、`cron` 计划；跨午夜周提醒、固定间隔与不可表达
  的月年规则均有明确处理，不再以错误 Cron 表达式或无限 pending 伪装成功。
- Cron 模板与日历提醒内容改从 i18n 资源和运行时本地时区生成；Cron 页面将模板、状态推导与本地化格式化抽至
  独立展示模块，移除按任务名称猜测业务图标的做法。

## 关键技术决策

- OpenClaw 官方 `openclaw.setup.verify` 可用时是实时模型验证依据；方法不可用只能表达待核验，不能伪报模型成功或凭据失败。
- OpenClaw 当前未提供或产品不再消费的会话能力不保留隐藏入口、兼容层或本地替代实现。
- OpenClaw 的 `expectedSessionId` 虽是正式 patch schema 字段，但最新官方字段级授权将其归入管理员路径；日常组织操作不得携带它，也不得用客户端 CAS 代替。
- Office 不将配置智能体伪装为运行参与者；无 Run 时的员工席位明确标记为配置目录，默认选择最近更新的未归档 Run，用户操作只导航到既有协作详情。
- 新会话是否为空只接受 OpenClaw 创建确认的身份与空 leaf，不依据空消息数组推断，也不跳过已有会话的权威历史读取。

## 核心文件

- `src/pages/AgentHub/AgentHubOfficePanel.tsx`、`src/pages/AgentHub/agentHubOfficeRunSelection.ts`、`src/pages/AgentHub/index.tsx`：智能体中心 Office 投影、稳定选择与默认视图。
- `src/services/setup/setupCompletionGate.ts`、`src/hooks/useSetupFlow/index.ts`、`src/hooks/useSetupFlow/useWizardSession.ts`：首次启动完成门禁与交接呈现。
- `src/services/gateway/GatewayCapabilityRegistry.ts`、`src/services/gateway/Connection.ts`：Gateway 能力证据。
- `src/components/Chat/SessionContextBar.tsx`、`src/services/gateway/index.ts`：会话工具栏和无消费者会话能力的移除。
- `src/services/gateway/SessionSettingsClient.ts`、`src/services/gateway/OpenClawSessionOrganizationClient.ts`、`src/utils/sessionRename.ts`：会话组织字段的最小权限请求与确认投影。
- `src/services/gateway/GatewayConnectionTargetResolver.ts`、`src/stores/chatStore.ts`、`src/components/Chat/ChatTabs.tsx`：
  Gateway 冷启动身份、默认主会话固定和新建会话状态合并。
- `src/services/gateway/OpenClawCronRunClient.ts`、`src/services/gateway/index.ts`：Cron 执行与读取权限通道。
- `src/pages/Calendar/cronReminderSchedule.ts`、`src/pages/Calendar/calendarReminderContent.ts`、`src/stores/calendarStore.ts`：
  日历提醒的官方计划投影、文本与副作用协调。
- `src/pages/cronPresentation.tsx`、`src/pages/CronMonitor.tsx`：Cron 页面模板、状态和本地化展示边界。
- `docs/collaboration/agent-hub-office-default-design-2026-08-08.md`、`docs/installation/junqi-installation-flow.md`、`docs/quality/openclaw-session-diff-files-removal-2026-08-08.md`：设计与验证记录。
- `docs/quality/windows-gateway-cold-start-and-main-session-pinning-2026-08-08.md`、
  `docs/quality/openclaw-confirmed-empty-session-audit-2026-08-05.md`：Windows 冷启动和新建空会话竞态记录。

## 测试与验证

- main 合并前已通过 63 项首次启动与 Office 定向测试、2822 项全量测试、TypeScript、模块边界、语言 JSON 解析、`pnpm build`、官方文档链接验证与 `git diff --check`。
- 最新办公室工作区改动已通过 9 项 Office 定向测试、TypeScript、模块边界、语言 JSON 解析与 `git diff --check`。
- 会话组织权限修复已通过 TypeScript 及 86 项会话设置、组织、生命周期、重命名与 store 定向测试。
- Cron 本轮已通过 20 项定向测试：权限通道、运行记录、日历跨日与间隔规则、无效日期拒绝、Cron 关联、提醒时间本地化和
  模板时区；TypeScript 和三份语言 JSON 解析通过。
- 全量 `pnpm test` 通过；仅输出既有 Radix SSR `useLayoutEffect` 与 Node 弃用警告。`pnpm lint`、`pnpm build` 和
  `git diff --check` 也已通过。
- 合并 main 后已通过 TypeScript、模块边界、版本一致性、完整 `pnpm test`（2829 项应用测试与 243 项脚本测试）和 `pnpm build`。
- Windows Gateway 端点、默认主会话固定和新建会话竞态回归继续通过；`git diff --check` 与 Emoji 扫描在提交前再次执行。

## 已知问题

- 尚未在真实 Tauri 的亮色、暗色、护眼和午夜主题，以及窄窗口中人工验收 Office 与首次启动流程。
- 尚未以真实 Gateway 的大量协作 Run、长目标文本和高频事件验证 Office 密度与刷新体验。
- Windows 与 Linux 的安装、凭据库和首次启动行为仍需真实环境验收。
- Windows 真机新建会话、首条消息发送和重启后 Gateway 恢复尚未完成安装包验收。
- 尚未以真实 Gateway 验收 Cron 管理员授权、手动执行与日历副作用；`everyMs` 跨夏令时遵循 OpenClaw 固定间隔
  语义，无法准确表达的有界或复杂月年规则明确显示为未支持。

## 已放弃方案

- 不阻断已完成官方 Wizard 的“实时模型验证方法不可用”状态，也不把它描述为模型已验证。
- 不为已删除的会话旁问、会话变更和会话文件维护本地 fallback 或无消费者封装。
- 不将配置智能体直接填充为 Run 的参与成员、在线状态或执行状态。
- 不在 ChatView 仅依据消息为空跳过历史，不把 Windows 时序问题用平台专属分支掩盖。

## 下一步顺序

1. 在真实 Tauri 和真实 Gateway 中验收 Cron 管理、日历提醒创建更新删除以及管理员授权错误呈现。
2. 在目标平台继续验收首次启动、智能体中心 Office、Windows 新建会话和 Gateway 重启恢复。
