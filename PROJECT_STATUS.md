# 项目交接状态

更新时间：2026-08-11

## 当前目标

在不改变 OpenClaw、Tauri 和 DWS 权威语义的前提下，按真实用户路径收敛 JunQi Desktop 的交互、动效、信息层级和跨页面视觉一致性。

## 已完成内容

- 渠道中心由单文件堆叠界面调整为紧凑的目录与详情双栏，并拆分渠道列表、渠道详情、渠道目录和账号编辑四个单一职责组件。
- 渠道目录改为可搜索对话框，安装状态、图标、来源与可配置入口全部来自当前所选 Runtime；主页面不再平铺重复的渠道卡片和汇总卡片。
- 渠道状态读取统一封装为官方 `channels.status` 请求，保留所选 Runtime CLI 作为正式适配层；后台探测保留上一份快照，目标渠道探测只合并目标状态。
- 删除渠道名称驱动的凭据字段规则和历史钉钉迁移路径。账号是否缺少凭据只服从 Runtime 的结构化 `configured` 与 `linked` 状态，账号编辑字段只来自插件 schema。
- 渠道页面删除独立的 Gateway 重启、固定轮询和重复诊断入口。配置保存经全局 Gateway 生命周期协调器重启，随后只进行一次配置与渠道状态刷新。
- Runtime 原始状态与脱敏日志移动到按需展开的证据区域；错误在页面和操作附近保留真实反馈，不以目录存在、安装成功或二维码显示推断账号可用。
- 新增 `docs/channels/openclaw-third-party-channel-support.md`，基于 2026-08-11 OpenClaw 最新官方目录整理 31 个渠道入口、插件归属、配置授权方式、国内重点渠道、扫码语义和 JunQi 动态呈现边界。
- 明确钉钉消息连接器由钉钉团队维护但未进入当前 OpenClaw 官方渠道目录，JunQi 只在 Rust 可信边界代管其固定包安装；同时区分 `dingtalk-connector` 消息渠道与 DWS 业务工具插件。
- 明确 WhatsApp、Zalo Personal、WeChat、DingTalk、Feishu、QQ Bot、Zalo ClawBot 和 Signal 的扫码语义与结构化输出差异，禁止按渠道名称或终端日志伪造通用扫码状态。
- 新增 `docs/installation/openclaw-wizard-start-flow.md`，基于 2026-08-11 OpenClaw 最新主线整理 `wizard.start`、`wizard.next`、`wizard.cancel`、`wizard.status`、步骤协议、完整 Setup、独立 Channels、会话准入、终态回收和 JunQi 当前适配边界。
- 文档明确记录 `wizard.status` 读取后回收会话、暂停不等于取消、Gateway 重启会丢失进程内会话、渠道持久副作用后可锁定取消，以及 JunQi 当前首次配置不发送独立 `channels` flow。
- 已直接核验当前 Gateway 的官方 `usage.cost` 响应：30 天存在 30 个日期桶、17 天有非零费用；Token 与可估价费用是不同信号。
- 已确认部分历史调用返回 `missingCostEntries`，JunQi 保留“未估价”语义，不以零费用伪造结果。
- Dashboard 在费用数据尚未返回时显示加载态，不再在 effect 发起请求前错误显示空状态。
- `cost` 和 `usage` 改为可释放的页面级轮询：Dashboard、活动中心与已打开的智能体设置面板持有读取，最后一个消费者离开后停止对应定时器。
- 手动刷新仅执行一次官方读取，不再意外启动长期的费用或历史用量后台轮询。
- 会话列表使用递归投影比较替换完整 `JSON.stringify` 比较；无变化 Gateway 快照不会触发 Zustand 更新和订阅者重渲染。
- 确认步骤的 Runtime 提示只由确认控件渲染，不再同时作为页面副标题重复显示。
- “配置 OpenClaw”阶段的配置核验与向导连接默认展开日志；正常交互步骤默认收起，失败时自动展开，用户始终可以手动切换。
- 配置核验与官方 Wizard 共享视觉场景但不再共享滚动位置；切换步骤会重新挂载主体滚动容器，上一状态的日志滚动不会把下一状态移出视口。
- 授权呈现已收敛到共享 `QrCodeDisplay`。任意官方步骤携带 `externalUrl` 时都会在 WebView 内本地生成二维码；第三方步骤未返回该字段、但当前 `message` 只含一个明确 HTTPS 地址时，将该地址原样投影为二维码，同时保留插件原文、复制与浏览器入口。零个或多个地址时不猜测。
- 渠道扫码请求已严格收敛到 OpenClaw `web.login.start` 与 `web.login.wait` 的封闭参数和返回结构，删除客户端自定义的 `channel`、`sessionId`、`qrContent`、`status` 与 `qrLogin`。扫码入口只根据 Runtime 插件正式声明的 `gatewayMethods` 呈现。
- 已删除重复的 Rust 二维码 IPC、命令注册和依赖。Wizard 的授权地址与官方 `qrDataUrl` 现在共用一个前端展示组件，二维码生成不访问网络，也不推断授权状态。
- 已核验 JunQi 启动时使用 Gateway 配置的 `OPENCLAW_LOCALE`，首次创建配置才按当前应用语言写入该值。当前已安装第三方 DingTalk 插件将凭据保留提示静态写为英文，未使用 OpenClaw 本地化接口；客户端不重写第三方 Runtime 文案。
- 设置页新增独立的“OpenClaw 运行时语言”：读取官方 `config.get` 快照，保存前重新取最新 `hash`，再以最小 `config.patch` 写入 `env.vars.OPENCLAW_LOCALE`。
- 运行时语言只提供 OpenClaw 原生支持的英语、简体中文和繁体中文；未知配置保留并显示原值，不猜测映射。
- JunQi 管理且允许桌面变更的 Runtime 保存后通过统一 Gateway 生命周期入口重启；外部或远端 Runtime 明确提示由其所有者重启，不伪造已应用状态。
- 已完成 AI 原生交互首轮视觉收敛：Composer、会话消息、工具调用、响应轨迹、原生任务账本和原生审批均保留既有 OpenClaw 调用与状态模型，仅优化输入锚点、消息表面、摘要行、详情层级、来源可读性和决策区反馈。
- 已完成合并 `main` 后的 AI 原生交互全量审查，覆盖路由入口、应用外壳、主题、会话、安装、渠道、任务、审批、文件预览、终端、Jarvis 语音和业务工作台。
- 已建立按会话主路径、安装与渠道控制面、任务与文件、终端与工作台、全局收口划分的实施顺序；所有批次只允许投影已有的 OpenClaw、Tauri 或 DWS 状态。
- 已完成会话主路径首轮实施：输入、工具、上游思考内容、响应轨迹和侧栏详情统一为可聚焦的摘要与详情交互，上下文压缩分隔移除无限渐变动效。
- 已完成安装进度面板首轮实施：状态和进度条回归 Aegis 语义 token，减少动态效果时停止自动滚动动画和进度脉冲。
- 已完成公共视觉基线收敛：卡片、浮层和菜单投影降低，常用圆角与过渡时长收紧；颜色过渡仅保留在可交互控件，
  路由和数据刷新不再触发整页表面滞后。删除了无消费者的流光边框与思考微光全局样式。
- 应用外壳与导航侧栏移除背景渐变和无消费者的环境光节点，统一使用单一 Aegis surface，避免主题与路由
  切换时叠加装饰层。

## 关键技术决策

- 渠道 UI 只投影 OpenClaw 目录、schema、capability、status 与 bindings，不维护渠道专属凭据模型、状态机或成功 fallback。
- Gateway 生命周期由全局协调器独占；渠道配置只提出一次重启意图，不拥有第二套重启、重试或健康探测控制面。
- 后台渠道探测属于局部刷新：已有快照继续可读，加载状态独立显示，失败保留上一份证据并明确报告错误。
- OpenClaw 的 `usage.cost` 是仪表盘按日费用与按日 Token 的权威来源；`sessions.usage` 仅用于需要会话或智能体历史聚合的可见页面。
- 客户端不根据 Token 推算或补写费用。缺少官方模型定价或历史归属信息时保留未知费用。
- 重型数据轮询由消费者引用计数控制，连接断开时暂停；连接恢复且页面仍持有消费者时恢复读取。
- JunQi 界面语言与 OpenClaw Runtime 语言是两个独立配置边界；切换界面语言不隐式改写已连接 Runtime。
- Wizard 和插件文案由 OpenClaw Runtime 返回。JunQi 只呈现结构化文本，不为未接入 `createSetupTranslator` 的插件维护客户端翻译表。

## 核心文件

- `src/pages/ChannelsCenter/index.tsx`
- `src/pages/ChannelsCenter/ChannelListPanel.tsx`
- `src/pages/ChannelsCenter/ChannelDetailPanel.tsx`
- `src/pages/ChannelsCenter/ChannelCatalogDialog.tsx`
- `src/pages/ChannelsCenter/ChannelAccountDialog.tsx`
- `src/services/channelConfig.ts`
- `src/services/openclawChannelRuntime.ts`
- `docs/channels/openclaw-third-party-channel-support.md`
- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/pages/Dashboard/index.tsx`
- `src/pages/ActivityCenter.tsx`
- `src/pages/AgentHub/AgentSettingsPanel.tsx`
- `docs/gateway/gateway-lifecycle-unification-validation-2026-08-10.md`
- `src/pages/SetupPage/WizardScreen.tsx`
- `src/pages/SetupPage/OpenClawConfigurationScreen.tsx`
- `src/pages/SetupPage/wizard/WizardStepRenderer.tsx`
- `src/pages/SetupPage/wizard/WizardAuthorizationHint.tsx`
- `src/components/shared/QrCodeDisplay.tsx`
- `src/utils/qrCode.ts`
- `src/services/channelQrLogin.ts`
- `src/services/openclawChannelRuntime.ts`
- `src/components/setup/SetupFlowPanels.tsx`
- `src/motion/setupStepTransition.tsx`
- `docs/installation/junqi-installation-flow.md`
- `docs/installation/openclaw-wizard-start-flow.md`
- `src/services/gateway/OpenClawRuntimeLocale.ts`
- `src/hooks/useOpenClawRuntimeLanguageSetting.ts`
- `src/components/settings/OpenClawRuntimeLanguagePanel.tsx`
- `src/types/openclawRuntimeLocale.ts`
- `src/components/Chat/message-input/ComposerInputSurface.tsx`
- `src/components/Chat/MessageBubble.tsx`
- `src/components/Chat/ToolCallBubble.tsx`
- `src/components/Chat/ChatResponseTraceNodeCard.tsx`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`
- `src/components/Activity/OpenClawApprovalsPanel.tsx`
- `src/components/Chat/ThinkingBubble.tsx`
- `src/components/Chat/TypingIndicator.tsx`
- `src/components/Chat/ChatSidePanel.tsx`
- `src/components/Chat/ChatResponseTracePanel.tsx`
- `src/pages/ChatView.tsx`
- `src/components/setup/SetupFlowPanels.tsx`
- `docs/design/ai-native-interaction-audit-2026-08-11.md`
- `plans/2026-08-11-ai-native-interaction-rollout.md`

## 测试与验证

- 渠道配置、渠道 Runtime、渠道加载呈现与维护页定向回归测试通过，27 项测试通过。
- `pnpm test` 完整前端与脚本测试通过；既有 Radix 服务端渲染测试仍输出 `useLayoutEffect` 警告，不影响退出状态，本次渠道组件未引入该警告链路。
- `pnpm lint` 通过：模块边界、版本一致性和 TypeScript 类型检查通过。
- `pnpm build` 通过：协作插件、钉钉插件、TypeScript 与 Vite 生产构建通过。
- `pnpm verify:openclaw-docs`、locale JSON 解析、`git diff --check` 与 45 个当前变更文件的完整 Emoji 扫描通过。
- 第三方渠道文档已对照 OpenClaw `main` 提交 `2046dbcd6f123abe8a007bda2c58d0835eec7dc2` 的官方渠道目录、外部插件目录、渠道 CLI 和重点渠道源码；确认 31 个聊天渠道入口、4 个外部目录插件，Voice Call 单列为相关通信插件。
- `pnpm verify:openclaw-docs`、本地 Markdown 链接检查、`git diff --check` 与本次 Markdown 完整文件 Emoji 扫描通过；本次渠道整理没有修改产品代码，因此未重复执行产品测试。
- 文档中的最新协议已对照 OpenClaw `main` 提交 `df72781ed45fabf626831e8a2a03ad25ee7d0a08` 的 schema、handler、session、setup admission、完整 Setup Runner 与 Channels Runner；本次仅修改 Markdown，未执行产品代码测试。
- `node --import ./test-setup.ts --import tsx --test src/stores/gatewayDataStore.test.ts src/pages/Dashboard/dashboardInteraction.test.ts` 通过，50 项测试通过。
- `pnpm lint` 通过：模块边界检查、版本一致性检查和 TypeScript 类型检查通过。
- `pnpm build` 通过：协作插件、钉钉插件、TypeScript 与 Vite 生产构建通过。
- `git diff --check` 通过。
- 运行时语言、配置快照和设置页多语言定向测试通过，16 项测试通过；模块边界、版本一致性与 TypeScript 类型检查通过。
- `pnpm test` 完整前端与脚本测试通过；`pnpm build` 协作插件、钉钉插件、TypeScript 与 Vite 生产构建通过。
- 配置向导、渠道协议、Gateway 客户端与本地二维码生成定向回归测试通过，31 项测试通过。
- `pnpm test` 完整前端与脚本测试通过；`pnpm lint` 与 `pnpm build` 通过。
- `cargo fmt -- --check`、`cargo check --lib` 与 `cargo test --lib` 通过；Rust 库测试 682 项通过、2 项忽略。
- 本机 Gateway 诊断仍记录过事件循环延迟；修复后尚未进行目标平台长时间帧率与 CPU 对比。
- 尚未在目标设备使用该第三方 DingTalk 插件完成向导；其英文凭据保留提示需要插件提供方接入 OpenClaw 原生 locale 后验证。
- 尚未在真实远端 Runtime 上验证 `config.patch` 权限与运行时所有者手工重启后的语言生效；界面保留未代管重启的真实状态。
- 已核验钉钉插件 0.8.24 与 2026-08-11 主线尚未调用 OpenClaw `prompter.openUrl()`，仅把授权地址放入当前 note 正文。JunQi 对其中唯一 HTTPS 地址做不改变内容的本地二维码投影，不把该派生展示写回协议状态。
- 本机 `pnpm tauri build` 已完成 arm64 Rust 编译、`.app` 与 DMG 生成；命令最终因缺少 updater 发布私钥而失败。已对最新应用包执行 ad-hoc 签名和严格校验，并重新生成、校验 `JunQi Desktop_3.0.1_aarch64_local.dmg`。该制品仅用于本机安装验证。
- 本轮全量审查已完成源码、路由、主题、共享组件、关键状态来源和既有测试覆盖盘点；`git diff --check` 通过。尚未因审查文档重新执行产品构建或真机视觉回归。
- 会话定向回归 20 项、安装与渠道定向回归 22 项通过；`pnpm lint` 与 `git diff --check` 通过。完整 `pnpm test` 在会话批次后通过，安装批次后已执行相关定向回归。
- 公共主题基线调整后，主题桥接、会话、安装与渠道定向回归共 54 项通过，`pnpm lint` 与
  `git diff --check` 通过；尚未完成桌面亮暗主题真机视觉验收。

## 已知问题与未验证边界

- 本次渠道中心布局尚未在真实 macOS、Windows 与 Linux 安装包中完成亮色、暗色、窄窗口、键盘焦点和屏幕阅读器视觉验收。
- 当前自动化验证了状态请求参数、Runtime 权威边界和配置持久化；真实渠道的安装、授权、入站、出站、掉线恢复和多账号路由仍需使用各平台账号逐项验收。
- 尚未在真实 macOS、Windows、Linux 安装包上执行长时间窗口帧率、CPU 与内存对比；不能将当前源码验证描述为目标平台性能验收。
- 历史调用的可估价性取决于 OpenClaw 转录中的 Provider、Model 与运行时定价配置；未定价条目需要在模型供应商配置中补足真实价格后由官方统计重新聚合。
- 本地 DMG 为 ad-hoc 签名，未进行 Developer ID 签名或 Apple 公证；仅可描述为本机安装验证包。
- 本次空白视口、二维码投影与日志收放修复已完成定向自动化与生产构建，尚未在真实 Wizard 页面完成亮色、暗色、窄窗口与扫码真机验收。
- 飞书当前官方设置面仍只把授权地址交给终端二维码输出；在上游未返回 `externalUrl`、`qrDataUrl` 或其他正式结构化字段前，JunQi 不从日志重建二维码。企业微信等外部插件同样以实际安装插件的正式 Gateway 或 Wizard 返回为准。
- AI 原生交互计划尚未进入批次二至五。审查识别出普通业务组件中存在零散渐变、内联样式和独立动效，但统计结果不是逐项缺陷结论；每项替换前仍需核对真实消费者与主题例外。

## 失败方案

- 将 Token 总量直接显示为费用：会掩盖上游明确返回的未定价条目，违反 OpenClaw 统计语义。
- 在用户离开 Dashboard 后继续全局请求 `sessions.usage`：该方法会扫描历史会话与转录，当前数据规模下会放大 Gateway 和 WebView 的卡顿风险。

## 下一步顺序

1. 完成安装、Gateway 与渠道控制面的其余视觉收敛，并在对应官方契约与当前 Runtime 上验证。
2. 实施任务、审批、文件和 Jarvis 的交互收敛，随后处理终端、智能体与业务工作台。
3. 每批执行定向测试、静态检查和桌面真机视觉验收；最后删除已证明无消费者的旧视觉路径并完成跨平台记录。
