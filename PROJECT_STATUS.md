# 项目交接状态

更新时间：2026-08-13

## 当前目标

全面对齐当前所选 OpenClaw Runtime 的正式首次安装能力，并完成 OpenClaw 官方配置终态到 JunQi 工作台的单一、可核验交接链路。配置模式依据正式 RPC 响应协商，不绑定版本号。当前优先验证运行时执行页原地核验、宽窗口安装诊断布局和最新版 Guided 真机链路。

## 已完成内容

- 接入正式 `openclaw.setup.detect`、`openclaw.setup.auth.start`、`openclaw.setup.prepare.start`、`openclaw.setup.activate`、`openclaw.setup.verify` 和 `openclaw.chat` 协议，并严格解析结构化响应。
- 首次配置按正式 RPC 响应协商：支持 `openclaw.setup.detect` 时使用 Guided；明确 unknown-method 时使用官方 Classic Wizard。连接、权限与响应错误不会触发模式切换。
- 官方自动候选按返回顺序执行真实激活，但跳过 `credentials === false` 的项；已有默认模型失败后停止自动替换。自动激活成功后先确认当前有效路径，用户可继续使用或明确改选。
- Guided 呈现官方不可用候选、认证或手动修复入口和无候选时的推荐安装建议；未返回正式修复标识时只展示真实原因。
- Provider Wizard 和 chat 内嵌 Wizard 均提供显式取消，分别调用 `wizard.cancel` 与 `wizardCancel`；取消失败不会被组件卸载逻辑吞掉。
- Classic 与 Guided 共用最新版 setup admission busy 判定，严格依据 `UNAVAILABLE`、官方文案与 `retryable: true`，旧的猜测性匹配已删除。
- Guided 和 Classic 共用 `performOpenClawSetupHandoff`：复用当前已核验连接，连接失效时才通过统一生命周期重连；Guided 核验官方配置状态和真实模型，Classic 使用当前官方 Wizard 的 `done`，不再错误调用缺失的 Guided RPC。
- 官方配置正文复用稳定内容槽。用户取得下一官方步骤时从左向右短距离切换，返回外层阶段时从右向左切换；后台等待、错误和交接状态只淡入，减少动态效果时立即完成。
- 交接失败停留在当前配置阶段；重试不重启官方向导，不恢复旧二维码，不持久化完成标记。
- 冷启动先核验持久安装和认证 Gateway。支持 Guided 的 Runtime 再读取官方探测；Classic Runtime 没有全局只读终态探针，因此保留先前由官方 `done` 提交的本地证明，不从健康状态或配置文本猜测终态。
- 二维码只由当前官方结构化步骤或当前步骤中的唯一一次性授权地址派生；提交、步骤变化、失败、取消或终态后立即销毁。
- npm 12 安装命令加入官方要求的 `--allow-scripts=openclaw`；安装晋升继续核验官方 postinstall inventory 和 JavaScript 入口。
- 删除已被当前原生安装规格取代的旧首次设置与 Classic 完成凭据规格、计划以及相应旧实现。
- 删除数据位置读取后的重复完成页和错误的自动推进路径；读取完成后始终停留在表单，用户点击“下一步”并提交成功后才进入运行时阶段。
- 首次设置启动前关闭旧 Gateway 连接，只从当前所选 Runtime 解析连接目标；历史手动地址、默认端点和旧 connected 状态不能再作为安装流程成功证据。
- 显式启动命令完成前，进程状态订阅只更新诊断日志；启动成功后只触发一次所选 Runtime 连接，启动或目标解析失败进入统一可见错误态。
- 首次设置共享骨架不再把步骤正文强制撑满窗口；官方 `done`、短说明和紧凑状态按真实内容高度布局，页面主内容区继续统一承担纵向滚动。
- 数据位置进度改用明确的字符串叶子；英语、简体中文和繁体中文资源在加载与测试阶段拒绝同路径对象与字符串类型冲突。
- 数据位置提交不再切换到独立进度页面，也不再展示客户端自造百分比；原表单保持挂载并锁定交互，主操作显示真实忙碌状态。
- 安装日志由共享页面骨架统一控制：普通步骤默认收起；依赖安装在宽窗口左右并列执行步骤与执行记录，窄窗口才使用用户控制的切换。
- Gateway 认证连接与运行时身份完成后原地更新运行时执行摘要；`gateway-ready` 只保留内部核验状态，不再生成独立“运行时已就绪”页面。配置核验仍由用户显式触发，真实失败在同一摘要和主操作中呈现。
- 配置核验现在先在运行时页面内完成协议协商：Guided 取得候选确认或选择状态，Classic 取得首个官方 Wizard 步骤后才进入配置页；配置页不再先展示客户端连接占位卡后自动切换。
- Classic 普通提示、操作与进度步骤统一使用紧凑官方摘要，明确状态层级并保留上游标题和正文。官方 `outro` 仍按正式 `note` 等待确认，只有后续结构化 `done` 才触发完成交接。
- 官方配置终态后的 Gateway 重连显式绑定当前所选 Runtime，重新解析当前端点和凭据，不再沿用历史手动连接目标。
- 首次设置的 Classic Wizard 显式提交官方 `installDaemon: false`。Gateway 已由运行时阶段统一安装并启动，配置向导不会再通过 daemon 收尾重启承载其进程内 session 的 Gateway；真实 session 丢失仍保持未知终态，不自动重放配置写入。
- 配置正文的前进与后退过渡改为串行退出和进入，旧、新官方步骤不会在同一内容槽叠放；方向语义和减少动态效果行为保持不变。
- 官方提示、待执行操作和处理中状态继续复用单一紧凑摘要，通过现有主色与警告色 token 的细引导线、图标底和眉题色增加层级；官方正文使用次级正文色，来源说明使用弱化文字色，来源图标保留状态语义色。

## 关键技术决策

- OpenClaw 拥有模型、凭据、工作区、渠道、Wizard、onboarding chat 和完成状态；JunQi 只呈现协议并执行桌面交接门禁。
- Gateway 端口健康、进程存在、本地标记和二维码状态均不能证明配置完成。
- 首次设置的连接完成事实固定为同一条当前连接通过 `hello-ok` 围栏和 Runtime Identity 核验；普通设置页的手动 Gateway 地址规则不受该边界影响。
- Guided 与 Classic 不并行；只有明确 unknown-method 才从 Guided 能力探测切换到官方 Classic，不能因断线或权限失败切换。
- 交接顺序固定为认证连接围栏与所选 Runtime 核验；Guided 随后执行 `setup.detect` 和 `setup.verify`，Classic 消费官方 Wizard `done`。只有连接失效才重连，未知结果不自动重放有副作用的配置操作。
- 普通步骤的日志展开状态属于共享展示层；依赖安装的宽窗口双栏和窄窗口切换只改变呈现，不改变安装业务状态。
- `gateway-ready` 是运行时阶段的内部门禁，不是用户可见的新阶段；只有进入 Guided 或 Classic 官方配置时步骤器才推进到配置阶段。
- 冷启动已经配置的 Runtime 按官方 `setupComplete` 跳过 onboarding；fresh activation 和配置终态交接必须执行真实模型核验。

## 核心文件

- `src/services/gateway/OpenClawGuidedSetupClient.ts`
- `src/services/setup/openClawSetupHandoff.ts`
- `src/services/setup/setupEntryGate.ts`
- `src/hooks/useSetupFlow/useGuidedSetupSession.ts`
- `src/hooks/useSetupFlow/useWizardSession.ts`
- `src/hooks/useSetupFlow/index.ts`
- `src/pages/SetupPage/GuidedSetupScreen.tsx`
- `src/pages/SetupPage/GuidedInferenceSelectionPanel.tsx`
- `src/services/setup/openClawSetupAdmission.ts`
- `src/pages/SetupPage/OpenClawConfigurationScreen.tsx`
- `src/pages/SetupPage/wizard/WizardNoticeStep.tsx`
- `src/components/setup/SetupFlowPanels.tsx`
- `src/components/setup/StorageSetupGate.tsx`
- `src/i18n/resources.ts`
- `src/motion/setupStepTransition.tsx`
- `src/services/openclawWizard.ts`
- `src/App.tsx`
- `src-tauri/src/commands/setup/openclaw.rs`
- `docs/quality/openclaw-native-installation-alignment-audit-2026-08-12.md`
- `specs/2026-08-12-openclaw-native-installation-alignment.md`
- `plans/2026-08-12-openclaw-native-installation-alignment.md`

## 测试与验证

- 本轮 Wizard daemon 门禁、内容切换和官方短步骤视觉定向回归 111 项通过；完整前端与脚本测试、lint 和生产构建已通过。
- 测试输出包含既有 Node 注册接口弃用警告和服务端渲染 Tooltip 警告，没有失败项。
- 本轮没有修改 Rust；既有 Rust 635 项通过、1 项忽略的结果未在本轮重跑。
- `pnpm lint`、`pnpm build` 与 `pnpm verify:openclaw-docs` 已通过；`git diff --check` 在最终差异扫描中执行。
- 本轮数据位置提交、安装诊断响应式布局、Gateway 原地核验、Gateway 交接和 Guided 对齐修复已通过自动化验证；是否包含于安装包必须以本轮之后重新生成的制品为准。

## 已知问题与未验证边界

- 最新版 Guided 真实 provider 登录、浏览器授权、取消后的官方终态以及自动激活后的改选路径尚未在支持当前协议的 Runtime 上完成真机端到端验证。
- 当前数据位置显式确认、提交期间表单稳定、安装诊断双栏、Gateway 原地核验、连接代次、短步骤内容高度和国际化资源修复尚未完成连续页面真机验收。
- 真实 provider 登录、真实 completion、官方 onboarding chat、钉钉授权和 Classic daemon 选择尚未在当前 macOS 安装包中完成端到端验证。
- Windows、Linux、Docker、系统服务、凭据库和外部浏览器行为尚未在目标平台真机验证。
- 当前本机稳定 OpenClaw `2026.7.1-2` 已复现 Classic 协议和 Guided unknown-method；最新版 Guided 真实 provider 流程仍需独立 Runtime 验证。
- 暗色主题、窄窗口、键盘焦点和减少动态效果尚未完成本轮真机视觉验收。
- Classic Wizard 的真实 daemon 收尾、配置步骤前后切换和终态回收尚未在本轮安装包中完成连续真机复验。
- 当前构建仍有既有 pnpm 配置迁移警告，但不影响本轮检查与生产构建结果。
- 本地 DMG 为 ARM64、ad-hoc 签名且未经 Apple 公证，不是正式发布制品；Intel macOS 以及其他目标平台未由该包覆盖。

## 下一步顺序

1. 在支持当前 Guided 协议的最新版 Runtime 上验证真实 provider、浏览器授权、两类取消、路径确认和改选。
2. 重新生成本机安装包后验证既有数据位置、日志、短步骤与 Gateway 交接修复。
3. 分别验证 macOS、Windows、Linux 和 Docker，并完成暗色、窄窗口、键盘焦点和减少动态效果视觉验收。
4. 未经明确要求不提交、打包、推送、打 tag 或发布。
