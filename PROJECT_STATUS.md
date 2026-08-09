# 项目交接状态

更新时间：2026-08-09

## 当前目标

保持 JunQi 作为 OpenClaw 桌面客户端的边界：首次启动由官方 Wizard 统一编排，钉钉业务能力由 OpenClaw 插件和 DWS 官方 CLI 提供，模型认证和配置字段只呈现当前 Gateway 已证明的状态。本阶段已将本地 `Blues-Code/dingtalk` 分支合并到当前 `Blues-Code/Jarvis`，统一钉钉业务工作台的信息架构，并保留主线已有的真实 DWS 安装、授权和运行时身份围栏。当前还在收敛工作台会话侧栏，使智能体范围、主会话入口、分组、排序和新建会话归属与 OpenClaw 官方会话契约一致。

## 已完成内容

- 首次引导将 Gateway 就绪和 OpenClaw 配置核验统一在同一阶段。默认仅调用官方 `wizard.start`，不创建独立渠道流程，也不发送未经官方会话证明的 `flow` 或 `skipChannels` 参数。
- 官方 Wizard 的 `note`、`text`、`select`、`multiselect`、`confirm`、`progress` 与 `action` 通过独立步骤渲染器注册表呈现，JunQi 不按步骤标识或渠道名称推断流程。
- 钉钉工作台只从当前 Session 的 `tools.effective` 投影能力，并通过 `tools.invoke` 与插件审批调用。DWS 业务命令不由 React 或 Tauri 直接执行。
- DWS 缺失时，已核验的 Native 或 Docker 运行时可启动官方 npm 安装或设备授权流程。输出仅临时投影到当前窗口并做敏感信息隐藏；完成后重新读取插件、Profile 和 Session 工具状态。
- 钉钉插件安装、Agent 双重授权、Gateway 重启和运行时身份围栏均保留真实未就绪与失败语义，不以本地状态推断成功。
- 钉钉业务工作台已统一为“有效工具”“操作审计”“接入与授权”三个稳定入口，URL 查询参数只接受这三个已定义视图，未知值回到有效工具，不创建额外状态。
- 工具表格只按当前 `tools.effective` 返回的真实业务域分组；工具与审计视图仅在存在阻断、错误或待核验状态时显示 readiness，接入视图集中呈现 Session、插件、Agent 双层授权和 DWS 身份证据。
- 合并冲突按完整调用链收敛：保留主线的本机或 Docker 官方 DWS 安装与设备授权操作、取消和输出投影，同时接入分支的三视图侧栏、分组表格、运行时身份工作区和对应验证文档；未保留任一侧的残缺双轨实现。
- Jarvis 设置页明确区分 Gateway Voice Wake 配置和 JunQi 手动 Talk。`talk.catalog` 的目录无效、实时提供方未就绪、原生音频中继不兼容均作为结构化失败呈现。
- 智能体中心 Office 只将配置席位呈现为虚拟工位。真实协作参与、在线和执行状态只来自 OpenClaw 协作 Run 证据。
- 会话组织操作使用 OpenClaw 最小 `operator.write` 权限；默认主会话由 `defaultId`、`mainKey` 和 `scope` 按官方路由规则解析，新会话创建确认保留空 leaf，避免错误加载历史。
- 默认智能体仅由 `agents.list.defaultId` 决定新会话归属；全局固定、关闭保护和删除保护仅匹配解析后的完整默认主会话 key。其他智能体已有的直聊主会话按普通会话处理。
- “打开主会话”不再构造 `agent:<id>:main`。仅当 Gateway 已返回默认主会话或会话列表已确认对应直聊会话时打开；否则提示不可用并保留官方 `sessions.create` 新建路径。
- 聊天通知只由带 OpenClaw 原生 `runId` 的流式终态发布；持久转录只更新会话、历史和未读状态，不参与通知。
- Provider 页不再单列“OpenClaw 认证状态”面板。官方认证健康、必要的到期信息和实时验证入口合并到对应 Provider 卡片；注销只在展开区出现，Gateway 不支持时不生成空白区域，畸形回包在列表标题下就近提示。
- 原独立认证面板、专属测试和无引用多语言文案已删除；新的行为测试直接覆盖卡片认证摘要和展开区操作，不再通过源码字符串断言实现写法。
- 配置中心公共 schema 服务严格解析官方 `config.schema` 响应信封，只将 `schema` 字段交给结构化编辑器；成功缓存绑定当前已认证 Gateway 连接 ID，连接切换后的迟到结果失败关闭。
- 工具页不再把请求失败和 Runtime 未公开 `tools` 字段混成同一提示。读取失败提供显式重试，字段缺失保持真实只读语义，工具目录、有效工具和受控调用仍独立呈现其官方 RPC 状态。
- 工作台会话侧栏已改为按 `agents.list` 选择智能体，只展示该智能体的 Gateway 会话；新建会话明确绑定当前选择，Gateway 已确认的主会话固定为首行，智能体和会话拉取的加载与失败状态在操作附近真实呈现。
- 会话侧栏已删除日期分桶、旧分桶偏好和工作台重复导航，改为 OpenClaw 官方的自定义分组或不分组、创建时间或最近更新；底部复用现有 `/sessions` 完整管理入口。
- 会话分类只保留 OpenClaw 原生 `category`，已删除无消费者的 `groupId` 影子字段及其投影、身份重置和测试断言。

## 关键技术决策

- OpenClaw 是 Agent、会话、工具、Transcript、任务和运行时状态的唯一权威；JunQi 仅保存绑定运行时身份的派生投影。
- DWS 认证、Profile、token 与业务执行属于 DWS 和 OpenClaw 插件。桌面侧不读取 token、不写入 transcript、不执行远程脚本，也不重放未知副作用。
- `talk.catalog.realtime.ready=false` 仅表示 Gateway 实时语音未就绪，客户端不会切换到本地语音实现或伪报可用。
- OpenClaw 官方 `openclaw.setup.verify` 可用时才作为模型实时验证依据；能力不可用时保持待核验。
- OpenClaw `config.schema` 的权威响应是包含 `schema`、`uiHints`、`version` 和 `generatedAt` 的信封；JunQi 不接受裸 schema、别名字段、版本 fallback 或方法广告门禁。
- 会话侧栏复用全局权威 `sessions.list` 缓存做智能体只读投影，不增加第二套轮询、缓存或会话协议；非默认智能体主会话只从 Gateway 已返回的 key 解析。
- 最新 OpenClaw Control UI 还提供创建者、状态和定时会话过滤；本轮按最小需求不复制这些入口，避免与 JunQi 现有归档区和后台活动区形成双轨。

## 核心文件

- `src/pages/SetupPage/OpenClawConfigurationScreen.tsx`、`src/pages/SetupPage/WizardScreen.tsx`、`src/pages/SetupPage/wizard/`、`src/services/openclawWizard.ts`：首次引导和官方 Wizard 步骤投影。
- `src/pages/BusinessApplicationsPage.tsx`、`src/components/BusinessApplications/`、`src/business-applications/dingtalkTools.ts`：钉钉工作台的能力、就绪状态、调用和活动投影。
- `src-tauri/src/commands/dws_operation.rs`、`src/api/tauri-commands.ts`：DWS 官方安装与设备授权、输出脱敏、取消及 IPC 契约。
- `packages/junqi-dingtalk/`、`src-tauri/src/commands/dingtalk_plugin.rs`：OpenClaw 钉钉插件、打包资源和运行时身份围栏。
- `src/services/gateway/TalkGatewayClient.ts`、`src/services/voice/TalkConversationCoordinator.ts`、`src/components/settings/JarvisVoiceSettingsPanel.tsx`：Talk 状态和 Voice Wake 配置边界。
- `src/utils/sessionLifecycle.ts`、`src/utils/sessionDelete.ts`、`src/stores/chatStore.ts`、`src/utils/sessionLabel.ts`：主会话身份、删除、页签固定与标签投影。
- `src/components/Chat/ChatTabs.tsx`、`src/components/Layout/NavSidebar.tsx`、`src/pages/Dashboard/index.tsx`、`src/pages/AgentHub/index.tsx`：默认智能体与 Gateway 主会话展示入口。
- `src/pages/ConfigManager/ProvidersTab.tsx`、`src/pages/ConfigManager/ProvidersTab.modelAuthStatus.test.tsx`：Provider 卡片内的 Gateway 认证健康、实时验证与受控注销展示。
- `src/services/openclawConfigSchema.ts`、`src/services/openclawConfigSchema.test.ts`、`src/pages/ConfigManager/ToolsTab.tsx`：官方配置 schema 信封解析、连接围栏、缓存和工具页状态呈现。
- `src/components/Layout/NavSidebar.tsx`、`src/components/Layout/SessionScopeControls.tsx`、`src/components/Layout/sidebarUtils.ts`：智能体作用域会话列表、主会话首行、分组排序和完整会话入口。
- `src/stores/chatStore.ts`、`src/utils/openClawSessionProjection.ts`：移除会话分类影子字段，只保留 Gateway `category`。

## 测试与验证

- 合并前首次引导重构已通过 `pnpm lint`、完整 `pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、语言 JSON 解析、`git diff --check` 和完整 Emoji 扫描。
- 本次 Jarvis 与 `main` 合并后已通过 `pnpm lint`、完整 `pnpm test`（前端 2851 项、脚本 243 项）、`cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib`。测试输出仅包含既有 Node 弃用与 Radix SSR 警告，没有失败。
- 本次通知收敛已通过 `pnpm test`（前端 2851 项、脚本 243 项）、`cargo fmt -- --check`、`cargo check --lib` 与 `cargo test --lib commands::notification`（15 项）。
- 默认智能体与主会话本轮审计确认 `agents.list.mainKey` 是会话后缀，完整默认主会话按 `defaultId`、`mainKey` 和 `scope` 解析。已通过 `pnpm lint`、113 项定向会话与 Gateway 回归、完整 `pnpm test`、`pnpm build`、`git diff --check` 和完整 Emoji 扫描；测试仅输出既有 Node 弃用与 Radix SSR 警告。
- Provider 认证状态重设计已通过 15 项认证链路定向回归、完整 `pnpm test`（前端 2845 项、脚本 243 项）、`pnpm lint`、`pnpm build`、`pnpm verify:openclaw-docs`、locale JSON 解析、`git diff --check` 和完整修改文件 Emoji 扫描。最终键盘交互调整后再次通过定向回归、lint 与 build。
- Runtime 配置 schema 修复已通过 11 项定向回归、`pnpm lint`、完整 `pnpm test` 和 `pnpm build`。完整测试包含前端与服务 2851 项、脚本 243 项，无失败；输出仅有既有 Node 弃用和 Radix 服务端渲染警告。
- 本次钉钉分支合并已通过 8 项视图、工具分组与共享页签动效定向回归、`pnpm lint`、完整 `pnpm test` 和 `pnpm build`。生产构建重新生成并校验协作插件与钉钉插件资源包；输出仅有既有 Node 弃用和 Radix 服务端渲染警告。
- 智能体作用域会话侧栏已通过 74 项定向侧栏、新建会话与 ChatStore 回归、完整 `pnpm test`（2855 项）、`pnpm lint`、生产 `pnpm build`、locale JSON 解析和 `git diff --check`。完整测试首次发现旧守护仍要求侧栏从活动会话推断新建目标，已按新的显式智能体选择契约更新后复跑通过；输出仅包含既有 Node 弃用和 Radix 服务端渲染警告。

## 已知问题

- 尚未在真实 Gateway 验收钉钉插件安装、`tools.effective`、`tools.invoke`、插件审批、DWS 授权和真实租户业务响应。
- 尚未在 macOS、Windows、Linux、Docker Gateway 中验证 DWS 安装、凭据、取消和重连的真实行为。
- 尚未在真实 Tauri 验收首次启动、钉钉工作台和 Jarvis 页面在亮色、暗色、窄窗口和键盘焦点下的视觉表现。
- OpenClaw 目前没有提供适用于 Windows、Ubuntu 或 CentOS 通用桌面客户端的 Voice Wake 运行时命中事件；JunQi 不能宣称跨平台后台唤醒已实现。
- 尚未用返回非传统 `defaultId` 或 `mainKey` 的真实 Gateway 完成 Tauri 真机视觉验收；本次自动化覆盖了该身份差异的纯函数、删除与会话列表边界。
- 本机 OpenClaw 运行时代码和随包文档对自定义 `session.mainKey` 是否生效存在差异；JunQi 仅处理当前 Gateway 已返回的字段。最新版官方线上文档本轮请求服务不可用，未完成线上版本复核。
- 尚未在真实 Gateway 验收 Provider 卡片中的 OAuth/token 到期、实时探测、注销和畸形回包；尚未在真实 Tauri 完成该页面亮色、暗色、窄窗口、键盘焦点、加载、失败和空数据状态的视觉验收。
- 尚未在真实 Native、Docker 和跨平台 Gateway 中验收工具 schema 加载、插件扩展字段、连接切换与重试；工具页亮色、暗色、窄窗口和键盘焦点仍需 Tauri 真机验证。
- 尚未在真实多智能体 Gateway 和 Tauri 中验收会话侧栏的智能体切换、全局主会话、分类顺序、归档恢复，以及亮色、暗色和窄窗口视觉表现。

## 尝试过但未采用的方案

- 未直接选择冲突任一侧的 `DingTalkReadinessPanel`。只保留主线会丢失三个稳定工作区，只保留 dingtalk 分支会丢失真实 DWS 安装、授权、取消和输出投影，因此最终使用两条已验证链路的单一组合实现。
- 合并后恢复旧工作区时，三种语言中的工作区键与分支已落入的同名键重复；重复位置已删除，只保留每种语言唯一键，避免 JSON 解析时静默覆盖。
- 未复制 OpenClaw 最新侧栏的创建者、状态和定时会话过滤；这些能力超出当前确认范围，并会与 JunQi 现有归档和后台活动呈现重复。

## 下一步顺序

1. 在真实 Tauri 和真实 Gateway 中验收默认 Wizard、钉钉插件安装与授权、工具审批和错误恢复。
2. 在目标平台验收手动 Talk 的麦克风、实时提供方和音频设备；官方桌面 Voice Wake 扩展点出现前不实现后台唤醒。
3. 使用非传统默认智能体和主会话 key 的真实 Gateway 验收页签固定、关闭删除、打开直聊主会话和官方新建会话。
4. 在真实 Gateway 和 Tauri 中验收 Provider 卡片认证摘要、实时验证确认、受控注销及主题与窄窗口表现。
5. 在 Native 和 Docker Runtime 中切换 Gateway，验收工具配置 schema 重新加载、空字段、授权失败和重试状态。
6. 在真实多智能体 Gateway 中验收侧栏智能体作用域、主会话首行、分类排序、新建会话归属和 `/sessions` 入口，再完成三套桌面平台的主题与窄窗口视觉验收。
