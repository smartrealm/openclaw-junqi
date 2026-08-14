# 项目交接状态

更新时间：2026-08-14

## 当前目标

完成首次设置前置门禁、OpenClaw 核心操作引导和 stable Runtime 新会话首条消息失败修复。

## 已完成内容

- 首页新手引导不再把已有模型、智能体、会话和渠道显示为用户完成比例，也不再展示集中任务网格；首次入口仅说明引导方式。
- 用户开始后固定按新建会话、配置模型供应商、配置渠道和管理智能体前往具体功能页并高亮真实操作控件；已有 Runtime 数据不再导致核心教学步骤被跳过。
- JunQi 的打开项目和终端工作区已从 OpenClaw 核心操作引导及其选择器、状态探针、文案和测试中删除；渠道配置仍交给现有官方流程。
- 新会话首发的 leaf 围栏按当前已核验连接协商：最新版参数成功时继续使用；stable 仅在精确 schema 拒绝证明请求未执行后，沿用同一幂等键省略该字段。其他错误不降参、不重放。
- Guided、Classic 与渠道 Wizard 共用严格终态谓词：只有 `done === true` 且状态为官方终态时才结束会话；携带正式步骤的 `done: false` 不会因 `status: done` 被提前消费。
- 官方终态后重新解析当前所选 Runtime 的端点、共享凭据和设备凭据；解析失败时停止交接，不复用向导前的内存目标、历史手工地址或另一 Runtime 的凭据。
- 新增活动配置应用门禁：同一已核验连接上的 `config.get.configRevisionHash` 与 `appliedConfigHash` 必须非空且相等，才能证明当前 Runtime 已采用磁盘修订。
- 官方重载等待、连接轮换、Guided 探测、真实模型核验和最终修订核验共用一个六分钟绝对截止时间，所有异步步骤都消费同一剩余预算。
- 普通等待超时不再主动重启 Gateway。只有 `gateway.reload.mode: off` 或官方 `health.configReload.hotReloadStatus: disabled` 明确重载关闭时，才通过全局唯一生命周期协调器补发一次重启。
- 生命周期屏障以真实 `manager.restart()` 调用点维护单调重启代次。若同一交接事务已经等待过恢复内部重启，或两次屏障之间发生过快速重启，后续配置等待只重新核验，不补发第二次重启。
- 进入 Ready 前再次核对同一连接和同一活动修订。验证期间修订从 A 变化为 B 时，在原事务预算内重新完成探测与模型证据，不提交旧修订的成功状态。
- Gateway 主连接只有在 WebSocket 仍打开且 Runtime Identity 核验完成后才发布为 connected。核验等待期间连接关闭或换代会作废待定身份，迟到结果不能残留为可用 Runtime。
- Gateway Manager 只拥有连接轮次，WebSocket 退避与耗尽只由 Connection 持有；进程健康观察不再重置退避。显式同目标连接会先结束旧传输再建立新轮，不能停在无后续事件的探测状态。
- 新的 `connect` 响应被 Gateway 接受后立即清除旧配对等待；后续协议或身份失败进入有界普通重试，不再无限按配对间隔轮询。用户取消普通配对统一经 Manager 收敛活动握手与等待定时器，取消后只有显式恢复才能开启新连接轮次。
- 生命周期连接收敛只把目标解析失败、当前连接身份失败和传输重试耗尽当作终态；进程观察瞬时错误只保留为诊断。
- 特权临时连接在发送管理 RPC 前再次核对主连接标识、端点与凭据；临时握手期间来源换代时拒绝请求，不能在写操作已经发送后才报告围栏失效。
- 手工输入的 Gateway shared token 仅用于当前进程重连，不再写入设备凭据存储；设备凭据只接受 OpenClaw 握手签发。
- Guided 候选梯子跳过明确无凭据项，并在已有默认模型激活失败后停止自动替换；自动激活成功后保留用户确认当前路径或改选的边界。
- Guided 和 Classic 共用 setup admission busy 分类；不可用候选、官方修复入口、推荐安装和取消操作均保留正式协议语义。
- 首次设置运行时页面原地完成 Gateway 认证与身份核验；只有 Guided 可操作状态或 Classic 首个官方步骤准备完成后才进入配置页，不显示空配置页后自动跳变。
- 本次设置开始前已安装的 Native OpenClaw 在“正在配置 JunQi Desktop”完成后显示“下一步”并进入独立更新步骤；本次流程中新安装的 OpenClaw 显示“核验配置”并直接准备官方配置。更新检查完成后才可继续，检查失败保留原地重试，可用更新仍由用户明确确认。
- 当前 Runtime 以正式 `INVALID_REQUEST` 明确拒绝 `wizard.start.installDaemon` 时，错误分类为 Classic Wizard 参数不兼容；主操作不再重复发送同一无效请求，也不省略字段降级。
- Guided 能力协商先调用最新版 `openclaw.setup.detect`，仅在精确 unknown-method 时调用 stable 正式提供的 `crestodian.setup.detect`。任一成功后 activate 与 chat 绑定同一方法族，只有两者均明确不支持才进入 Classic。
- stable Crestodian detect 的较小正式 schema 被显式规范化为当前 UI 所需结构；activate 严格省略其 schema 未定义的 `modelRef`。activate 返回的真实模型调用成功作为本次交接模型证据，不调用不存在的 verify，也不重放 activate。
- Classic Wizard 协议不兼容不再进入更新页，也不再提供会重复发送无效请求的主操作；当前 Runtime 已核验 Guided 可用时，配置页直接提供“返回官方引导”。更新页仅服务于本次设置开始前已有的 Native 安装。
- OpenClaw 新安装继续使用官方定义为 stable 的 npm `latest`，不从版本字符串推断渠道。已有安装只有 `stable` 与 `extended-stable` 可以进入 JunQi 受管更新和后续配置；`beta`、`dev`、其他值与缺失渠道均保持阻断。Rust 更新 command 在 Gateway 维护交接前再次执行同一门禁，不能绕过前端。
- JunQi 不自动切换用户已有的 OpenClaw 更新渠道。官方渠道切换可能持久化并降级，因此非生产渠道只展示官方更新说明入口，等待用户显式切换后重新检查。
- 数据位置初始状态不再递归统计旧 OpenClaw 目录容量，表单字段同步删除无消费者的容量值；迁移事务内的复制完整性统计保持不变。
- 修复首次安装选择当前数据目录时被 Gateway 服务核验反向拦截的问题。bootstrap 是否存在不再等价于 OpenClaw 已安装；当前目录无运行时位置、配置路径或恢复状态变化时只提交布局，真实迁移和服务绑定变化仍严格核验。
- 官方步骤、二维码、日志、数据位置表单和页面方向过渡继续遵循当前首次启动规格；本轮未新增平行 Gateway 重启入口或客户端成功推断。
- 顶部“工具”入口的内容仍由 OpenClaw 工具配置页承载，但导航归属现在识别完整的 `/config?tab=tools`；该页面不再错误高亮“智能体”或显示智能体侧栏。普通 Provider、Agent 与渠道配置仍归“智能体”。
- 已只读审查同级 Qclaw 项目的首次设置、模型、渠道和配置写入链路。其“模型供应商、消息渠道、配对”首次流程及模型、渠道、Skills 独立入口可作为信息架构参考；其 Control UI 浏览器桥、整份 `config.apply`、`baseHash ?? hash`、直接配置文件写入和失败后本地回退不作为 JunQi 契约依据。

## 关键技术决策

- Wizard 终态、Gateway 进程健康、认证连接、Runtime Identity 和活动配置修订是不同事实，必须按顺序分别核验。
- `config.get.hash` 是配置写入冲突控制值，不是活动 Runtime 修订证据；缺失 `configRevisionHash` 或 `appliedConfigHash` 时失败关闭并要求更新 OpenClaw。
- `installDaemon: false` 只关闭 Wizard 的 daemon 安装分支，不关闭 OpenClaw 自身的配置监听和进程内重启；JunQi 不得因此抢跑重启。
- OpenClaw 可能为活动 Wizard 工作延迟官方重启，并可能在实际重启前轮换共享认证代次。旧 socket 仍在线、旧 token 可用或重启命令返回成功都不能证明接管完成。
- 只有官方结构化配置或健康状态可以证明重载被禁用；文本、超时和空结果不能升级为显式重启依据。
- 所有恢复、重连和重启继续经 `GatewayLifecycleCoordinator`；业务页面不得直接控制 Gateway 进程或系统服务。
- 是否已经发生过重启由协调器在真实原生副作用调用点记录，不按外层动作名称、进程状态或最终返回值推断；结果失败或未知也不能自动重放同一次补偿。
- Gateway 连接重试只有一个所有者。健康轮询只提供端点事实，不能在 Connection 的尝试、退避或耗尽阶段并发创建第二轮连接。
- 任何管理写请求都必须在副作用发送前通过当前连接来源围栏，事后拒绝不能撤销已发生的写入。
- 当前 RPC 协议不兼容、当前渠道存在更新、更新后 RPC 已兼容是三个独立事实；前两者不能推导第三个事实。
- 方法名变化不能按版本号猜测。只有当前正式 detect 的精确 unknown-method 才允许探测另一个已核对 schema 的官方方法族；权限、连接、非法响应与业务失败均保持原错误。
- beta 只可作为上游协议演进的审计证据，不能成为生产安装、受管更新或配置候选。生产渠道只接受官方 `stable` 与 `extended-stable`，未知值失败关闭。
- Gateway 服务身份核验由存储事务是否会改变服务绑定或恢复状态决定，不能由 bootstrap 是否存在间接推断。无服务副作用的当前目录确认不依赖 OpenClaw 二进制，迁移和重绑仍失败关闭。
- OpenClaw 官方主线要求程序化局部写入先通过 `config.get` 取得当前 `hash`，再以该值作为 `baseHash` 调用 `config.patch`；`config.apply` 只用于有意替换整份配置。第三方客户端的直接文件写入保护、应用内 rebase 或失败回退不能替代该控制面冲突契约。

## 核心文件

- `src/services/setup/openClawSetupHandoff.ts`
- `src/services/gateway/OpenClawGuidedSetupClient.ts`
- `src/services/gateway/OpenClawConfigApplicationClient.ts`
- `src/services/gateway/OpenClawConfigSnapshot.ts`
- `src/services/gateway/Connection.ts`
- `src/services/gateway/GatewayConnectionSettlement.ts`
- `src/services/gateway/GatewayLifecycleCoordinator.ts`
- `src/services/gateway/GatewayConnectionManager.ts`
- `src/services/gateway/runtimeIdentity.ts`
- `src/services/gateway/index.ts`
- `src/business-guide/steps.ts`
- `src/components/BusinessGuide/BusinessGuide.tsx`
- `src/runtime/gatewayLifecycle.ts`
- `src/hooks/useSetupFlow/useWizardSession.ts`
- `src/hooks/useSetupFlow/useGuidedSetupSession.ts`
- `src/services/openclawWizard.ts`
- `src/components/shared/OpenClawUpdatePanel.tsx`
- `src/components/Layout/tab-utils.ts`
- `src/pages/SetupPage/ProgressScreen.tsx`
- `src/pages/SetupPage/OpenClawUpdateScreen.tsx`
- `src/hooks/useSetupFlow/setupPreflight.ts`
- `src-tauri/src/commands/storage.rs`
- `src-tauri/src/commands/openclaw_update.rs`
- `docs/quality/setup-preflight-audit-2026-08-14.md`
- `specs/2026-08-14-setup-preflight-gates.md`
- `plans/2026-08-14-setup-preflight-gates.md`
- `docs/quality/openclaw-wizard-terminal-handoff-audit-2026-08-11.md`
- `specs/2026-08-12-openclaw-native-installation-alignment.md`
- `plans/2026-08-12-openclaw-native-installation-alignment.md`

## 测试与验证

- 定向连接安全、连接收敛、生命周期协调、活动配置应用、终态交接和 Guided 方法族协商回归已通过；本轮相关定向前端测试 72 项通过。
- OpenClaw 官方远端 `main` 已核对到提交 `b3d5265f58522bab67e06168d436b3b328cbae60`。它相对上一审计基线仅包含 Docker 安全加固，Wizard 终态、Hosted 工作保留、配置应用修订、重载和认证代次契约没有变化。
- `pnpm lint` 已通过，包含 906 个文件的模块边界检查、版本一致性和 TypeScript 类型检查。
- `pnpm test` 已通过；新增回归覆盖已有 Native 安装进入独立更新步骤、本次新安装跳过、检查完成门禁、Wizard 协议拒绝、稳定渠道更新提示，以及 beta、dev 与未知渠道阻断。
- `pnpm build` 已通过，包含协作插件、钉钉业务插件、TypeScript 与 Vite 生产构建；`pnpm verify:openclaw-docs` 已通过。
- `cargo fmt -- --check`、`cargo check --lib` 与完整 `cargo test --lib` 已通过；Rust 共运行 639 项，638 项通过，1 项会修改当前用户 Keychain 的测试按设计忽略。以 `same_location_` 过滤运行的三项存储回归全部通过，其中两项为本轮新增，分别证明当前目录无副作用确认不需要 OpenClaw、未完成服务恢复仍要求核验。
- 已基于首次设置、OpenClaw 核心操作引导、新会话首发、存储门禁和工具导航修复，使用无 updater 制品配置重新构建 macOS ARM64 `.app` 与 DMG；前端生产构建和 Rust release 编译随打包命令通过，`hdiutil verify` 通过，应用版本为 3.1.0。最新 DMG 文件大小为 8363663 字节，SHA-256 为 `e6681c309d98a27991f677b576824120980c12751c607b4c61342b0d40c444b0`。
- 已结束 `/Applications` 中旧的 `junqi-desktop` 测试进程并用 `open -n` 启动本轮构建目录中的 `.app`，当前进程 PID 35127。用户此前在当前机器真实提交 `/Users/wei/.openclaw`，日志证明存储位置于 17:15:56 保存成功并进入 Node、npm、OpenClaw 安装；该结果证明本次报告的当前目录首次安装阻断已消失，不代表自定义目录迁移或其他平台已验收。
- npm 官方 registry 与 npmmirror 在 2026-08-14 均返回 `latest: 2026.7.1-2`、`beta: 2026.8.1-beta.1`、`extended-stable: 2026.6.34`。本机 updater dry-run 返回 stable、`openclaw@latest`，当前与目标均为 2026.7.1-2；`-2` 是官方稳定修订，不是 beta。
- npm 官方 registry 与 npmmirror 返回的 `openclaw@2026.7.1-2` SHA-1 均为 `4583b987ea7277230ce1c7b2b8535d3e219f57ac`，SHA-512 integrity 也完全一致；两端仅 tarball 域名不同。用户本机安装日志显示 JunQi 在确认版本与 tarball 可达后通过 npmmirror 安装并再次验出 2026.7.1-2。
- 本机 `openclaw.setup.detect` 真实返回 `INVALID_REQUEST unknown method`，随后 `crestodian.setup.detect` 在同一 2026.7.1-2 Gateway 上成功返回候选、工作区、当前模型和 `setupComplete`。为避免修改现有用户配置，没有在开发机执行有写入副作用的 activate；其请求和响应边界由稳定包正式 schema、handler 与回归测试核对。
- 新会话首发定向回归 19 项通过，覆盖 stable leaf 围栏拒绝、同连接只协商一次、最新版围栏保留及其他错误禁止重放；真实新会话首发仍需用户在当前窗口执行一次交互确认。
- OpenClaw 操作引导定向回归 7 项通过，覆盖启用门禁、四项核心步骤的固定顺序、选择器唯一性和持久化语义；完整 `pnpm lint`、`pnpm test` 与 `pnpm build` 已通过。引导复用 `Button` 及 `aegis-bg`、`aegis-surface`、`aegis-border`、`aegis-text`、`aegis-primary` 等现有主题 token。
- 数据位置页初次进入时的可见空白是 `StorageFormSkeleton`，其生命周期绑定 `get_storage_setup_status`。本轮已删除该初始 IPC 中对旧目录的递归容量统计；未做连续抓帧计时，不能声称其他路径探测不会贡献等待时间。
- 本地 `.app` 严格代码签名校验未通过，`codesign` 报告资源封签缺失。该结果符合本地无发布凭据构建边界，但不能作为开发者签名或公证证据。
- `git diff --check`、本次修改文件的 Emoji 扫描和多语言 JSON 解析已通过。
- 工具导航定向回归 4 项与 TypeScript 类型检查通过，覆盖工具配置归属、普通配置归属和工具入口目标。

## 已知问题与未验证边界

- 最新 OpenClaw 上的真实 Guided provider、浏览器授权、官方活动工作延迟重启、token 轮换和新认证连接尚未完成 macOS 安装包端到端验证。
- 当前本机已安装 Runtime 缺少活动配置修订字段，只能验证“证据不可用”分支，不能证明最新版 Runtime 的成功接管链路。
- 当前 npm `latest` OpenClaw 2026.7.1-2 的 Classic Wizard 尚不接受 `wizard.start.installDaemon`，因此用户显式选择 Classic 时仍会得到真实不兼容状态；默认配置已改用该 Runtime 同时提供的官方 Crestodian Guided，不再等待不存在的稳定更新。
- macOS、Windows、Linux 与 Docker 的系统服务、凭据库、连接轮换和首次进入工作台仍需分别在目标环境真机验证。
- 真实渠道插件授权、Classic Wizard 收尾、暗色主题、窄窗口、键盘焦点和减少动态效果不属于本轮自动化能够证明的范围。
- 本轮 macOS ARM64 DMG 是未签名、未公证的本地安装验证包，不是正式 Release；严格代码签名校验已确认其不具备完整资源封签。未构建其他平台安装包，也未发布远端制品。

## 下一步顺序

1. 在隔离测试配置上执行 stable Crestodian activate、聊天完成、配置应用与 Ready 全链路真机验证，并在最新版 OpenClaw Runtime 上执行对应方法族的终态收敛验证。
2. 覆盖共享 token 轮换、设备凭据连接、主连接换代和管理员临时写请求的真实 Gateway 场景。
3. 使用本轮重新生成的安装包连续抓帧验证 macOS 数据位置加载、更新检查和协议不兼容提示，再分别完成 Windows、Linux 与 Docker 真机验收。
4. 未经明确要求不推送、打 tag 或发布。
