# 项目交接状态

更新时间：2026-08-08

## 当前目标

收敛 OpenClaw 首次配置完成后的 Gateway 服务交接与模型实时验证状态，并持续按官方契约对照功能入口和会话上下文工具栏。JunQi 必须保留 OpenClaw 的真实
完成语义：Gateway 已恢复连接不等于默认模型已验证；当前 Gateway 不支持官方验证方法也不等于模型或凭据失效，
且不能因此阻断已经完成的官方配置。

## 已完成内容

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
- 保留当前会话实际工具、浏览器控制、分支、检查点、制品、差异和会话文件，并将差异图标改为 `FileDiff`，
  与分支图标区分；当前 Gateway 未提供的会话旁问入口已移除。保留项均已有对应组件和 OpenClaw/工作台业务消费者。
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
- 已完成会话工具栏加固：顶部图标统一复用 `ChatIconButton` 的可见 Tooltip、`aria-label` 和 `title` 兜底；低频的分支、检查点、产物、会话变更和会话文件入口收进会话工具浮层，有效工具和浏览器保持直接入口。
- 已补充安装与首次启动端到端总览 `docs/installation/junqi-installation-flow.md`，将运行时选择、数据位置、Gateway 交接、官方 Wizard、
  三重完成门禁、Ready/Dashboard 进入、恢复语义和跨平台未验证边界统一串联，并从 `docs/README.md` 提供唯一总览入口。
- 已优化 Setup 上一步/下一步过渡：稳定步骤条和底部操作栏不再随页面横移，标题与内容通过 `SetupStepScene` 单独过渡；用户决策态使用 16px 方向入场，检测、安装、Gateway 和失败运行态使用轻微淡入，旧页面立即卸载约束保持不变。
- 已增强会话变更和会话文件的真实状态呈现：`sessions.diff` 保留 Gateway 的授权失败及缺失 scope，不自动提权；会话文件预览按缺失、类型不支持、内容不可用和未知原因区分，并展示 Gateway 返回的安全元数据。
- 已移除当前 Gateway 未提供的会话旁问入口、专属 RPC 客户端、Hook、测试、国际化文案和本地 `/btw`/`/side` 拦截；普通问题恢复为主会话发送。官方能力与未来恢复边界记录在
  `docs/quality/openclaw-session-companion-removal-2026-08-07.md`。
- 已排查窗口偶发卡顿的高频路径：聊天流刷新会驱动动态岛快照并向独立窗口发送跨窗口事件；新增 100ms 尾部调度器合并最新快照，隐藏和销毁时取消过期回调，不改变 OpenClaw 权威状态。
- 已修正会话变更的权限调用链：`sessions.diff` 现在优先使用已有的一次性 `operator.admin` Gateway 连接，并保留连接围栏；Gateway 不授予权限时仍显示真实拒绝。
- 已修正 Ready 页运行偏好的首屏跳动：Gateway 与 JunQi Desktop 自启动状态并行读取，两个结果落定前保持同尺寸完整骨架，避免单行先出现或不支持项加载后重排。
- 已重做 Setup 步骤切换动效：步骤状态提交后立即卸载旧页面，只让当前页面执行 200 毫秒的小幅方向入场；下一步从右侧进入、上一步从左侧进入，系统开启减少动态效果时立即呈现。
- 已删除退出页面的存在态、指针层级和并存生命周期，避免数据位置页的本地单飞引用与异步 effect 在返回后继续影响当前页面。
- 已统一环境检测页的操作门禁和按钮状态：`idle`、`navigating`、`redetecting` 三态同时驱动原子单飞保护和可渲染忙碌状态，上一步、重新检测和下一步不会再呈现可用却被处理器静默拒绝。
- Git 追溯确认环境操作锁由 `a14eeecf` 引入，`62b00964` 仅完成 hook 拆分并保留旧释放时机；未提交的退出页保留动效改变了 Setup 原有的立即卸载契约。本轮按两项根因一起修复，不再叠加单点引用补丁。

## 关键技术决策

- `openclaw.setup.verify` 可用时是模型实时验证的唯一证据。不得以 Gateway 健康、静态模型引用、`models.probe`
  或本地推断替代成功条件。
- “官方方法不可用”与“官方方法已执行但模型验证失败”必须分开建模和呈现。前者是待核验状态，不能伪报模型成功，
  也不能把当前稳定版不存在的能力当作安装阻断；后者才提示修正模型或凭据并阻断进入。
- Gateway 交接等待只扩展在官方服务 handoff 路径，使用有限上限；不得把普通 RPC 等待改成全局长等待或无限重试。
- 已完成的官方 Wizard 不得因为验证或交接失败被自动重放。JunQi 只能保留待核验状态并等待用户修正官方运行时。

## 核心文件

- `src/services/setup/setupCompletionGate.ts`：完成门禁的结构化验证结果和失败原因。
- `src/hooks/useSetupFlow/index.ts`：将官方验证客户端结果映射到完成门禁，并在 Gateway 就绪页和工作台入口保留
  不可用与失败的不同语义。
- `src/hooks/useSetupFlow/useWizardSession.ts`：官方服务交接后的有界认证重连，以及 Wizard 终态验证分支。
- `src/services/gateway/OpenClawSetupVerificationClient.ts`：官方 `openclaw.setup.verify` RPC 的严格响应解析与
  不可用错误类型。
- `src/services/setup/setupCompletionGate.test.ts` 与 `src/hooks/setupOnboardingRegression.test.ts`：结构化结果与
  handoff 路径回归覆盖。
- `src/components/Chat/SessionContextBar.tsx`、`src/components/Chat/SessionDiffControl.tsx`：会话上下文栏入口收敛与
  差异图标语义修正。
- `src/components/Chat/ChatTabs.tsx`、`src/stores/chatStore.ts`、`src/stores/chatStore.test.ts`：标签关闭与会话删除边界，
  以及规范主会话标签关闭回归。
- `src/components/Chat/MessageBubble.tsx`：会话助手头像的主题表面和前景层次。
- `src/services/gateway/GatewayCapabilityRegistry.ts`、`src/services/gateway/Connection.ts`：Gateway 能力发现与 RPC 结果证据。
- `src/services/gateway/cronRuns.ts`、`src/services/gateway/OpenClawCronRunClient.ts`、`src/stores/gatewayDataStore.ts`：统一 Cron 读取与运行记录契约。
- `src/components/Chat/ChatIconButton.tsx`、`src/components/Chat/SessionFilesControl.tsx`、`src/services/gateway/OpenClawSessionDiffClient.ts`：会话工具栏 Tooltip、文件预览边界和会话变更授权事实。
- `src/dynamic-island/DynamicIslandRuntime.tsx`、`src/dynamic-island/DynamicIslandUpdateScheduler.ts`：动态岛快照跨窗口发布节流及生命周期取消。
- `src/services/gateway/OpenClawSessionDiffClient.ts`、`src/services/gateway/index.ts`：会话变更的特权连接调用和权限事实保留。
- `src/pages/SetupPage/ReadyScreen.tsx`、`src/components/settings/AutostartPreferenceRow.tsx`：运行偏好并行加载、完整骨架和稳定开关行。
- `src/pages/SetupPage/index.tsx`、`src/motion/setupStepTransition.tsx`：首次启动步骤路由的当前页方向入场、旧页立即卸载和减少动态效果适配。
- `src/hooks/useSetupFlow/environmentReviewAction.ts`、`src/hooks/useSetupFlow/useSetupEnvironmentReview.ts`、`src/pages/SetupPage/EnvironmentReviewScreen.tsx`：环境检测页的操作状态机、可渲染忙碌状态和统一按钮门禁。
- `docs/installation/setup-round-trip-navigation-audit-2026-08-08.md`、`docs/installation/setup-round-trip-navigation-validation-2026-08-08.md`、`specs/installation/2026-08-08-setup-round-trip-navigation.md`、`plans/installation/2026-08-08-setup-round-trip-navigation.md`：往返导航根因、验证证据、验收契约和实施顺序。
- `docs/quality/session-toolbar-controls-hardening-2026-08-07.md`、`specs/quality/2026-08-07-session-toolbar-controls-hardening.md`、`plans/quality/2026-08-07-session-toolbar-controls-hardening.md`：本轮入口收敛、协议边界与验证记录。
- `src/components/shared/WelcomePage.tsx`、`src/pages/SkillHubManager.tsx`：Gateway Skills 预览与本地 Skill 链接边界。
- `docs/quality/openclaw-agent-identity-projection-2026-08-04.md`：OpenClaw 身份投影及头像视觉边界。
- `docs/junqi-session-features.md`、`docs/openclaw-features.md`：合并的历史会话能力分析与待核验边界。
- `docs/quality/openclaw-features-junqi-alignment-2026-08-07.md`：功能清单与当前代码的对照矩阵、风险分级和实施顺序。
- `docs/quality/openclaw-full-alignment-audit-2026-08-07.md`、
  `specs/quality/2026-08-07-openclaw-full-alignment.md`、
  `plans/quality/2026-08-07-openclaw-full-alignment.md`、
  `docs/previews/junqi-first-run-flow.html`：本轮依据、目标与可视流程记录。

## 测试与验证

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
- 本轮会话工具栏加固已通过 `ChatIconButton`、会话变更客户端和 Gateway 恢复回归；`pnpm exec tsc --noEmit`、`pnpm lint`、完整测试、生产构建、官方文档链接校验和 `git diff --check` 均通过。
- 本轮窗口卡顿路径修复已通过动态岛调度器合并、最新快照、取消和销毁回归；`pnpm exec tsc --noEmit`、`pnpm lint` 和 `git diff --check` 均通过。
- 会话变更特权连接回归已覆盖优先调用特权 lane；真实 Gateway admin 设备授权仍未完成。
- Ready 运行偏好并行加载与完整骨架回归已通过：`setupOnboardingRegression.test.ts`、`AutostartPreferenceRow.test.tsx`、`pnpm exec tsc --noEmit`；桌面真机首次进入的视觉帧仍未录制。
- Setup 当前页入场、环境动作门禁和下一步—上一步—下一步往返定向回归共 29 项通过；`pnpm lint`、`pnpm build` 和完整 `pnpm test` 均通过。完整测试前端 2825 项、脚本 243 项，首次运行发现的一条旧源码表达式断言已删除并由行为测试替代。
- 已基于当前工作区重新构建并校验 macOS arm64 DMG 验收包：`src-tauri/target/release/bundle/dmg/JunQi Desktop_2.2.10_aarch64.dmg`。`hdiutil verify` 通过，文件大小为 8742951 字节，SHA-256 为 `5596ef0e483f41e47987806f9639298656573b816777fcaf0895e505d5c591fb`。该包未正式签名或公证；本轮尚未重新执行安装后的真机走查。
- 本轮助手头像视觉调整已包含在当前安装的 `.app` 中；亮暗主题与窄窗口的最终视觉验收仍待完成。
- 已完成会话助手头像视觉调整；本轮聊天相关测试、`pnpm lint`、完整 `pnpm test` 和 `pnpm build` 均通过，亮暗主题与窄窗口的最终视觉验收仍待完成。
- 本轮已通过聚焦回归：Gateway 能力证据、Gateway Skills 欢迎页、本地 Skill Hub 边界、Cron contract/parser、Cron runs、Cron store
  和 Gateway 连接安全测试；`pnpm exec tsc --noEmit` 与 `git diff --check` 通过。
- 本轮安装流程总览仅新增文档和索引入口，未改变运行时代码；已完成链接、路径和 Emoji 扫描。
- 本轮 Setup 过渡优化已通过动效定向测试、SetupShell 渲染测试、`pnpm lint`、完整 `pnpm test`、`pnpm build`、边界检查和 `git diff --check`；已重新构建并校验 macOS arm64 DMG。真实桌面视觉验收仍待完成。
- 已审查并合并 `Blues-Code/code` 分支的 `7f0d208c`；合并提交为 `fa094888`。该分支只新增两份会话能力分析文档，未引入
  源码、配置、OpenClaw RPC 或运行时行为；文档已标明基于旧快照的证据边界，不作为当前功能契约。

## 已知问题

- 当前本机 Gateway 尚不支持官方实时验证方法。JunQi 进入工作台时会如实记录模型待核验；不把它显示为凭据失败。
- 当前稳定 `latest` 仍不提供该方法，因此不得提示用户通过升级当前稳定版解决；支持该 RPC 的未来官方 Gateway
  需要再补充真实验证。
- 合并的 `docs/junqi-session-features.md` 和 `docs/openclaw-features.md` 是历史分析与待核验线索；其中数量、能力和入口
  清单不得替代最新版 OpenClaw 官方文档、源码或当前 JunQi 实现。
- 120 秒 handoff 等待来自本机一次可复现观察；macOS、Windows、Ubuntu、CentOS 和 Docker 运行时仍需真机验证。
- 本机构建与本轮验证未进行正式代码签名或公证，不能作为正式发布制品；当前运行的是本轮 macOS arm64 验收包。
- 本轮头像与文档改动已提交；桌面安装包中的工具栏密度、图标语义、键盘焦点和窄窗口表现尚未完成真机验收。
- 本轮新增的能力证据、Gateway Skills 欢迎页和 Cron 契约已进入当前安装的未签名 `.app`；尚未完成亮暗主题、窄窗口和真机交互验收。
- 本轮会话工具栏的真实 Gateway scope 差异、授权连接、Tooltip 悬浮与键盘焦点、亮暗主题和窄窗口弹层仍未完成桌面真机验收；Gateway 拒绝 `sessions.diff` 时会继续明确显示未授权，不会伪造空差异。
- 当前连接的 Gateway 若要求 `operator.admin` 读取 `sessions.diff`，JunQi 只展示 Gateway 的授权拒绝和缺失 scope；不会在本机读取路径生成差异。
- 当前连接的 Gateway 若只返回会话文件的元数据而未提供内容，JunQi 会展示“内容不可用”和文件元数据；不会绕过 Gateway 读取本机文件。
- 本机 OpenClaw `2026.7.1-2` 尚未提供 `sessions.companion.*` 方法；JunQi 已移除对应入口，不再触发无效旁问请求。未来恢复必须基于真实 Gateway RPC 验证。
- 动态岛节流降低了聊天流期间的跨窗口 IPC 频率，但尚未完成真实 Tauri 窗口的聊天流、终端高输出或拖拽调整大小帧时间录制；若卡顿仍存在，需要分别测量终端渲染器和分割器事件链路。
- Ready 页运行偏好状态读取已改为统一骨架门禁；若 Tauri IPC 长时间不返回，页面会如实保持加载态，当前未增加固定超时或本地默认值。
- Setup 步骤切换动效尚未完成真实 Tauri 帧时间与低性能设备验收；当前已验证方向计算、场景级入场状态、稳定步骤条与底部操作栏、减少动态效果、完整测试和生产构建，不把动画完成当作业务状态完成。
- Cron 创建编辑器仍只开放已验证的 agentTurn 写操作；command、script、heartbeat、delivery 和 failureAlert 已可严格读取，
  尚未在 UI 中增加未经确认的编辑入口。
- 插件通用目录、Nodes/Canvas 和聚合安全姿态仍未实现；相关能力继续保持未接入，不用本地 WebView 或独立 runtime 伪造。

## 已放弃方案

- 不再将 `openclaw.setup.verify` 的不可用异常吞掉并转换为 `false`。该做法会把能力缺失错误呈现为模型或凭据错误。
- 不使用 `models.probe` 作为 `openclaw.setup.verify` 的 fallback。两者在官方协议中的用途不同，且当前运行时同样不支持。
- 不把所有 Gateway 连接等待统一拉长。这样会把普通连接故障隐藏为长时间无反馈。
- 不在验证失败后自动新建或重跑 Wizard 会话。已完成的官方配置不能由客户端推断为需要重放。

## 下一步顺序

1. 在亮暗主题、键盘焦点、窄窗口、减少动态效果和快速连续点击条件下专项复测首次启动往返导航；本机 macOS 正常使用链路已经验收，不再重复列为待打包事项。
2. 重新构建当前工作区的 `.app`，走查 Gateway Skills 预览、本地 Skill Hub 边界和 Cron 待核验状态的亮暗主题、键盘焦点与窄窗口表现。
3. 在支持 `openclaw.setup.verify` 的官方 Gateway 上验证 `verified`、`failed` 和 `unavailable` 三种结果的 UI 路径。
4. 以官方 `plugins.list`、`node.list/describe/invoke` 和 Canvas plugin surface 为依据，分别规划只读插件、Nodes/Canvas 与安全姿态卡。
5. 在 macOS、Windows、Ubuntu、CentOS 以及 Native/Docker 的真实环境记录交接时间与行为差异；未经实测不得扩展为跨平台承诺。
6. 后续行为变更结束、暂停或交接前，按 `AGENTS.md` 更新本文件并重新执行与改动范围相符的验证。
