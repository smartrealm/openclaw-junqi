# 项目交接状态

更新时间：2026-08-09

## 当前目标

钉钉单平台业务工作台已完成第二轮信息架构收敛，当前目标是完成插件运行时与真实业务契约验收。实现采用独立 OpenClaw 钉钉插件包装 DWS，业务页与 Chat 共用
`tools.effective`、`tools.invoke` 和插件审批；Tauri 只负责经过 Runtime Identity 围栏的插件安装与启用，不直接执行 DWS。
正式 DWS 发布包、真实 Gateway 审批往返和测试租户端到端仍是下一步门禁。

## 本阶段已完成

- 已将业务应用左侧栏收敛为“有效工具”“操作审计”“接入与授权”三个稳定入口，删除页面内部重复页签和无业务价值的说明占位。
- 已新增独立接入工作区，分别呈现 Session、插件、Agent 双层授权和 DWS 身份核验，并展示 DWS 返回的头像、用户、组织、Profile、状态、到期时间和授权域。
- 已在 Agent 授权阻断状态提供 OpenClaw 工具策略与插件 `allowedAgentIds` 配置入口；最终有效状态仍只由当前 Session 的 `tools.effective` 核验。
- 已在完全就绪时隐藏工具与审计页面的 readiness 状态条；阻断、错误和待核验状态继续内联呈现。
- 已将工具表格按真实业务域分组，并把工具 ID、DWS canonical path、schema 摘要和 JSON 参数收进高级披露区。
- 已完成 `packages/junqi-dingtalk` 插件、30 工具 manifest、schema 校验、DWS runner、审批 hook、打包资源和 Tauri 安装命令。
- 已完成专属 Agent 的双层授权实现和 DWS 当前用户/授权投影；`allowedAgentIds` 空配置失败关闭，工作台自动读取运行状态并展示用户、组织、profile 状态和安全头像地址。
- 已完成紧凑 DWS readiness 状态条；按实际运行结果引导插件安装、Gateway 重启、Agent 授权、DWS 官方安装交接、身份确认和重新检测，不自动安装 DWS 或伪造授权结果。
- 已完成钉钉业务活动的双层审计投影：优先展示当前 Gateway 跨 Session 的 OpenClaw metadata-only 钉钉工具账本，补充本窗口受控调用的 runtime、Session、Agent、Profile、审批和 DWS 关联元数据；无上游委派证据时不推断关系。
- 已完成 DWS 缺失安装交接弹层：按 Gateway 运行位置说明安装目标，提供官方 macOS/Linux、Windows、npm 入口、登录命令、复制、官方文档和重新检测；不执行远程脚本或读取 token。
- 已完成钉钉业务插件未就绪时的“在 JunQi 安装”入口；安装仍受当前 Gateway 身份验证和桌面变更权限约束，完成后必须重启 Gateway 并重新读取当前 Session 工具。
- DWS runner 已收紧为最小环境白名单，不继承 Gateway token、DWS access token 或其他无关进程密钥。
- 环境白名单回归、插件重新打包和最新 `pnpm build` 已通过，桌面资源中的插件归档已核对包含该实现。
- 已完成业务页生产迁移：钉钉单平台、当前 Session 工具投影、左筛选/中表格/右详情三栏、拖拽和收起、参数 schema 展示、调用状态与脱敏活动投影。
- 已删除旧多平台目录、Chat bridge、静态 Journal 及其专属测试和无引用导出，不保留兼容双轨。
- 已通过 `pnpm test`、`pnpm lint`、`pnpm build`、`pnpm verify:openclaw-docs`、`pnpm check:boundaries`、Rust `cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`、插件测试/校验/打包和 `git diff --check`。

## 当前未验证

- 正式 DWS 发布包安装、真实钉钉租户权限和业务响应 envelope 尚未执行。
- 真实 Gateway 中插件加载、`tools.effective`、`tools.invoke`、`plugin.approval.*` 往返尚未执行。
- macOS、Windows、Linux、Docker Gateway 的安装、凭据库、重启和亮暗主题/键盘/窄窗口真机视觉验收尚未执行。
- 2026-08-08 本机 PATH 未发现 `dws`，当前 OpenClaw `2026.7.1-2` 的插件列表没有 `junqi-dingtalk`；本轮只读确认，未改变本机 Gateway 或认证状态。

## 已完成内容

- 已完成钉钉单平台业务工作台设计说明、独立 HTML 交互预览和生产页面迁移；当前页面已进入 `src/`，不展示飞书或 Google，也不保留页面内重复导航。
- 已完成钉钉业务运行时设计、领域术语、ADR、规格、分阶段实施计划以及阶段 1、阶段 2 的插件和前端实现。
- 已核对 OpenClaw 主线提交 `733512b612e5fcfa96ca0764ac1851990406f187` 的 `tools.effective`、`tools.invoke`、插件工具注册与 `plugin.approval.*` 失败关闭边界。
- 已核对 DWS 主线提交 `18030f1018f9d23e699063c4511987e660bb1701`，并从官方源码运行 product schema 与 auth/profile help；确认 `profile list/switch/use` 和 `oa approval create-instance` 当前正式存在。
- 已确认 2026-08-02 旧设计中的 Tauri 直连 DWS、无 profile、无审批发起命令假设不再作为实现契约；旧文档只保留历史记录。
- 已规划删除飞书、Google、旧 Chat bridge、静态 Journal 和无消费者 descriptor，不保留双轨兼容路径。
- 已移除设计中的平台目录和页内平台切换，当前窗口只出现钉钉；主画布不设居中最大宽度，全局侧栏、筛选面板和右侧详情均可收起。
- 已核对 Langfuse 官方仓库 `017ba00e5080486786029fe68cf03e889320b958` 的 `AppSidebar`、`PageHeader`、`ResizableFilterLayout`、`DataTable`、`TablePeekView` 和 `TraceLayoutDesktop`，只借鉴其主表格优先、可折叠轨道、拖拽宽度与就地详情模式。
- 独立预览已改为能力表格主画布：筛选面板默认 228px、收起为 40px，详情面板默认 382px、收起为 40px；两侧宽度均可拖拽，点击能力行原位更新详情。
- 已将运行时、身份、授权和能力快照全部绑定到当前 Runtime Identity、Session `tools.effective` 和真实 OpenClaw 调用结果；未核验状态不会被渲染为成功。
- 已核对当前 OpenClaw 官方源码中的 `openclaw.setup.verify` 与 `models.probe` handler，以及 JunQi 的
  `wizard.start`、`wizard.next`、`wizard.status`、`wizard.cancel` 调用链。
- 已复现本机选定 Gateway 在认证连接正常时对上述两个实时验证方法返回 `INVALID_REQUEST: unknown method`。
  验证客户端已严格识别该已知方法不存在形态，因此当前运行时缺少官方验证能力，不能作为模型或凭据失败处理。
- 已核对发布边界：本机 `openclaw` 与 npm `latest` 均为 `2026.7.1-2`；已查阅的官方源码主线包含上述
  handler，但该能力尚未进入当前稳定 npm 包。不能把主线源码能力描述为用户当前可直接升级获得的稳定功能。
- 已复现官方 Wizard 完成后的服务交接在本机约需 85 秒恢复 JunQi 的认证连接；此前统一 20 秒等待会过早超时。
- 完成门禁已由布尔结果改为三种结构化状态：`verified`、`failed`、`unavailable`。
- 官方验证能力不可用时，首次配置、Gateway 就绪页和工作台入口都保留“模型待核验”警告并继续；只有官方方法
  返回明确失败时才阻断进入。
- 官方服务交接与来源变化恢复路径使用 120 秒有界认证连接等待；初始连接和普通 Wizard 操作仍维持 20 秒。
- 已更新首次启动流程预览、全链路审计、规格和计划，记录当前运行时与官方源码的能力差异及验证边界。
- 已清理会话上下文栏中的旧制品下载器、全局技能计数、全局工具配置和全局活动入口；这些入口不属于当前会话操作。
- 当前会话工具栏保留实际工具、浏览器控制、分支、会话上下文和会话产物；五项能力均直接可达，会话旁问、会话变更、会话文件和统一“更多”外壳均已移除。
- 已解除会话标签对规范主会话的关闭限制：`ChatTabs` 为所有已打开标签提供关闭按钮和中键关闭，`chatStore.closeTab`
  只更新本地标签投影；`removeSession` 仍独立禁止删除规范主会话。
- 已收敛会话助手头像的视觉层次：`AssistantResponseAvatar` 移除高饱和主色渐变，改用 `aegis-elevated`、`aegis-border`
  和低透明度主色内层强调；身份标记、字母或官方名称对应图标保持不变，回复头像与输入中指示器继续复用同一实现。
- 已对照 `docs/openclaw-features.md`、JunQi 当前代码和最新版 OpenClaw 官方协议完成功能审计：动态命令、运行时渠道、
  Gateway Skills、工具、浏览器、Task Ledger、审批和配置 CAS 已有真实链路；本地 Skill Hub、自动化契约、插件目录、
  Nodes/Canvas 和聚合安全姿态列为后续边界收敛项，未据历史文档新增伪能力。
- 已新增 Gateway 能力证据注册表：hello methods/events、协商角色与 scope 作为保守发现事实，RPC 成功、未授权、方法不存在、
  连接失效、无效响应和待核验分别记录；省略方法不会被直接判为不支持，连接失效时证据随 socket 清除。
- 已收敛本地 Skill Hub 边界：欢迎页改用 Gateway `skills.status` 的共享状态；`/skill-hub` 保留为明确标注的本地目录与项目链接工具，
  不再参与 Gateway 技能计数、安装和权限语义。
- 已统一 Automations/Cron 读模型：`cron.list`、`cron.get` 和 `cron.runs` 共用严格 parser，覆盖官方时间与事件调度、payload kind、
  pacing、delivery、failureAlert、运行状态和诊断相关字段；运行记录使用官方分页 envelope，轮询超时保留为待核验。
- 已完成会话工具栏加固：顶部图标统一复用 `ChatIconButton` 的可见 Tooltip、`aria-label` 和 `title` 兜底；有效工具、浏览器控制、分支、会话上下文和会话产物均作为独立直接入口，不保留统一“更多”菜单。
- 已补充安装与首次启动端到端总览 `docs/installation/junqi-installation-flow.md`，将运行时选择、数据位置、Gateway 交接、官方 Wizard、
  三重完成门禁、Ready/Dashboard 进入、恢复语义和跨平台未验证边界统一串联，并从 `docs/README.md` 提供唯一总览入口。
- 已校正顶部阶段与页面语义：欢迎页是五个真实配置阶段之前的前置页，阶段条不点亮任何项目；进入检测页后环境检测才作为第一阶段点亮，下一步路由与阶段显示一致。
- 已重新设计 Gateway 就绪检查点：它继续属于第三阶段运行时，顶部以高亮完成勾选表达“本阶段完成但尚未前进”；页面保留阶段标识、Gateway 状态、继续说明和完成度，安装时间线与日志默认折叠为“查看安装详情”，配置核验成功后才进入第四阶段或直接完成。
- 已收敛第三阶段重复完成信息：页面标题负责表达 Gateway 与当前配置核验动作，检查点只显示一次运行时检查完成数，不再叠加“就绪”和 100%；后续配置核验的检查中或失败状态不会覆盖已经完成的运行时检查点。
- 已全链审查并收敛 Setup 步骤切换闪动与横向溢出：首次欢迎页直接呈现；用户决策态改为 12px、180 毫秒的近不透明方向入场，检测、安装、Gateway 和失败运行态改为 4px、140 毫秒的近不透明纵向入场。主内容区只允许纵向滚动，顶部阶段条改为五列自适应网格，场景变换和窄窗口阶段展示都不再生成横向滚动条；旧页面立即卸载约束保持不变。
- 已整链移除会话变更与会话文件：删除两个入口、专属组件、会话文件编辑器与草稿状态、Gateway 客户端和门面方法、专属测试、三种语言文案及失效的规格、计划和验证记录；终端 Git 变更、文件管理、Agent 文件与会话产物保持原行为。保留的分支、会话上下文和会话产物改为独立直接入口，原统一“更多”状态和文案同步删除。
- 已移除当前 Gateway 未提供的会话旁问入口、专属 RPC 客户端、Hook、测试、国际化文案和本地 `/btw`/`/side` 拦截；普通问题恢复为主会话发送。官方能力与未来恢复边界记录在
  `docs/quality/openclaw-session-companion-removal-2026-08-07.md`。
- 已排查窗口偶发卡顿的高频路径：聊天流刷新会驱动动态岛快照并向独立窗口发送跨窗口事件；新增 100ms 尾部调度器合并最新快照，隐藏和销毁时取消过期回调，不改变 OpenClaw 权威状态。
- 已修正 Ready 页运行偏好的首屏跳动：Gateway 与 JunQi Desktop 自启动状态并行读取，两个结果落定前保持同尺寸完整骨架，避免单行先出现或不支持项加载后重排。
- 已重做 Setup 步骤切换动效：步骤状态提交后立即卸载旧页面，只让当前页面执行 200 毫秒的小幅方向入场；下一步从右侧进入、上一步从左侧进入，系统开启减少动态效果时立即呈现。
- 已删除退出页面的存在态、指针层级和并存生命周期，避免数据位置页的本地单飞引用与异步 effect 在返回后继续影响当前页面。
- 已统一环境检测页的操作门禁和按钮状态：`idle`、`navigating`、`redetecting` 三态同时驱动原子单飞保护和可渲染忙碌状态，上一步、重新检测和下一步不会再呈现可用却被处理器静默拒绝。
- Git 追溯确认环境操作锁由 `a14eeecf` 引入，`62b00964` 仅完成 hook 拆分并保留旧释放时机；未提交的退出页保留动效改变了 Setup 原有的立即卸载契约。本轮按两项根因一起修复，不再叠加单点引用补丁。

## 关键技术决策

- 业务应用页当前直接呈现唯一真实实现钉钉，不在页面内展示或切换多个平台；第二个平台具备真实消费者前不增加一值配置。
- 业务应用页复用现有窗口壳层和 `aegis-*` 语义主题体系，不增加网页式大标题、应用卡片墙或独立于桌面导航的第二套外壳。
- 能力表格是业务工作台的主画布；筛选和详情是可收起、可调整宽度的辅助面板，不能永久挤占固定窗口宽度。
- 当前 UI 只投影现有插件、Session、Agent 和 DWS 结构化结果；真实 DWS 发布包、租户权限与业务终态仍需独立验收。
- 钉钉业务运行时归属 OpenClaw 插件，不归属 Tauri。业务页和 Chat 必须使用同一组固定插件工具、Session 有效工具清单和插件审批。
- DWS leaf schema 是插件参数与安全元数据依据；JunQi 只维护产品 allowlist 和稳定工具契约，不暴露任意 DWS 命令入口。
- 所有业务写操作只提供一次授权或拒绝，成功响应后必须权威重读；`non_idempotent` 或未知结果不得自动重放。
- 当前只有钉钉一个真实实现，不增加一值平台配置。第二个平台具备真实消费者时再引入保证单平台展示的产品配置。
- `openclaw.setup.verify` 可用时是模型实时验证的唯一证据。不得以 Gateway 健康、静态模型引用、`models.probe`
  或本地推断替代成功条件。
- “官方方法不可用”与“官方方法已执行但模型验证失败”必须分开建模和呈现。前者是待核验状态，不能伪报模型成功，
  也不能把当前稳定版不存在的能力当作安装阻断；后者才提示修正模型或凭据并阻断进入。
- Gateway 交接等待只扩展在官方服务 handoff 路径，使用有限上限；不得把普通 RPC 等待改成全局长等待或无限重试。
- 已完成的官方 Wizard 不得因为验证或交接失败被自动重放。JunQi 只能保留待核验状态并等待用户修正官方运行时。

## 核心文件

- `packages/junqi-dingtalk/src/index.ts`、`dws-runner.ts`、`schema-contract.ts`、`tool-specs.ts`：固定钉钉工具、DWS 受控执行、schema 校验和写操作审批。
- `scripts/build-dingtalk-plugin-bundle.mjs`、`src-tauri/resources/dingtalk/`：插件归档、摘要 metadata 与桌面资源同步。
- `src-tauri/src/commands/dingtalk_plugin.rs`、`src/api/tauri-commands.ts`：受 Runtime Identity 围栏保护的插件状态、安装和启用 IPC。
- `src/pages/BusinessApplicationsPage.tsx`、`src/business-applications/businessApplicationsView.ts`、`dingtalkTools.ts`、`activityStore.ts`：稳定视图路由、当前 Session 的钉钉工具投影、直接调用与脱敏活动记录。
- `src/components/BusinessApplications/`：接入检查、DWS 身份与授权、分组工具表、详情、活动和无障碍可拖拽分隔条。
- `docs/business/dingtalk-single-platform-ui-design-2026-08-08.md`：钉钉单平台窗口结构、状态语义、响应式和实现边界。
- `docs/previews/junqi-dingtalk-business-workspace.html`：包含侧栏、检查器、主题和页内选中态交互的独立设计预览。
- `docs/business/dingtalk-business-runtime-implementation-design-2026-08-08.md`：OpenClaw 插件、DWS、身份、审批、幂等、投影和分期架构。
- `docs/business/CONTEXT.md`：钉钉业务工作台规范术语和上下文边界。
- `docs/adr/0002-openclaw-plugin-owned-dingtalk-business-runtime.md`：DWS 运行时归属决策及被否决方案。
- `specs/business/2026-08-08-dingtalk-business-runtime.md`：运行时、只读 MVP 和写操作验收契约。
- `plans/business/2026-08-08-dingtalk-business-runtime.md`：契约实验、插件骨架、前端接入、只读和写入阶段计划。
- `src/services/setup/setupCompletionGate.ts`：完成门禁的结构化验证结果和失败原因。
- `src/hooks/useSetupFlow/index.ts`：将官方验证客户端结果映射到完成门禁，并在 Gateway 就绪页和工作台入口保留
  不可用与失败的不同语义。
- `src/hooks/useSetupFlow/useWizardSession.ts`：官方服务交接后的有界认证重连，以及 Wizard 终态验证分支。
- `src/services/gateway/OpenClawSetupVerificationClient.ts`：官方 `openclaw.setup.verify` RPC 的严格响应解析与
  不可用错误类型。
- `src/services/setup/setupCompletionGate.test.ts` 与 `src/hooks/setupOnboardingRegression.test.ts`：结构化结果与
  handoff 路径回归覆盖。
- `src/components/Chat/SessionContextBar.tsx`、`src/services/gateway/index.ts`：会话上下文栏入口和 Gateway 门面收敛。
- `src/components/Chat/ChatTabs.tsx`、`src/stores/chatStore.ts`、`src/stores/chatStore.test.ts`：标签关闭与会话删除边界，
  以及规范主会话标签关闭回归。
- `src/components/Chat/MessageBubble.tsx`：会话助手头像的主题表面和前景层次。
- `src/services/gateway/GatewayCapabilityRegistry.ts`、`src/services/gateway/Connection.ts`：Gateway 能力发现与 RPC 结果证据。
- `src/services/gateway/cronRuns.ts`、`src/services/gateway/OpenClawCronRunClient.ts`、`src/stores/gatewayDataStore.ts`：统一 Cron 读取与运行记录契约。
- `src/components/Chat/ChatIconButton.tsx`、`src/services/gateway/gatewayRecoveryRegression.test.ts`：会话工具栏 Tooltip 与已移除入口回归。
- `src/dynamic-island/DynamicIslandRuntime.tsx`、`src/dynamic-island/DynamicIslandUpdateScheduler.ts`：动态岛快照跨窗口发布节流及生命周期取消。
- `src/pages/SetupPage/ReadyScreen.tsx`、`src/components/settings/AutostartPreferenceRow.tsx`：运行偏好并行加载、完整骨架和稳定开关行。
- `src/pages/SetupPage/index.tsx`、`src/motion/setupStepTransition.tsx`：首次启动步骤路由的当前页方向入场、旧页立即卸载和减少动态效果适配。
- `src/hooks/useSetupFlow/environmentReviewAction.ts`、`src/hooks/useSetupFlow/useSetupEnvironmentReview.ts`、`src/pages/SetupPage/EnvironmentReviewScreen.tsx`：环境检测页的操作状态机、可渲染忙碌状态和统一按钮门禁。
- `docs/installation/setup-round-trip-navigation-audit-2026-08-08.md`、`docs/installation/setup-round-trip-navigation-validation-2026-08-08.md`、`specs/installation/2026-08-08-setup-round-trip-navigation.md`、`plans/installation/2026-08-08-setup-round-trip-navigation.md`：往返导航根因、验证证据、验收契约和实施顺序。
- `docs/quality/session-toolbar-controls-hardening-2026-08-07.md`、`specs/quality/2026-08-07-session-toolbar-controls-hardening.md`、`plans/quality/2026-08-07-session-toolbar-controls-hardening.md`：本轮入口收敛、协议边界与验证记录。
- `docs/quality/openclaw-session-diff-files-removal-2026-08-08.md`、`specs/quality/2026-08-08-openclaw-session-diff-files-removal.md`、`plans/quality/2026-08-08-openclaw-session-diff-files-removal.md`：会话变更与会话文件的删除范围、验收条件和执行顺序。
- `src/components/shared/WelcomePage.tsx`、`src/pages/SkillHubManager.tsx`：Gateway Skills 预览与本地 Skill 链接边界。
- `docs/quality/openclaw-agent-identity-projection-2026-08-04.md`：OpenClaw 身份投影及头像视觉边界。
- `docs/junqi-session-features.md`、`docs/openclaw-features.md`：合并的历史会话能力分析与待核验边界。
- `docs/quality/openclaw-features-junqi-alignment-2026-08-07.md`：功能清单与当前代码的对照矩阵、风险分级和实施顺序。
- `docs/quality/openclaw-full-alignment-audit-2026-08-07.md`、
  `specs/quality/2026-08-07-openclaw-full-alignment.md`、
  `plans/quality/2026-08-07-openclaw-full-alignment.md`、
  `docs/previews/junqi-first-run-flow.html`：本轮依据、目标与可视流程记录。

## 测试与验证

- 本轮钉钉 UI 收敛已通过 11 项聚焦测试、完整 `pnpm test`（前端 2825 项及脚本测试）、`pnpm lint`、`pnpm dingtalk:test`（12 项）、`pnpm dingtalk:validate`、`pnpm build`、`pnpm verify:openclaw-docs` 和预览标签栈/脚本/语言资源解析。完整测试仅输出既有第三方 Radix 服务端渲染警告。
- 当前未执行真实 Tauri 窗口中的亮暗主题、键盘焦点、窄窗口和像素级视觉验收；本轮页面结构已由生产构建验证，真实视觉边界记录于 `docs/business/dingtalk-workspace-ui-validation-2026-08-09.md`。
- 设计预览已通过 HTML 标签栈、内联脚本语法、拖拽与收起控件标识、隐藏平台文案、相对链接和 Emoji 静态检查。
- 本轮业务规划已从 DWS 官方源码成功运行 `go run ./cmd schema oa --compact -f json`，并运行 attendance、calendar、contact、todo schema 与 auth/profile help；尚未使用正式 DWS 发布包或真实钉钉租户执行业务操作。
- 本轮新增文档的本地相对链接、完整修改文件 Emoji 扫描和 `git diff --check` 已通过；源码、Tauri、插件、构建脚本和锁文件均包含本轮实现改动。
- `pnpm verify:openclaw-docs` 已在锁定依赖安装后通过，确认官方 `commands.list` 文档链接有效。
- 当前未执行真实 Tauri 窗口中的亮暗主题、键盘焦点、窄窗口和像素级视觉验收；页面结构已由生产构建验证。
- 已通过：
  `node --import ./test-setup.ts --import tsx --test src/services/setup/setupCompletionGate.test.ts src/services/gateway/OpenClawSetupVerificationClient.test.ts src/hooks/setupOnboardingRegression.test.ts`，共 58 个测试。
- 已通过：`pnpm lint`、完整 `pnpm test` 和 `git diff --check`。全量测试包含既有第三方 SSR `useLayoutEffect`
  警告，但命令成功结束。测试中发现 `WizardScreen` 已移除硬编码色值而主题守护仍期望 2 个；守护已按
  当前语义令牌实现校正为 0。
- 已执行本机 Gateway CLI 复现：服务状态可用；`openclaw.setup.verify` 和 `models.probe` 均返回未知方法。
- 已通过：`pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check`。全量测试包含既有第三方 SSR
  `useLayoutEffect` 警告，但命令成功结束。
- 本轮主会话标签关闭回归已通过：`node --import ./test-setup.ts --import tsx --test src/stores/chatStore.test.ts`，共 53 个测试。
- 本轮最新 `pnpm lint`、完整 `pnpm test`（前端 2823 项、脚本 243 项）、`pnpm build` 和 `pnpm verify:openclaw-docs` 均通过；完整测试仍有既有第三方
  SSR `useLayoutEffect` 警告，但命令成功结束。
- 会话变更与会话文件移除、分支/会话上下文/会话产物直接入口已通过 59 项 Gateway 聚焦回归、`pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check`。完整测试只有既有第三方 Radix 服务端渲染警告；生产构建不再包含两个专属组件、Gateway 客户端模块或统一“更多”菜单状态。
- 本轮窗口卡顿路径修复已通过动态岛调度器合并、最新快照、取消和销毁回归；`pnpm exec tsc --noEmit`、`pnpm lint` 和 `git diff --check` 均通过。
- Ready 运行偏好并行加载与完整骨架回归已通过：`setupOnboardingRegression.test.ts`、`AutostartPreferenceRow.test.tsx`、`pnpm exec tsc --noEmit`；桌面真机首次进入的视觉帧仍未录制。
- Setup 当前页入场、环境动作门禁和下一步—上一步—下一步往返定向回归共 29 项通过；`pnpm lint`、`pnpm build` 和完整 `pnpm test` 均通过。完整测试前端 2825 项、脚本 243 项，首次运行发现的一条旧源码表达式断言已删除并由行为测试替代。
- 已基于当前全部修改重新构建并校验 macOS arm64 DMG 验收包：`src-tauri/target/release/bundle/dmg/JunQi Desktop_2.2.10_aarch64.dmg`。`hdiutil verify` 通过，文件大小为 8732068 字节，SHA-256 为 `8a3de1db0808e611de2b4c9ec367f150987116d11f02a9fbc967168636ef57ab`。Tauri 已生成 `.app`、DMG 和 updater 归档，但因当前环境只有 updater 公钥、没有发布私钥而以非零状态结束；应用仅为 ad-hoc 签名，未正式签名或公证，本轮尚未重新执行安装后的真机走查。
- 已确认远端 `v2.2.10` 已被历史发布占用；本轮按发布工作流约束将四处桌面版本统一提升到 `2.2.11`，不改写已有标签。
- 本轮助手头像视觉调整已包含在当前安装的 `.app` 中；亮暗主题与窄窗口的最终视觉验收仍待完成。
- 已完成会话助手头像视觉调整；本轮聊天相关测试、`pnpm lint`、完整 `pnpm test` 和 `pnpm build` 均通过，亮暗主题与窄窗口的最终视觉验收仍待完成。
- 本轮已通过聚焦回归：Gateway 能力证据、Gateway Skills 欢迎页、本地 Skill Hub 边界、Cron contract/parser、Cron runs、Cron store
  和 Gateway 连接安全测试；`pnpm exec tsc --noEmit` 与 `git diff --check` 通过。
- 本轮安装流程总览仅新增文档和索引入口，未改变运行时代码；已完成链接、路径和 Emoji 扫描。
- 本轮 Setup 居中约束与可感知动效修正已通过动效定向测试、SetupShell 渲染测试、`pnpm lint`、完整 `pnpm test`、`pnpm build`、边界检查和 `git diff --check`，并已重新打包 macOS arm64 DMG。真实桌面视觉验收仍待完成。
- 本轮顶部阶段语义修正已通过引导呈现状态机、SetupShell 渲染、`pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check`，并已重新打包 macOS arm64 DMG。真实桌面视觉验收仍待完成。
- 本轮 Gateway 第三阶段检查点已通过检查点模式、默认折叠详情、顶部完成态、三语言契约、54 项相关回归、`pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check`，并已重新打包 macOS arm64 DMG。真实窗口高度、详情展开和滚动条验收仍待完成。
- 本轮 Setup 闪动与横向溢出修复已通过 13 项相关回归、`pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check`。完整测试仍只有既有第三方 Radix 服务端渲染警告；真实桌面切换观感和目标平台滚动条表现需使用本轮安装包继续验收。
- 已审查并合并 `Blues-Code/code` 分支的 `7f0d208c`；合并提交为 `fa094888`。该分支只新增两份会话能力分析文档，未引入
  源码、配置、OpenClaw RPC 或运行时行为；文档已标明基于旧快照的证据边界，不作为当前功能契约。

## 已知问题

- 钉钉单平台工作台和 OpenClaw 钉钉插件已进入生产代码；正式 DWS 发布包验证、真实租户读取、真实 Gateway 审批往返和跨平台真机验收仍未实现。
- 当前开发机没有已安装的发布版 `dws`；源码 schema 只能证明主线契约，不能替代发布包、真实认证、profile、租户权限和跨平台验收。
- Figma 订阅的 macOS 组件库不允许当前账号导入，本轮不把空白 Figma 文件作为交付物；独立 HTML 预览是当前可审阅设计稿。
- 当前本机 Gateway 尚不支持官方实时验证方法。JunQi 进入工作台时会如实记录模型待核验；不把它显示为凭据失败。
- 当前稳定 `latest` 仍不提供该方法，因此不得提示用户通过升级当前稳定版解决；支持该 RPC 的未来官方 Gateway
  需要再补充真实验证。
- 合并的 `docs/junqi-session-features.md` 和 `docs/openclaw-features.md` 是历史分析与待核验线索；其中数量、能力和入口
  清单不得替代最新版 OpenClaw 官方文档、源码或当前 JunQi 实现。
- 120 秒 handoff 等待来自本机一次可复现观察；macOS、Windows、Ubuntu、CentOS 和 Docker 运行时仍需真机验证。
- 本机构建与本轮验证未进行正式代码签名或公证，不能作为正式发布制品；当前运行的是本轮 macOS arm64 验收包。
- 本轮头像与文档改动已提交；桌面安装包中的工具栏密度、图标语义、键盘焦点和窄窗口表现尚未完成真机验收。
- 本轮新增的能力证据、Gateway Skills 欢迎页和 Cron 契约已进入当前安装的未签名 `.app`；尚未完成亮暗主题、窄窗口和真机交互验收。
- 会话变更与会话文件移除后的工具栏密度、Tooltip 悬浮与键盘焦点、亮暗主题和窄窗口弹层仍未完成桌面真机验收。
- 本机 OpenClaw `2026.7.1-2` 尚未提供 `sessions.companion.*` 方法；JunQi 已移除对应入口，不再触发无效旁问请求。未来恢复必须基于真实 Gateway RPC 验证。
- 动态岛节流降低了聊天流期间的跨窗口 IPC 频率，但尚未完成真实 Tauri 窗口的聊天流、终端高输出或拖拽调整大小帧时间录制；若卡顿仍存在，需要分别测量终端渲染器和分割器事件链路。
- Ready 页运行偏好状态读取已改为统一骨架门禁；若 Tauri IPC 长时间不返回，页面会如实保持加载态，当前未增加固定超时或本地默认值。
- Setup 步骤切换动效尚未完成真实 Tauri 帧时间与低性能设备验收；当前已验证方向计算、场景级入场状态、稳定步骤条与底部操作栏、减少动态效果、完整测试和生产构建；本轮居中与可感知动效修正需要重新验证，不把动画完成当作业务状态完成。
- Cron 创建编辑器仍只开放已验证的 agentTurn 写操作；command、script、heartbeat、delivery 和 failureAlert 已可严格读取，
  尚未在 UI 中增加未经确认的编辑入口。
- 插件通用目录、Nodes/Canvas 和聚合安全姿态仍未实现；相关能力继续保持未接入，不用本地 WebView 或独立 runtime 伪造。

## 已放弃方案

- 不再将 `openclaw.setup.verify` 的不可用异常吞掉并转换为 `false`。该做法会把能力缺失错误呈现为模型或凭据错误。
- 不使用 `models.probe` 作为 `openclaw.setup.verify` 的 fallback。两者在官方协议中的用途不同，且当前运行时同样不支持。
- 不把所有 Gateway 连接等待统一拉长。这样会把普通连接故障隐藏为长时间无反馈。
- 不在验证失败后自动新建或重跑 Wizard 会话。已完成的官方配置不能由客户端推断为需要重放。

## 下一步顺序

1. 执行钉钉业务计划阶段 0：安装并校验正式 DWS 发布包，采集脱敏 auth、profile、product 与 leaf schema 样本。
2. 在真实测试 Gateway 注册并加载已打包的 `junqi-dingtalk`，验证 `tools.effective`、`tools.invoke`、插件审批和最小只读往返。
3. 阶段 0 门禁通过后，在真实测试租户逐项验收通讯录、OA、考勤、日历和待办只读工具。
4. 只读链路通过后，再按阶段 4、阶段 5 开放写入和高风险业务动作；未知结果不得重放。
5. 在亮暗主题、键盘焦点、窄窗口、减少动态效果和快速连续点击条件下专项复测首次启动往返导航；本机 macOS 正常使用链路已经验收，不再重复列为待打包事项。
6. 安装当前 macOS arm64 验收包，走查会话工具栏、Gateway Skills 预览、本地 Skill Hub 边界和 Cron 待核验状态的亮暗主题、键盘焦点与窄窗口表现。
7. 在支持 `openclaw.setup.verify` 的官方 Gateway 上验证 `verified`、`failed` 和 `unavailable` 三种结果的 UI 路径。
8. 以官方 `plugins.list`、`node.list/describe/invoke` 和 Canvas plugin surface 为依据，分别规划只读插件、Nodes/Canvas 与安全姿态卡。
9. 在 macOS、Windows、Ubuntu、CentOS 以及 Native/Docker 的真实环境记录交接时间与行为差异；未经实测不得扩展为跨平台承诺。
10. 后续行为变更结束、暂停或交接前，按 `AGENTS.md` 更新本文件并重新执行与改动范围相符的验证。
