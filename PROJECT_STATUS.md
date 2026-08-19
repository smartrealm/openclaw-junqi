# 项目交接状态

更新时间：2026-08-19

## 当前目标

完成 DWS 授权与 Profile 账户管理、钉钉反馈布局、用量页恢复、冷启动官方 Gateway 服务归属、OpenClaw 命令目录双向滚动联动、会话计划紧凑交互与 Windows 本地语音唤醒，并交付新的 Apple Silicon 本地安装包。

## 已完成内容

- 配置办公室已按协作能力快照中的不同字段拆分为“协调席位”“已获协作许可”“已配置，未纳入协作许可”三个静态空间分区。`allowed=false` 的 Agent 不再出现在“协作席位”，也不被标成当前运行未参与。
- 实际协作办公室继续只根据权威协作运行快照安排五个运行区域；静态配置工位不声称在线、运行或执行成功。
- 运行时命令左侧导航通过官方 `commands.list` 为当前会话 Agent 读取目录，显示真实类别、命令数量和不可用状态；点击类别只定位页面对应分区，不执行命令。
- DWS 安装与工作区恢复的既有修复仍保留：无 stdout 时报告真实等待状态，终态事件按操作标识消费，Gateway 重启后相同会话快照也刷新当前连接读取时间。
- DWS 标准错误流不再直接显示为业务错误。页面按操作标识同时缓存原始事件和中性展示行，授权成功或失败仍只服从进程终态与 DWS 结构化核验。
- DWS 授权对话框已增加视口宽高、网格最小宽度、内部滚动和任意位置断行约束，长 OAuth 地址与结构化诊断不能再扩张对话框内容宽度。
- DWS 结构化 `auth` 错误会区分“旧槽位不可读但应优先迁移”和“DEK 已缺失，需要显式重置”。只有后者提供重置按钮，并在二次确认后调用官方 `dws auth reset --format json --yes`。
- DWS 重置完成只报告官方重置命令结束，明确要求用户重新发起扫码授权；不会把重置伪装成已登录或已授权。
- DWS 浏览器回调成功与本机 token 持久化已拆成不同阶段；授权最终完成必须由 `auth status --format json` 同时返回 `success: true` 和 `authenticated: true`。
- DWS 安装核验已与账户操作终态拆分：官方 `version --format json` 只按非空 `version` 核验，不再错误要求该响应不存在的 `success` 字段。
- 顶栏 DWS 紧凑身份已移除姓名前的重复用户图标，并避免姓名与次级组织信息重复；必要时显示精确 Profile 作为可核验身份。
- 钉钉插件错误和授权结果已从顶栏迁入接入诊断面板，避免长提示挤压身份与刷新操作。
- 全量用量页不再把 JSX 源码字符串渲染为 Agent 图标；稳定图标类型在组件层映射为真实图标。
- 仪表盘每日趋势支持费用与 Token 切换。部分调用未定价且存在多日 Token 时默认显示 Token；已知费用仍可单独查看，未知价格不补零。
- “钉钉接入与授权”的身份区已增加已登录 Profile 选择、官方切换和单账号退出入口。切换与退出均携带精确 `corpId:userId`，完成后以新的官方 Profile 列表核验，不以按钮结束推断成功。
- 工具详情的所谓“租户身份”已改为 DWS Profile 下拉选择，执行身份随当前 Profile 收敛，不再要求用户手填技术标识。
- DWS 未返回安全头像地址时使用通用用户占位图标，不再用姓名首字母伪装成钉钉头像。
- 钉钉官方审计查询已绑定当前 Session，并区分未连接、未选择 Session、方法不支持、缺少 `operator.read`、响应不兼容和普通请求失败；无记录说明真实产生条件。
- Assistant 工具执行过程与回答正文复用同一响应列最大宽度。
- 渠道绑定清理不再吞掉 `gatewayLifecycle.restart` 的异常或 `success: false`。配置已写入但运行时未重新加载时返回带清理数量的明确部分失败，不自动重放副作用。
- Agent 删除界面保留删除已发生的真实状态，并分别警告渠道清理未完成或绑定变更尚未由 Gateway 确认重新加载；只有真实重启成功才展示清理成功。
- Gateway 错误页等待统一重连的结构化终态，成功后才清除错误与日志；失败继续保留错误页。持续就绪轮询只触发一次恢复，避免每两秒自动重放认证重连。
- 维护中心不再从可选 `healthy` 字段推断恢复结果，回调已收紧为 `GatewayLifecycleResult`，只有 `success: true`
  才结束失败语义；结构化错误继续显示在操作附近。
- `GatewaySelfRescuePanel.onReconnect` 没有任何生产消费者，已连同专属分支和布局条件删除。现有主操作继续由
  调用方接入统一生命周期协调器。
- 冷启动进程观察不再把与当前 state、config 和运行时匹配的 OpenClaw 官方服务误分类为 `External`。健康 Native
  端点会先通过官方结构化服务状态恢复 `SystemService` 归属；缺失、停止、Foreign 或 Unverifiable 仍失败关闭。
- OpenClaw 命令目录已增加双向 Scroll Spy：右侧滚动按粘性页头锚点更新左侧活动分组，左侧点击按实时页头高度定位右侧，
  侧栏选中项保持可见；程序滚动期间不会用经过的中间分组覆盖用户目标。
- 运行中的 OpenClaw 计划已改为 Composer 上方的居中步骤胶囊；点击后在上方展开完整步骤，长计划在面板内部滚动，
  收起后只保留当前步骤和总数。完成或中断计划仍作为真实执行记录保留在 transcript 中。
- Windows 本地语音唤醒已接入 SAPI 共享识别器：只在 JunQi 运行且用户明确启用时监听 Gateway 当前唤醒词，命中后先释放监听，再按 Gateway 路由选择当前已投影会话并启动现有 Talk。
- 原生唤醒以 `ownerId` 隔离旧线程事件，错误、断线、Talk 或录音占用时失败关闭；事件只返回命中的已配置唤醒词，不携带自由文本、音频或伪造 transcript。
- Agent 路由读取同一可信连接上的 `agents.list`，使用官方 `mainKey` 与 Agent 清单按上游显式 Agent 主会话规则解析；`sessionKey` 和 Agent 目标都必须已存在于当前会话投影。

## 核心文件

- `src/pages/AgentHub/AgentHubConfiguredOffice.tsx`
- `src/pages/AgentHub/agentHubConfiguredOffice.test.ts`
- `src/pages/OpenClawCommands/commandGroups.ts`
- `src/pages/OpenClawCommands/index.tsx`
- `src/components/Layout/NavSidebarPanels.tsx`
- `src/components/Chat/ExecutionPlanCard.tsx`
- `src/components/Chat/ExecutionPlanCard.test.tsx`
- `src/pages/ChatView.tsx`
- `src/services/channelConfig.ts`
- `src/services/gateway/gatewayErrorRecovery.ts`
- `src/hooks/useGatewayProcessRecovery.ts`
- `src/App.tsx`
- `src/pages/GatewayErrorScreen.tsx`
- `src/components/settings/MaintenanceCenter.tsx`
- `src/components/settings/maintenanceGatewayRecovery.ts`
- `src/components/GatewaySelfRescuePanel.tsx`
- `src/business-applications/dwsAuthorizationFailure.ts`
- `src/business-applications/dwsProfileSelection.ts`
- `src/business-applications/dingtalkAuditAvailability.ts`
- `src/business-applications/dwsOperationEventCache.ts`
- `src/components/BusinessApplications/DingTalkReadinessPanel.tsx`
- `src/components/BusinessApplications/DingTalkRuntimeIdentity.tsx`
- `src/components/BusinessApplications/DingTalkToolDetail.tsx`
- `src/components/BusinessApplications/BusinessActivityList.tsx`
- `src/hooks/useDingTalkBusinessAudit.ts`
- `src/components/Chat/chatResponseLayout.ts`
- `src/pages/BusinessApplicationsPage.tsx`
- `src/pages/Dashboard/dashboardData.ts`
- `src/pages/Dashboard/index.tsx`
- `src/pages/FullAnalytics/agentIconKind.ts`
- `src/pages/FullAnalytics/components/AgentBreakdownSection.tsx`
- `src/pages/OpenClawCommands/commandScrollSpy.ts`
- `src/pages/OpenClawCommands/index.tsx`
- `src/components/Layout/NavSidebarPanels.tsx`
- `src-tauri/src/commands/dws_operation.rs`
- `src-tauri/src/commands/gateway.rs`
- `docs/quality/agent-office-star-office-alignment-2026-08-18.md`
- `docs/quality/openclaw-runtime-command-navigation-2026-08-19.md`
- `docs/quality/dws-install-and-workspace-recovery-2026-08-19.md`
- `specs/2026-08-19-dws-auth-recovery-bugfix.md`
- `plans/2026-08-19-dws-auth-recovery-bugfix.md`
- `docs/gateway/gateway-lifecycle-unification-validation-2026-08-10.md`
- `src/runtime/JarvisVoiceRuntime.tsx`
- `src/hooks/useVoiceCapture.ts`
- `src/hooks/useJarvisVoiceSettings.ts`
- `src/services/gateway/VoiceWakeGatewayClient.ts`
- `src/services/gateway/OpenClawSessionProjection.ts`
- `src/services/voice/NativeVoiceWakePolicy.ts`
- `src/services/voice/NativeVoiceWakeRouting.ts`
- `src/hooks/useNativeVoiceWake.ts`
- `src/components/settings/JarvisVoiceSettingsPanel.tsx`
- `src-tauri/src/commands/voice_wake.rs`
- `src-tauri/src/commands/voice_capture.rs`
- `docs/quality/windows-native-voice-wake-2026-08-19.md`
- `specs/2026-08-19-windows-native-voice-wake.md`
- `plans/2026-08-19-windows-native-voice-wake.md`

## 关键技术决策

- `configuredAgents` 是协作插件按 OpenClaw 配置派生的能力快照；`allowed` 只表示插件许可，不能替代“已配置”或权威运行成员事实。
- `commands.list` 是 OpenClaw Gateway 的权威命令目录。JunQi 只组织其 `category`，不补造命令、类别或可执行状态。
- 钉钉 DWS 扫码操作仅能在已验证且允许桌面修改的本机 Native 或 Docker Gateway 上启动；远程或未验证运行时必须保留指引入口，不能绕过运行时身份门禁。
- 进程端点就绪、认证 WebSocket 连接和 Runtime Identity 核验是不同事实。错误页退出只服从统一生命周期的成功终态。
- Agent 删除和渠道配置写入属于已经发生的副作用；后续 Gateway 重启失败只能报告部分完成并等待人工恢复，不能自动重放。
- 统一生命周期成功判据是 `GatewayLifecycleResult.success`；调用方不得再从 `healthy`、端口状态或可选字段推断成功。
- StatusBar 的本地 `reconnecting` 仅是共享进度事件到达前的即时点击锁；CommandPalette 的恢复项没有独立快捷键，
  两者都通过统一协调器和共享进度展示收敛，因此不作为第二生命周期实现删除。
- `recover`、`restart` 和 `reconnect` 保留各自场景语义；入口名称不同不是缺陷，不能在没有运行时证据时批量替换。
- DWS 的 stdout 和 stderr 只表示来源流，不是业务结果；CLI 可以把交互进度写入 stderr。恢复判断必须使用按 `operationId` 保留的原始结构化事件，不能解析本地化展示字符串。
- `dws auth reset` 是 DWS 官方破坏性恢复命令，会清除本机全部 DWS 登录配置。JunQi 不自动执行、不从模糊文本推断适用，也不把它替代为本地凭据修改。
- DWS 官方 Profile 列表是账号、当前身份和执行身份的唯一来源。普通切换使用 `profile switch`，单账号退出使用 `auth logout --profile`；全量 `auth reset` 不得作为普通退出入口。
- DWS 浏览器成功页只证明 OAuth 回调阶段完成。JunQi 的成功终态必须继续等待本机凭据持久化和结构化登录状态核验。
- DWS 各结构化命令按各自官方响应判定：版本探测验证 `version`，授权验证 `success` 与 `authenticated`，Profile 变更验证 `success` 与新的列表终态。
- OpenClaw `audit.activity.list` 是业务审计的权威来源；本窗口投影不能替代官方记录，官方无记录也不能反推工具未执行。
- OpenClaw 的 Token 记录与估算费用是不同事实。部分或全部模型价格缺失时优先展示已记录 Token，费用只显示官方聚合中的已知估价。
- 本机地址、端口健康和认证连接都不能单独证明 Gateway 归属；但官方服务状态已同时证明所选 state、config、工作目录、
  Node 与 OpenClaw 运行时匹配时，JunQi 必须在 Runtime Identity 计算前恢复 `SystemService`，不能继续沿用冷启动误分类。
- 命令目录活动分组是 `commands.list` 分组的本地导航投影。它只可由当前滚动位置或显式类别导航派生，不能新增命令状态、
  执行语义或第二滚动容器；程序定位必须暂停观察，稳定后再按真实位置收敛。
- 会话计划的紧凑胶囊、展开状态和内部滚动仅是本地展示偏好；步骤、当前索引、总数、修订和运行终态继续服从
  OpenClaw `update_plan` 快照及所属响应组，不得由展开、收起或本地计时推进。
- OpenClaw Gateway 保存唤醒词和路由不等于桌面客户端正在监听麦克风。JunQi 仅在 Windows 用户明确启用、本地 SAPI 可用、Gateway 配置已核验且麦克风未被 Talk 或录音占用时监听；macOS 与 Linux 继续明确为不支持。
- Windows 唤醒只负责启动现有 Talk，不把触发短语写入 transcript，也不保留触发后同一段语音；后续语音从 Talk 成功启动后的新采集开始。
- 最新 OpenClaw 官方文档、主线源码和本机 2026.7.1-2 均已提供 `voicewake.routing.set`；仓库 2026-08-10 历史审计关于该方法已移除的结论已过时，后续修改路由界面前必须重新形成当前契约记录。

## 验证

- 定向前端测试通过：配置工位分区、运行时命令分组与本地化断言共 12 项。
- 生命周期结果消费定向回归 82 项通过，覆盖渠道清理失败传播、错误页恢复时序、异常收敛和持续就绪单次通知。
- 维护中心结果判定与自救面板接口定向回归 12 项通过。
- `pnpm lint` 通过，模块边界扫描 917 个生产文件，四处版本一致，TypeScript 类型检查通过。
- 完整 `pnpm test` 通过，前端与源码测试 2846 项、脚本测试 238 项均无失败；`pnpm build` 通过。
- 本轮 DWS 授权恢复新增 5 项前端定向回归与 1 项 Rust 定向回归均通过。更新后的完整 `pnpm test` 通过，前端与源码测试 2850 项、脚本测试 238 项均无失败。
- `pnpm lint` 通过，模块边界扫描 918 个生产文件；`cargo check --lib` 与 `cargo test --lib` 通过，Rust 643 项通过、1 项既有 Keychain 写入测试按设计忽略；`pnpm build` 通过。
- 当前变更重新执行 `pnpm lint`、完整 `pnpm test` 和 `pnpm build` 均通过；模块边界扫描 923 个文件，四处版本一致。
- `cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib` 通过；Rust 645 项通过、1 项会修改当前用户 Keychain 的既有测试按设计忽略。
- DWS 授权、Profile、头像、审计查询与聊天响应列宽定向回归共 18 项通过；Rust DWS 定向 7 项通过。
- Gateway 官方服务归属两项定向 Rust 回归通过；`cargo fmt -- --check`、`cargo check --lib`、完整
  `cargo test --lib`、完整 `pnpm test`、`pnpm lint` 和 `git diff --check` 均通过。
- 命令目录分组与 Scroll Spy 定向回归 4 项通过；`pnpm lint` 通过，模块边界扫描 924 个文件，四处版本一致，
  TypeScript 类型检查通过；完整 `pnpm test` 和 `pnpm build` 通过，脚本测试 238 项无失败，生产构建转换
  9303 个模块。
- 会话计划卡、运行中计划位置和命令滚动联动定向回归 19 项通过；更新后的 `pnpm lint`、完整
  `pnpm test`、`pnpm build` 与 `git diff --check` 均通过，模块边界扫描 924 个文件，生产构建转换
  9303 个模块。
- 提交前对当前完整变更重新执行 `pnpm lint`、`pnpm test` 与 `pnpm build` 均通过，模块边界扫描 928 个文件；
  `cargo fmt -- --check`、`cargo check --lib` 与 `cargo test --lib` 通过，Rust 652 项通过、1 项既有测试按设计忽略。
- 当前代码执行 `pnpm exec tauri build --target aarch64-apple-darwin --bundles app,dmg --no-sign --ci` 成功。应用版本与构建版本均为 3.1.2，二进制为 Mach-O arm64；`hdiutil verify` 通过，最新 DMG SHA-256 为 `cf29dae56089bf24c253e3c96e3a320b92f3407e5665ab0fab7f59bc856cbc51`。
- 语音相关前端定向测试 42 项通过；Rust 原生连续采集 12 项与 Talk 播放 5 项通过。本机 OpenClaw Gateway 2026.7.1-2 运行正常，三个只读语音 RPC 实测成功，macOS 版本为 26.5.1。
- Windows 本地语音唤醒定向 TypeScript 契约、策略、路由、Gateway 与 IPC 测试通过；`pnpm lint` 通过，模块边界扫描 928 个文件。
- 更新后的完整 `pnpm test` 通过，源码测试 2877 项、脚本测试 238 项均无失败；`pnpm build` 通过，生产构建转换 9307 个模块。
- `cargo fmt -- --check`、`cargo check --lib` 和完整 `cargo test --lib` 通过；Rust 652 项通过、1 项既有测试按设计忽略；`git diff --check` 通过。

## 已知问题与未验证边界

- 尚未用真实多 Agent 协作运行完成亮色、暗色、窄窗口和键盘焦点的人工视觉验收。
- 尚未在不同 Gateway Provider 的真实 `commands.list` 目录上完成左侧类别跳转的真机验收。
- 当前截图中的 DWS 授权按钮禁用是未验证本机或 Docker 运行时的安全结果；可打开指引，但不能由桌面端执行远程宿主授权。
- Gateway 错误页失败保留和 Agent 删除后的渠道重载部分失败尚未在真实 Native、Docker、Windows 或 Linux 运行时人为制造并验收。
- 维护中心失败反馈尚未在真实 Native、Docker、Windows 或 Linux 运行时人为制造并做键盘、亮暗主题和窄窗口验收。
- 本轮本地 DMG 使用 `--no-sign`，只有链接器生成的 ad-hoc 标记，没有 Developer ID 签名或公证；尚未执行安装后的首次启动和 Gatekeeper 验收。Windows、Linux 安装包没有在当前 macOS 主机生成。
- DWS 授权恢复对话框尚未在亮色、暗色、窄窗口和键盘焦点下完成真实长地址连续视觉验收。
- 未对当前用户的真实 DWS 登录态执行 `auth reset`。代码和测试已确认二次确认、官方参数与终态语义，但 Keychain 恢复结果必须由用户在本机明确确认后实测。
- 未对当前用户的真实第二账号执行 Profile 切换或单账号退出；相关自动化只证明命令、身份围栏和终态核验。
- Profile 账户区、通用头像、审计空状态及统一聊天宽度尚未在亮色、暗色、窄窗口和键盘焦点下完成真机视觉验收。
- 用量页真实图标、费用与 Token 切换及图表提示尚未在亮色、暗色、窄窗口和混合定价真实数据下完成人工视觉验收。
- Gateway 归属修复已通过状态转换自动化和本机官方结构化状态核对，但新包尚未替换当前运行的旧应用；冷启动后的钉钉页
  管理权限与提示需要安装新包后真机确认。
- 命令目录双向联动尚未完成亮色、暗色、窄窗口、键盘焦点、减少动态效果及真实长目录的连续滚动视觉验收。
- 会话计划胶囊和展开面板尚未在真实流式计划中完成亮色、暗色、窄窗口、键盘焦点、长计划内部滚动及减少动态效果验收。
- 当前 macOS 开发机缺少 Windows Rust 标准库目标和目标管理器，因此 Windows 分支尚未完成跨目标编译；Windows x64 真机上的 SAPI、麦克风、语言包、权限、启停和 Talk 接力仍未验证。
- Windows 语音唤醒设置尚未完成亮色、暗色、窄窗口、键盘焦点、加载、失败和连续状态变化的真机视觉验收。应用退出后不监听；macOS 与 Linux 不提供该 Windows 开关。

## 下一步顺序

1. 完整退出当前旧版 JunQi，安装最新本地包并冷启动，确认所选 OpenClaw 官方服务被识别为 `SystemService`，钉钉页不再显示外部或远程 Gateway 阻止提示。
2. 在真实长命令目录中连续滚动和点击全部分组，核验左侧高亮、自动可见、顶部复位与短尾分组收敛。
3. 在真实 `update_plan` 会话中核验步骤胶囊、展开收起、实时步骤变化、长计划内部滚动和终态回归 transcript。
4. 核验用量页 Agent 图标、仪表盘费用与 Token 切换以及钉钉提示布局。
5. 在“钉钉接入与授权”中核验 Profile 切换、单账号退出和执行身份同步。
6. 在当前 DWS 故障状态下确认网页授权成功与本机凭据保存失败被分阶段呈现；如确认无需保留全部登录态，再执行重置并重新扫码。
7. 在亮色、暗色和窄窗口中核验账户区、图表、恢复卡片、审计空状态、聊天宽度和键盘焦点。
8. 在 Windows、Linux 或 Docker 隔离环境复现 DWS 凭据错误和多 Profile 操作，确认未知错误保持失败关闭。
9. 在 Windows x64 目标机编译并安装当前分支，依次核验 SAPI、麦克风权限、语言包缺失、启停、Gateway 路由、Talk 接力、亮暗主题、窄窗口和键盘焦点。
