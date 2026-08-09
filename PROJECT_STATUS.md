# 项目交接状态

更新时间：2026-08-09

## 当前目标

统一首次引导中 Gateway 就绪与 OpenClaw 配置核验的用户界面，并使默认 OpenClaw Wizard 成为渠道选择与跳过的唯一权威：
用户在同一个配置阶段内显式核验并原地进入官方 Wizard；JunQi 不创建额外渠道步骤，不发送未由当前会话证明的 `flow` 或 `skipChannels` 参数。

## 已完成内容

- 智能体中心默认进入 Office；树状、网格和活动视图仍可切换。Gateway 返回的配置智能体始终展示为静态员工席位，`junqi.collab.run.list` 与 `junqi.collab.run.get` 的真实运行与参与证据只作为同一工作区的运行覆盖层；不新增协作写语义或运行状态。
- 合并后的首次启动完成门禁区分 `verified`、`failed` 与 `unavailable`。官方模型实时验证不可用时保留待核验告警并允许进入工作区；明确验证失败才阻断。
- 会话工具栏移除会话旁问、会话变更与会话文件的本地入口、专属 Gateway 客户端、测试和文案；保留实际工具、浏览器控制、分支、会话上下文与会话产物的直接入口。
- Gateway 能力证据注册表记录保守的 hello 发现以及真实 RPC 成功、未授权、未知方法、连接失效和待核验结果，不把方法列表缺项视作不支持。
- 安装向导、Gateway 第三阶段和 Ready 页已收敛加载、交接、动效与窄窗口行为；四处发行版本当前统一为 `2.3.0`。
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
- 首次引导只启动默认 OpenClaw `wizard.start`。模型、凭据、工作区、可选消息渠道以及官方跳过说明均在同一个 Gateway 会话中返回和展示。
- 官方 Wizard 的 `note`、`text`、`select`、`multiselect`、`confirm`、`progress`、`action` 由独立渲染器和协议类型注册表分派；JunQi 不按渠道或步骤 id 推断流程。
- Gateway 运行时就绪现在直接投影到“配置 OpenClaw”阶段：用户点击“核验配置”前不启动 Wizard；核验中的加载、真实失败和官方 Wizard 在同一 `SetupShell` 内替换。`gateway-ready` 与 `configure-openclaw` 共享场景键，底层状态交接不重挂载入场动效。
- 已删除无人使用的安装控制台 Gateway 检查点摘要、模型检查摘要及其专属测试；安装控制台只负责安装活动和失败诊断，配置核验由配置阶段容器独占呈现。
- 已删除无消费者的独立渠道向导状态、页面、会话存储、失败分类、语言资源、测试与文档；渠道官方跳过说明保留在默认向导会话中呈现。

## 合并的业务应用与钉钉运行时

- `packages/junqi-dingtalk` 提供 OpenClaw 插件清单、DWS 运行器、工具 schema、Agent 授权和运行时探测；桌面侧只负责受 Runtime Identity 围栏保护的安装与启用。
- 业务应用页已收敛为钉钉工作台的列表、就绪状态、能力表格、参数详情和活动记录，不在 React 或 Tauri 中直接执行 DWS。
- 钉钉工具调用沿 OpenClaw `tools.effective`、`tools.invoke` 和插件审批链路投影；缺少插件、Gateway 工具、身份或授权时保留真实的未就绪语义。
- 钉钉插件安装反馈按目标身份核对、等待 Gateway 安装与启用、结果和重启要求分阶段呈现；外部或远程 Gateway、身份未核验、端点或路径不匹配时明确阻断，不伪造 Gateway 进度。
- 业务能力表格默认优先展示，左侧筛选栏默认收起；搜索、业务域和操作效果筛选集中在表格顶部，租户身份只在工具详情中作为当前调用参数显式传递。
- 合并来源包含插件资源、Tauri 安装命令和生成的 bundle；真实 Gateway、DWS 租户和跨平台安装仍需验收。

## 关键技术决策

- OpenClaw 官方 `openclaw.setup.verify` 可用时是实时模型验证依据；方法不可用只能表达待核验，不能伪报模型成功或凭据失败。
- OpenClaw 当前未提供或产品不再消费的会话能力不保留隐藏入口、兼容层或本地替代实现。
- OpenClaw 的 `expectedSessionId` 虽是正式 patch schema 字段，但最新官方字段级授权将其归入管理员路径；日常组织操作不得携带它，也不得用客户端 CAS 代替。
- Office 不将配置智能体伪装为运行参与者；无 Run 时的员工席位明确标记为配置目录，默认选择最近更新的未归档 Run，用户操作只导航到既有协作详情。
- 新会话是否为空只接受 OpenClaw 创建确认的身份与空 leaf，不依据空消息数组推断，也不跳过已有会话的权威历史读取。

## 核心文件

- `src/pages/AgentHub/AgentHubOfficePanel.tsx`、`src/pages/AgentHub/agentHubOfficeRunSelection.ts`、`src/pages/AgentHub/index.tsx`：智能体中心 Office 投影、稳定选择与默认视图。
- `src/services/setup/setupCompletionGate.ts`、`src/hooks/useSetupFlow/index.ts`、`src/hooks/useSetupFlow/useWizardSession.ts`：首次启动完成门禁与交接呈现。
- `src/services/openclawWizard.ts`、`src/services/openclawWizard.test.ts`：默认官方向导请求、会话恢复与协议回归。
- `src/pages/SetupPage/WizardScreen.tsx`、`src/pages/SetupPage/wizard/`：官方步骤容器、类型注册表和独立步骤渲染器。
- `src/pages/SetupPage/OpenClawConfigurationScreen.tsx`、`src/motion/setupStepTransition.tsx`：统一的 Gateway 配置核验呈现与稳定场景键。
- `src/services/setup/onboardingPresentation.ts`、`src/pages/SetupPage/ProgressScreen.tsx`：配置阶段投影和收敛后的安装进度职责。
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
- 本轮默认向导与结构化步骤渲染器的定向测试待运行；完成后需执行三份语言 JSON 解析、完整 `pnpm test` 与 `pnpm build`。
- 最新办公室工作区改动已通过 9 项 Office 定向测试、TypeScript、模块边界、语言 JSON 解析与 `git diff --check`。
- 会话组织权限修复已通过 TypeScript 及 86 项会话设置、组织、生命周期、重命名与 store 定向测试。
- Cron 本轮已通过 20 项定向测试：权限通道、运行记录、日历跨日与间隔规则、无效日期拒绝、Cron 关联、提醒时间本地化和
  模板时区；TypeScript 和三份语言 JSON 解析通过。
- 全量 `pnpm test` 通过；仅输出既有 Radix SSR `useLayoutEffect` 与 Node 弃用警告。`pnpm lint`、`pnpm build` 和
  `git diff --check` 也已通过。
- 合并 main 后已通过 TypeScript、模块边界、版本一致性、完整 `pnpm test`（2829 项应用测试与 243 项脚本测试）和 `pnpm build`。
- 本次合并 Jarvis 钉钉工作台改动后已通过 `pnpm lint`、钉钉安装反馈与渠道向导定向测试、完整 `pnpm test`（2845 项应用测试与 243 项脚本测试）和 `pnpm build`。
- `v2.3.0` 已推送至 GitHub；本机 macOS ARM64 DMG 已生成并通过 `hdiutil verify`，包内版本为 `2.3.0`。
- Windows Gateway 端点、默认主会话固定和新建会话竞态回归继续通过；`git diff --check` 与 Emoji 扫描在提交前再次执行。
- 配置阶段统一已通过 62 项定向测试、`pnpm lint`、完整 `pnpm test`、`pnpm build`、官方 OpenClaw 文档链接验证和 `git diff --check`；三份语言 JSON 与本次完整 Emoji 扫描通过。
- 本轮移除独立渠道流程后，已通过默认向导与步骤渲染器定向回归、TypeScript、`pnpm lint`、完整 `pnpm test`、`pnpm build`、语言 JSON 解析、官方文档链接、`git diff --check` 与完整 Emoji 扫描。测试过程仅有既有 Radix 服务端渲染与 Node 弃用警告，无失败。

## 已知问题

- 尚未在真实 Tauri 的亮色、暗色、护眼和午夜主题，以及窄窗口中人工验收 Office 与首次启动流程。
- 尚未以真实 Gateway 的大量协作 Run、长目标文本和高频事件验证 Office 密度与刷新体验。
- Windows 与 Linux 的安装、凭据库和首次启动行为仍需真实环境验收。
- Windows 真机新建会话、首条消息发送和重启后 Gateway 恢复尚未完成安装包验收。
- 尚未以真实 Gateway 验收 Cron 管理员授权、手动执行与日历副作用；`everyMs` 跨夏令时遵循 OpenClaw 固定间隔
  语义，无法准确表达的有界或复杂月年规则明确显示为未支持。
- 尚未在真实 Gateway 中验收钉钉插件加载、`tools.effective`、`tools.invoke`、插件审批往返和 DWS 业务响应；当前本地构建只证明源码、bundle 和类型契约成立。
- 钉钉能力表格优先布局与安装反馈尚未在真实 Tauri 的亮色、暗色、窄窗口和键盘焦点下人工验收。
- 本地 `pnpm tauri build --bundles app,dmg` 在 DMG 生成后因缺少 `TAURI_SIGNING_PRIVATE_KEY` 无法生成 updater 签名；该本地包仅用于安装验证，不能替代 GitHub 发布制品。
- 尚未在 macOS、Windows、Linux 真机上完成默认首次向导中的渠道插件授权、二维码或设备代码交互；这些行为仍以目标 Gateway 和官方插件返回为准。
- 尚未在真实 Tauri 中人工验收统一配置阶段的亮色、暗色、窄窗口、键盘焦点和真实 Gateway Wizard 交接；自动化只证明组件、状态机与协议调用边界。
- 尚未在真实 Gateway 中完成默认首次向导对渠道跳过说明、插件授权、二维码或设备代码的端到端验收。

## 已放弃方案

- 不阻断已完成官方 Wizard 的“实时模型验证方法不可用”状态，也不把它描述为模型已验证。
- 不为已删除的会话旁问、会话变更和会话文件维护本地 fallback 或无消费者封装。
- 不将配置智能体直接填充为 Run 的参与成员、在线状态或执行状态。
- 不在 ChatView 仅依据消息为空跳过历史，不把 Windows 时序问题用平台专属分支掩盖。

## 下一步顺序

1. 在真实 Tauri 中验收默认 OpenClaw Wizard 的渠道选择、跳过说明、插件授权、Cron 管理、日历提醒创建更新删除以及管理员授权错误呈现。
2. 在真实 Gateway 中验收钉钉插件安装、工具刷新、只读调用、写操作审批和错误恢复。
3. 在目标平台继续验收首次启动、智能体中心 Office、Windows 新建会话和 Gateway 重启恢复。
4. 在真实 Tauri 和真实 Gateway 中验收统一配置阶段的核验、失败、官方 Wizard 交接以及亮暗主题和窄窗口表现。
