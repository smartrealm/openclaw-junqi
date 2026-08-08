# 项目交接状态

更新时间：2026-08-08

## 当前目标

完成 Jarvis 首次启动、Gateway 能力证据与会话工具栏收敛，并保留智能体中心默认 Office 只读投影。

## 已完成内容

- 智能体中心默认进入 Office；树状、网格和活动视图仍可切换。Office 只投影 `junqi.collab.run.list` 与 `junqi.collab.run.get` 的真实运行与参与证据，不新增协作写语义。
- 合并后的首次启动完成门禁区分 `verified`、`failed` 与 `unavailable`。官方模型实时验证不可用时保留待核验告警并允许进入工作区；明确验证失败才阻断。
- 会话工具栏移除会话旁问、会话变更与会话文件的本地入口、专属 Gateway 客户端、测试和文案；保留实际工具、浏览器控制、分支、会话上下文与会话产物的直接入口。
- Gateway 能力证据注册表记录保守的 hello 发现以及真实 RPC 成功、未授权、未知方法、连接失效和待核验结果，不把方法列表缺项视作不支持。
- 安装向导、Gateway 第三阶段和 Ready 页已收敛加载、交接、动效与窄窗口行为；三处发行版本在合并来源中统一为 `2.2.11`。

## 关键技术决策

- OpenClaw 官方 `openclaw.setup.verify` 可用时是实时模型验证依据；方法不可用只能表达待核验，不能伪报模型成功或凭据失败。
- OpenClaw 当前未提供或产品不再消费的会话能力不保留隐藏入口、兼容层或本地替代实现。
- Office 不将配置智能体伪装为运行参与者；默认选择最近更新的未归档 Run，用户操作只导航到既有协作详情。

## 核心文件

- `src/pages/AgentHub/AgentHubOfficePanel.tsx`、`src/pages/AgentHub/agentHubOfficeRunSelection.ts`、`src/pages/AgentHub/index.tsx`：智能体中心 Office 投影、稳定选择与默认视图。
- `src/services/setup/setupCompletionGate.ts`、`src/hooks/useSetupFlow/index.ts`、`src/hooks/useSetupFlow/useWizardSession.ts`：首次启动完成门禁与交接呈现。
- `src/services/gateway/GatewayCapabilityRegistry.ts`、`src/services/gateway/Connection.ts`：Gateway 能力证据。
- `src/components/Chat/SessionContextBar.tsx`、`src/services/gateway/index.ts`：会话工具栏和无消费者会话能力的移除。
- `docs/collaboration/agent-hub-office-default-design-2026-08-08.md`、`docs/installation/junqi-installation-flow.md`、`docs/quality/openclaw-session-diff-files-removal-2026-08-08.md`：设计与验证记录。

## 测试与验证

- 合并后已通过 63 项首次启动与 Office 定向测试、2822 项全量测试、TypeScript、模块边界、语言 JSON 解析、`pnpm build`、官方文档链接验证与 `git diff --check`。
- 全量测试仅输出既有 Radix SSR `useLayoutEffect` 与 Node 弃用警告，命令成功结束。

## 已知问题

- 尚未在真实 Tauri 的亮色、暗色、护眼和午夜主题，以及窄窗口中人工验收 Office 与首次启动流程。
- 尚未以真实 Gateway 的大量协作 Run、长目标文本和高频事件验证 Office 密度与刷新体验。
- Windows 与 Linux 的安装、凭据库和首次启动行为仍需真实环境验收。

## 已放弃方案

- 不阻断已完成官方 Wizard 的“实时模型验证方法不可用”状态，也不把它描述为模型已验证。
- 不为已删除的会话旁问、会话变更和会话文件维护本地 fallback 或无消费者封装。
- 不将配置智能体直接填充到 Office。

## 下一步顺序

1. 解决合并后全部冲突并运行受影响的定向测试。
2. 运行 TypeScript、模块边界、完整构建和差异检查。
3. 在真实 Tauri 中验收首次启动与智能体中心 Office，再根据用户明确授权提交或发布。
