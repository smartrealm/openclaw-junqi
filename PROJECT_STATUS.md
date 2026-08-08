# 项目交接状态

更新时间：2026-08-08

## 当前目标

完成 Jarvis 首次启动、Gateway 能力证据、会话工具栏、模型目录与 Cron 写入并发围栏收敛；修复会话组织操作错误请求
管理员权限的问题，将智能体中心 Office 扩展为配置工位与真实运行投影共存的工作区域，并保持 Windows Gateway
冷启动与新建空会话链路可恢复。

## 已完成内容

- 智能体中心默认进入 Office；树状、网格和活动视图仍可切换。Gateway 返回的配置智能体始终展示为静态员工席位，`junqi.collab.run.list` 与 `junqi.collab.run.get` 的真实运行与参与证据只作为同一工作区的运行覆盖层；不新增协作写语义或运行状态。
- 合并后的首次启动完成门禁区分 `verified`、`failed` 与 `unavailable`。官方模型实时验证不可用时保留待核验告警并允许进入工作区；明确验证失败才阻断。
- 会话工具栏移除会话旁问、会话变更与会话文件的本地入口、专属 Gateway 客户端、测试和文案；保留实际工具、浏览器控制、分支、会话上下文与会话产物的直接入口。
- Gateway 能力证据注册表记录保守的 hello 发现以及真实 RPC 成功、未授权、未知方法、连接失效和待核验结果，不把方法列表缺项视作不支持。
- 安装向导、Gateway 第三阶段和 Ready 页已收敛加载、交接、动效与窄窗口行为；三处发行版本在合并来源中统一为 `2.2.11`。
- 会话重命名、置顶、未读、归档和分组不再向 `sessions.patch` 发送 `expectedSessionId`，统一按 OpenClaw 字段级最小权限走 `operator.write`；模型与运行参数仍保留 `operator.admin`。
- Gateway 端点使用统一规范化规则识别等价回环地址，重启后继续读取所选 runtime 的认证凭据；旧的 `aegis-config`
  双轨存储路径已删除。
- 默认主会话以 OpenClaw `agents.list.mainKey` 为准，在会话状态层固定为最左侧不可关闭、不可拖拽的页签。
- 修复 `sessions.list` 先于 `sessions.create` 本地提交时的竞态：创建确认会合并到已存在的同 key 行，保留
  `sessionId`、Agent 身份和 `activeLeafEntryId: null`，新会话不再误触发历史加载。
- Cron Job 的安全投影保留 Gateway 返回的可选 `configRevision`；启停与 Agent 路由更新仅在该真实令牌存在时将其
  原样传给官方 `cron.update` 的 `expectedConfigRevision`，不生成本地令牌。
- Provider 编辑页不再维护独立的宽松 `models.list` 解码器；它复用严格的 Gateway 目录投影，只展示结构正确且
  明确 `available: true` 的当前运行时模型。

## 关键技术决策

- OpenClaw 官方 `openclaw.setup.verify` 可用时是实时模型验证依据；方法不可用只能表达待核验，不能伪报模型成功或凭据失败。
- OpenClaw 当前未提供或产品不再消费的会话能力不保留隐藏入口、兼容层或本地替代实现。
- OpenClaw 的 `expectedSessionId` 虽是正式 patch schema 字段，但最新官方字段级授权将其归入管理员路径；日常组织操作不得携带它，也不得用客户端 CAS 代替。
- Office 不将配置智能体伪装为运行参与者；无 Run 时的员工席位明确标记为配置目录，默认选择最近更新的未归档 Run，用户操作只导航到既有协作详情。
- 新会话是否为空只接受 OpenClaw 创建确认的身份与空 leaf，不依据空消息数组推断，也不跳过已有会话的权威历史读取。
- Kun 的 Graph、Loop、调度与恢复均属于 Kun 自有运行时语义，且项目采用 PolyForm Noncommercial 许可证。JunQi
  仅记录其“前端投影宿主真实状态”的设计参考，不复制代码、资源或以其能力补足 OpenClaw 协议。
- 官方 `openclaw.setup.auth.start` 的 `authChoice` 是 `openclaw.setup.detect` 返回的选择标识，不能由 JunQi 的
  Provider 模板或 profile 标识推导；因此 Provider 页保持现有官方 CLI 入口，不伪造为 Gateway Wizard 调用。

## 核心文件

- `src/pages/AgentHub/AgentHubOfficePanel.tsx`、`src/pages/AgentHub/agentHubOfficeRunSelection.ts`、`src/pages/AgentHub/index.tsx`：智能体中心 Office 投影、稳定选择与默认视图。
- `src/services/setup/setupCompletionGate.ts`、`src/hooks/useSetupFlow/index.ts`、`src/hooks/useSetupFlow/useWizardSession.ts`：首次启动完成门禁与交接呈现。
- `src/services/gateway/GatewayCapabilityRegistry.ts`、`src/services/gateway/Connection.ts`：Gateway 能力证据。
- `src/components/Chat/SessionContextBar.tsx`、`src/services/gateway/index.ts`：会话工具栏和无消费者会话能力的移除。
- `src/services/gateway/SessionSettingsClient.ts`、`src/services/gateway/OpenClawSessionOrganizationClient.ts`、`src/utils/sessionRename.ts`：会话组织字段的最小权限请求与确认投影。
- `src/services/gateway/GatewayConnectionTargetResolver.ts`、`src/stores/chatStore.ts`、`src/components/Chat/ChatTabs.tsx`：
  Gateway 冷启动身份、默认主会话固定和新建会话状态合并。
- `src/services/gateway/cronRuns.ts`、`src/services/gateway/OpenClawCronManagementClient.ts`、`src/pages/CronMonitor.tsx`：
  Cron 修订令牌读取、传递与读后确认。
- `src/pages/ConfigManager/providerGatewayCatalog.ts`、`src/pages/ConfigManager/ProvidersTab.tsx`、
  `src/services/gateway/modelCatalog.ts`：Provider 编辑页和会话选择器共用的模型可用性投影。
- `docs/collaboration/agent-hub-office-default-design-2026-08-08.md`、`docs/installation/junqi-installation-flow.md`、`docs/quality/openclaw-session-diff-files-removal-2026-08-08.md`：设计与验证记录。
- `docs/quality/windows-gateway-cold-start-and-main-session-pinning-2026-08-08.md`、
  `docs/quality/openclaw-confirmed-empty-session-audit-2026-08-05.md`：Windows 冷启动和新建空会话竞态记录。

## 测试与验证

- main 合并前已通过 63 项首次启动与 Office 定向测试、2822 项全量测试、TypeScript、模块边界、语言 JSON 解析、`pnpm build`、官方文档链接验证与 `git diff --check`。
- 最新办公室工作区改动已通过 9 项 Office 定向测试、TypeScript、模块边界、语言 JSON 解析与 `git diff --check`。
- 会话组织权限修复已通过 TypeScript 及 86 项会话设置、组织、生命周期、重命名与 store 定向测试。
- 全量测试仅输出既有 Radix SSR `useLayoutEffect` 与 Node 弃用警告，命令成功结束。
- 合并 main 后已通过 TypeScript、模块边界、版本一致性、完整 `pnpm test`（2829 项应用测试与 243 项脚本测试）和 `pnpm build`。
- Windows Gateway 端点、默认主会话固定和新建会话竞态回归继续通过；`git diff --check` 与 Emoji 扫描在提交前再次执行。
- 本轮以 OpenClaw 官方源码当前 `main` 提交 `3075acd549a5c76ad776cd8be5edff8ee6d47b55` 复核
  `sessions.create`、`openclaw.setup.verify`、`models.probe` 与 `cron.*` schema/handler；Cron 定向 18 项测试、
  `pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check` 均已执行通过。
- 模型目录收敛已通过 3 项定向回归、`pnpm lint`、完整 `pnpm test`、`pnpm build`、`git diff --check` 和本次文件的
  Emoji 扫描；全量测试输出既有 Radix SSR `useLayoutEffect` 与 Node 弃用警告，但命令成功结束。

## 已知问题

- 尚未在真实 Tauri 的亮色、暗色、护眼和午夜主题，以及窄窗口中人工验收 Office 与首次启动流程。
- 尚未以真实 Gateway 的大量协作 Run、长目标文本和高频事件验证 Office 密度与刷新体验。
- Windows 与 Linux 的安装、凭据库和首次启动行为仍需真实环境验收。
- Windows 真机新建会话、首条消息发送和重启后 Gateway 恢复尚未完成安装包验收。

## 已放弃方案

- 不阻断已完成官方 Wizard 的“实时模型验证方法不可用”状态，也不把它描述为模型已验证。
- 不为已删除的会话旁问、会话变更和会话文件维护本地 fallback 或无消费者封装。
- 不将配置智能体直接填充为 Run 的参与成员、在线状态或执行状态。
- 不在 ChatView 仅依据消息为空跳过历史，不把 Windows 时序问题用平台专属分支掩盖。

## 下一步顺序

1. 在真实 Tauri 中验收首次启动、智能体中心 Office、Windows 新建会话、Cron 并发冲突提示和 Gateway 重启恢复。
2. 继续以最新版 OpenClaw 官方 schema/handler 审查安装、模型、会话与任务投影的剩余链路，并仅修复有复现证据的
   协议漂移。
3. 后续根据用户明确授权提交或发布，不把未完成的 Windows 真机验收描述为已完成。
