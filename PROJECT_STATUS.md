# 项目交接状态

更新时间：2026-08-08

## 当前目标

完成 Jarvis 首次启动、Gateway 能力证据与会话工具栏收敛；修复会话组织操作错误请求管理员权限的问题，并将智能体中心 Office 扩展为配置工位与真实运行投影共存的工作区域。

## 已完成内容

- 智能体中心默认进入 Office；树状、网格和活动视图仍可切换。Gateway 返回的配置智能体始终展示为静态员工席位，`junqi.collab.run.list` 与 `junqi.collab.run.get` 的真实运行与参与证据只作为同一工作区的运行覆盖层；不新增协作写语义或运行状态。
- 合并后的首次启动完成门禁区分 `verified`、`failed` 与 `unavailable`。官方模型实时验证不可用时保留待核验告警并允许进入工作区；明确验证失败才阻断。
- 会话工具栏移除会话旁问、会话变更与会话文件的本地入口、专属 Gateway 客户端、测试和文案；保留实际工具、浏览器控制、分支、会话上下文与会话产物的直接入口。
- Gateway 能力证据注册表记录保守的 hello 发现以及真实 RPC 成功、未授权、未知方法、连接失效和待核验结果，不把方法列表缺项视作不支持。
- 安装向导、Gateway 第三阶段和 Ready 页已收敛加载、交接、动效与窄窗口行为；三处发行版本在合并来源中统一为 `2.2.11`。
- 会话重命名、置顶、未读、归档和分组不再向 `sessions.patch` 发送 `expectedSessionId`，统一按 OpenClaw 字段级最小权限走 `operator.write`；模型与运行参数仍保留 `operator.admin`。

## 关键技术决策

- OpenClaw 官方 `openclaw.setup.verify` 可用时是实时模型验证依据；方法不可用只能表达待核验，不能伪报模型成功或凭据失败。
- OpenClaw 当前未提供或产品不再消费的会话能力不保留隐藏入口、兼容层或本地替代实现。
- OpenClaw 的 `expectedSessionId` 虽是正式 patch schema 字段，但最新官方字段级授权将其归入管理员路径；日常组织操作不得携带它，也不得用客户端 CAS 代替。
- Office 不将配置智能体伪装为运行参与者；无 Run 时的员工席位明确标记为配置目录，默认选择最近更新的未归档 Run，用户操作只导航到既有协作详情。

## 核心文件

- `src/pages/AgentHub/AgentHubOfficePanel.tsx`、`src/pages/AgentHub/agentHubOfficeRunSelection.ts`、`src/pages/AgentHub/index.tsx`：智能体中心 Office 投影、稳定选择与默认视图。
- `src/services/setup/setupCompletionGate.ts`、`src/hooks/useSetupFlow/index.ts`、`src/hooks/useSetupFlow/useWizardSession.ts`：首次启动完成门禁与交接呈现。
- `src/services/gateway/GatewayCapabilityRegistry.ts`、`src/services/gateway/Connection.ts`：Gateway 能力证据。
- `src/components/Chat/SessionContextBar.tsx`、`src/services/gateway/index.ts`：会话工具栏和无消费者会话能力的移除。
- `src/services/gateway/SessionSettingsClient.ts`、`src/services/gateway/OpenClawSessionOrganizationClient.ts`、`src/utils/sessionRename.ts`：会话组织字段的最小权限请求与确认投影。
- `docs/collaboration/agent-hub-office-default-design-2026-08-08.md`、`docs/installation/junqi-installation-flow.md`、`docs/quality/openclaw-session-diff-files-removal-2026-08-08.md`：设计与验证记录。

## 测试与验证

- 合并后已通过 63 项首次启动与 Office 定向测试、2822 项全量测试、TypeScript、模块边界、语言 JSON 解析、`pnpm build`、官方文档链接验证与 `git diff --check`。
- 最新办公室工作区改动已通过 9 项 Office 定向测试、TypeScript、模块边界、语言 JSON 解析与 `git diff --check`。
- 会话组织权限修复已通过 TypeScript 及 86 项会话设置、组织、生命周期、重命名与 store 定向测试。
- 全量测试仅输出既有 Radix SSR `useLayoutEffect` 与 Node 弃用警告，命令成功结束。

## 已知问题

- 尚未在真实 Tauri 的亮色、暗色、护眼和午夜主题，以及窄窗口中人工验收 Office 与首次启动流程。
- 尚未以真实 Gateway 的大量协作 Run、长目标文本和高频事件验证 Office 密度与刷新体验。
- Windows 与 Linux 的安装、凭据库和首次启动行为仍需真实环境验收。

## 已放弃方案

- 不阻断已完成官方 Wizard 的“实时模型验证方法不可用”状态，也不把它描述为模型已验证。
- 不为已删除的会话旁问、会话变更和会话文件维护本地 fallback 或无消费者封装。
- 不将配置智能体直接填充为 Run 的参与成员、在线状态或执行状态。

## 下一步顺序

1. 解决合并后全部冲突并运行受影响的定向测试。
2. 运行 TypeScript、模块边界、完整构建和差异检查。
3. 在真实 Tauri 中验收首次启动与智能体中心 Office，再根据用户明确授权提交或发布。
