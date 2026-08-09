# 项目交接状态

更新时间：2026-08-09

## 当前目标

保持 JunQi 作为 OpenClaw 桌面客户端的边界：首次启动由官方 Wizard 统一编排，钉钉业务能力由 OpenClaw 插件和 DWS 官方 CLI 提供，Jarvis 只呈现当前 Gateway 已证明的手动 Talk 能力。本阶段继续收敛默认智能体、Gateway 主会话和其他智能体直聊主会话的展示与操作边界。

## 已完成内容

- 首次引导将 Gateway 就绪和 OpenClaw 配置核验统一在同一阶段。默认仅调用官方 `wizard.start`，不创建独立渠道流程，也不发送未经官方会话证明的 `flow` 或 `skipChannels` 参数。
- 官方 Wizard 的 `note`、`text`、`select`、`multiselect`、`confirm`、`progress` 与 `action` 通过独立步骤渲染器注册表呈现，JunQi 不按步骤标识或渠道名称推断流程。
- 钉钉工作台只从当前 Session 的 `tools.effective` 投影能力，并通过 `tools.invoke` 与插件审批调用。DWS 业务命令不由 React 或 Tauri 直接执行。
- DWS 缺失时，已核验的 Native 或 Docker 运行时可启动官方 npm 安装或设备授权流程。输出仅临时投影到当前窗口并做敏感信息隐藏；完成后重新读取插件、Profile 和 Session 工具状态。
- 钉钉插件安装、Agent 双重授权、Gateway 重启和运行时身份围栏均保留真实未就绪与失败语义，不以本地状态推断成功。
- Jarvis 设置页明确区分 Gateway Voice Wake 配置和 JunQi 手动 Talk。`talk.catalog` 的目录无效、实时提供方未就绪、原生音频中继不兼容均作为结构化失败呈现。
- 智能体中心 Office 只将配置席位呈现为虚拟工位。真实协作参与、在线和执行状态只来自 OpenClaw 协作 Run 证据。
- 会话组织操作使用 OpenClaw 最小 `operator.write` 权限；默认主会话由 `defaultId`、`mainKey` 和 `scope` 按官方路由规则解析，新会话创建确认保留空 leaf，避免错误加载历史。
- 默认智能体仅由 `agents.list.defaultId` 决定新会话归属；全局固定、关闭保护和删除保护仅匹配解析后的完整默认主会话 key。其他智能体已有的直聊主会话按普通会话处理。
- “打开主会话”不再构造 `agent:<id>:main`。仅当 Gateway 已返回默认主会话或会话列表已确认对应直聊会话时打开；否则提示不可用并保留官方 `sessions.create` 新建路径。
- 聊天通知只由带 OpenClaw 原生 `runId` 的流式终态发布；持久转录只更新会话、历史和未读状态，不参与通知。

## 关键技术决策

- OpenClaw 是 Agent、会话、工具、Transcript、任务和运行时状态的唯一权威；JunQi 仅保存绑定运行时身份的派生投影。
- DWS 认证、Profile、token 与业务执行属于 DWS 和 OpenClaw 插件。桌面侧不读取 token、不写入 transcript、不执行远程脚本，也不重放未知副作用。
- `talk.catalog.realtime.ready=false` 仅表示 Gateway 实时语音未就绪，客户端不会切换到本地语音实现或伪报可用。
- OpenClaw 官方 `openclaw.setup.verify` 可用时才作为模型实时验证依据；能力不可用时保持待核验。

## 核心文件

- `src/pages/SetupPage/OpenClawConfigurationScreen.tsx`、`src/pages/SetupPage/WizardScreen.tsx`、`src/pages/SetupPage/wizard/`、`src/services/openclawWizard.ts`：首次引导和官方 Wizard 步骤投影。
- `src/pages/BusinessApplicationsPage.tsx`、`src/components/BusinessApplications/`、`src/business-applications/dingtalkTools.ts`：钉钉工作台的能力、就绪状态、调用和活动投影。
- `src-tauri/src/commands/dws_operation.rs`、`src/api/tauri-commands.ts`：DWS 官方安装与设备授权、输出脱敏、取消及 IPC 契约。
- `packages/junqi-dingtalk/`、`src-tauri/src/commands/dingtalk_plugin.rs`：OpenClaw 钉钉插件、打包资源和运行时身份围栏。
- `src/services/gateway/TalkGatewayClient.ts`、`src/services/voice/TalkConversationCoordinator.ts`、`src/components/settings/JarvisVoiceSettingsPanel.tsx`：Talk 状态和 Voice Wake 配置边界。
- `src/utils/sessionLifecycle.ts`、`src/utils/sessionDelete.ts`、`src/stores/chatStore.ts`、`src/utils/sessionLabel.ts`：主会话身份、删除、页签固定与标签投影。
- `src/components/Chat/ChatTabs.tsx`、`src/components/Layout/NavSidebar.tsx`、`src/pages/Dashboard/index.tsx`、`src/pages/AgentHub/index.tsx`：默认智能体与 Gateway 主会话展示入口。

## 测试与验证

- 合并前首次引导重构已通过 `pnpm lint`、完整 `pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、语言 JSON 解析、`git diff --check` 和完整 Emoji 扫描。
- 本次 Jarvis 与 `main` 合并后已通过 `pnpm lint`、完整 `pnpm test`（前端 2851 项、脚本 243 项）、`cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib`。测试输出仅包含既有 Node 弃用与 Radix SSR 警告，没有失败。
- 本次通知收敛已通过 `pnpm test`（前端 2851 项、脚本 243 项）、`cargo fmt -- --check`、`cargo check --lib` 与 `cargo test --lib commands::notification`（15 项）。
- 默认智能体与主会话本轮审计确认 `agents.list.mainKey` 是会话后缀，完整默认主会话按 `defaultId`、`mainKey` 和 `scope` 解析。已通过 `pnpm lint`、113 项定向会话与 Gateway 回归、完整 `pnpm test`、`pnpm build`、`git diff --check` 和完整 Emoji 扫描；测试仅输出既有 Node 弃用与 Radix SSR 警告。

## 已知问题

- 尚未在真实 Gateway 验收钉钉插件安装、`tools.effective`、`tools.invoke`、插件审批、DWS 授权和真实租户业务响应。
- 尚未在 macOS、Windows、Linux、Docker Gateway 中验证 DWS 安装、凭据、取消和重连的真实行为。
- 尚未在真实 Tauri 验收首次启动、钉钉工作台和 Jarvis 页面在亮色、暗色、窄窗口和键盘焦点下的视觉表现。
- OpenClaw 目前没有提供适用于 Windows、Ubuntu 或 CentOS 通用桌面客户端的 Voice Wake 运行时命中事件；JunQi 不能宣称跨平台后台唤醒已实现。
- 尚未用返回非传统 `defaultId` 或 `mainKey` 的真实 Gateway 完成 Tauri 真机视觉验收；本次自动化覆盖了该身份差异的纯函数、删除与会话列表边界。
- 本机 OpenClaw 运行时代码和随包文档对自定义 `session.mainKey` 是否生效存在差异；JunQi 仅处理当前 Gateway 已返回的字段。最新版官方线上文档本轮请求服务不可用，未完成线上版本复核。

## 下一步顺序

1. 在真实 Tauri 和真实 Gateway 中验收默认 Wizard、钉钉插件安装与授权、工具审批和错误恢复。
2. 在目标平台验收手动 Talk 的麦克风、实时提供方和音频设备；官方桌面 Voice Wake 扩展点出现前不实现后台唤醒。
3. 使用非传统默认智能体和主会话 key 的真实 Gateway 验收页签固定、关闭删除、打开直聊主会话和官方新建会话。
