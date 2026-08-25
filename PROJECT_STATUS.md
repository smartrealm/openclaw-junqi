# JunQi 项目状态

更新时间：2026-08-25

## 当前目标

当前产品优先级是完成单用户桌面端到端闭环，不实现或预留企业控制面双轨。当前直接目标是收敛会话消息操作、降低输入时的高频渲染扩散，并删除与智能体中心重复的旧多 Agent 独立页面，使协作办公室成为唯一入口。

## 已完成内容

- 以更新后的 OpenClaw 官方主线 `610fefdabbce28584d5bec940936083b248550f0` 核对 `chat.send.queueMode`、`sessions.abort`、运行中输入、键盘和官方 Composer 行为。
- 以官方 Codex 源码确认中断是当前 Turn 的终态，后续继续是新 Turn；没有把参考动图中的播放图标实现为恢复同一次运行。
- Composer 已从发送、转向、停止三个并排按钮收敛为一个固定主操作位：空闲无内容时为禁用发送，有内容时为发送，活动运行无内容时为停止，有内容时按有效队列模式显示转向、加入后续队列或停止当前运行并发送。
- 主操作继续复用现有 `aegis-surface`、`aegis-border`、`aegis-primary`、`aegis-danger`、文本和焦点主题 token，控件保持既有 34 像素尺寸、圆角、减少动态效果和可访问名称。
- Enter 普通发送，Shift+Enter 换行，输入法组合期间不发送；活动运行中 Ctrl+Enter 或 Command+Enter 明确请求 `steer`。
- `Session` 投影新增官方 `queueMode` 和 `effectiveQueueMode`，只接受 `steer`、`followup`、`collect` 和 `interrupt`，未知值不默认。
- 所有会话消息统一经 `chat.send`；普通发送省略队列覆盖，显式转向携带 `queueMode: "steer"` 并省略 `expectedLeafEntryId`。
- 已删除废弃的 `OpenClawSessionSteerClient`、专属测试和被替代的历史运行时门禁文档；没有保留降级到旧 RPC 或旧 `expectedLeafEntryId` schema 的兼容分支。
- Stop 有精确 `runId` 时只中止该运行；缺少运行标识的非全局会话按键级中止并清理后续队列。两种情况都不删除会话、转录或草稿。
- Stop 失败会在输入框内联显示错误；运行结束或切换会话后清除。空闲 Escape 不再复制上一条用户消息，历史浏览继续使用上下方向键，已发送消息回退和分支继续使用正式 rewind/fork 入口。
- 协作重启状态机现在在统一生命周期成功后先释放 `restart` 写操作围栏，再刷新并通过唯一能力观察入口确认新 Gateway 连接；新连接能力即使在重启动作期间提前发布也不会永久丢失。
- 用户消息的会话分叉继续使用 `GitFork`；多 Agent 协作复用 `ChatIconButton` 和 `UsersRound`，只在操作可执行时显示紧凑图标、可访问名称和本地化提示，不再让后台身份探针以持久加载胶囊占据消息操作栏。
- 新增应用根部与输入区的最小 Zustand 投影；草稿每次变更不再让 `App`、`MessageInput` 之外的整棵订阅链随完整 `chatStore` 重渲染。其余运行时无选择器订阅已改为直接字段选择或浅比较投影。
- 输入区运行投影现在只订阅消息数量，不再订阅完整消息数组；历史消息仅在用户按上下方向键时从 store 读取。助手流式内容增长不会改变输入区运行投影，首次召回历史后可继续浏览，用户编辑则退出历史浏览。
- 已删除旧 `MultiAgentView`、`/agents/live` 路由、`liveAgents` 特性、标签归属和专属导航文案。侧栏“协作办公室”直接进入 `/agents`，办公室、树状、网格和活动视图继续由智能体中心统一承载。
- 智能体树状视图改为依据真实卡片矩形生成连线；滚动视口会换算为完整内容坐标，窄窗口换行和长内容滚动不再沿用单行等分假设。DOM 引用、观察和测量已收敛到独立 Hook，系统要求减少动态效果时不渲染移动圆点。
- 严格审查发现新连线模块最初未进入普通差异列表，已通过完整未跟踪文件检查纳入变更集，避免提交后出现模块解析失败。
- 已精确删除本轮在 `/tmp` 创建的两处截图目录和一份隔离调试配置，没有清理其他临时内容。

## 关键技术决策

- OpenClaw 是会话、运行、队列和中止语义的唯一权威；JunQi 只投影 Gateway 返回的有效队列模式。
- 单一主操作位是 UI 不变量。任何状态都不能同时出现多个发送或停止主按钮。
- 普通点击和 Enter 不强制覆盖 Gateway 当前队列策略；只有明确的修饰键交互发送 `queueMode: "steer"`。
- Stop 是中止当前运行，不是暂停，不提供恢复同一次运行的按钮，也不清空会话上下文。
- 当前安装版本和本机日志只用于复现与验证，不作为能力版本门禁或目标环境默认条件。
- 已发送历史不能由本地 UI 直接改写；只能使用 OpenClaw 的 rewind 和 fork 契约。
- Gateway 重启返回值只决定是否继续核验，不能直接证明插件健康；最终就绪仍要求新连接、精确目标、固定插件版本、schema 和能力契约全部通过。
- 会话分叉与多 Agent 协作是不同业务动作，必须使用不同图标和可访问名称；消息操作栏只容纳当前可执行动作，后台探针不创建长期可见状态。
- 高频输入状态必须通过最小 Zustand selector 隔离，禁止为读取少量字段订阅完整 store。
- 智能体中心是多 Agent 运行投影的唯一桌面入口；不再维护页面级 Session 正则识别、独立轮询和重复英文空态。
- 智能体树状连线使用滚动内容坐标而非可见视口坐标；布局测量属于独立 Hook，页面只消费稳定几何投影。

## 核心文件

- `src/components/Chat/MessageInput.tsx`
- `src/components/Chat/message-input/ComposerInputSurface.tsx`
- `src/components/Chat/message-input/ComposerPrimaryActionButton.tsx`
- `src/components/Chat/message-input/composerPrimaryAction.ts`
- `src/hooks/chat/useComposerSuggestions.ts`
- `src/components/Chat/message-input/composerSuggestionDomain.ts`
- `src/hooks/chat/useComposerInterruption.ts`
- `src/hooks/chat/useMessageSend.ts`
- `src/services/chat/sendTransaction.ts`
- `src/services/gateway/index.ts`
- `src/services/gateway/OpenClawQueueMode.ts`
- `src/services/gateway/OpenClawSessionAbortClient.ts`
- `src/utils/openClawSessionProjection.ts`
- `src/stores/chatStore.ts`
- `src/stores/chatHighFrequencySelectors.ts`
- `src/stores/collaborationSetupStore.ts`
- `src/components/Chat/MessageBubble.tsx`
- `src/components/Chat/MessageCollaborationActionButton.tsx`
- `src/AppRouteTree.tsx`
- `src/components/Layout/NavSidebarPanels.tsx`
- `src/config/edition.ts`
- `src/pages/AgentHub/index.tsx`
- `src/pages/AgentHub/agentTreeConnectorGeometry.ts`
- `src/pages/AgentHub/useAgentTreeConnectorGeometry.ts`
- `docs/quality/chat-composer-native-interaction-audit-2026-08-25.md`
- `docs/quality/agent-hub-unified-multi-agent-view-audit-2026-08-25.md`
- `docs/quality/collaboration-runtime-update-and-mixed-schema-recovery-audit-2026-08-25.md`
- `specs/2026-08-25-chat-composer-native-interaction.md`
- `plans/2026-08-25-chat-composer-native-interaction.md`
- `specs/2026-08-25-agent-hub-unified-multi-agent-view.md`
- `plans/2026-08-25-agent-hub-unified-multi-agent-view.md`

## 测试与验证

- 修复前回归稳定失败：缺少单一主操作状态解析，且会话投影丢弃官方队列模式。
- 主操作状态矩阵、实际按钮结构、键盘决策、队列投影、发送事务、Gateway 分发和 Stop 策略共 31 项最终定向测试通过。
- 最终完整前端测试 2958 项通过；脚本测试 238 项通过。
- 新增协作重启竞态回归证明新连接在重启协调期间发布后会执行一次精确健康确认并进入就绪；消息协作按钮回归覆盖待启动、查看运行和身份确认三种状态。
- 新增路由回归确认 `/agents` 存在且 `/agents/live` 不再注册；消息操作回归确认身份探针阶段不渲染可见控件；高频 selector 回归确认草稿和助手流式内容变化不会改变应用根部和输入区的非文本投影；历史浏览回归覆盖连续召回与编辑退出。
- 新增树状连线回归覆盖滚动内容坐标、窄窗口换行、工作会话归属、缺失父节点和稳定几何比较。
- `pnpm lint` 通过，模块边界检查覆盖 949 个文件，四处桌面版本均为 `3.2.1`。
- `pnpm build` 通过，协作插件 `0.5.7` 和钉钉业务插件 `0.1.0` 契约校验、固定包重建、TypeScript 与 Vite 生产构建全部完成。
- 现有 ARM64 macOS 本地测试 DMG 对应此前提交 `fe77bbf6`，不包含本轮会话和智能体中心变更，已明确视为过期制品；本轮没有执行桌面打包。
- 本轮生产构建重新生成协作插件 `0.5.7`、schema 15 与钉钉插件 `0.1.0`、33 个工具的固定包并完成契约校验；这只证明仓库构建闭环，不等于已生成或验证新的安装包。
- `git diff --check` 通过；本次修改的全部文本文件未检测到 Unicode 扩展象形字符或常见 Emoji 符号码段。
- 本轮尝试启动独立 Tauri 调试客户端时被已运行的单实例应用接管，所得窗口不是当前源码，因此没有把截图计为视觉验证；系统辅助功能输入自动化也未取得授权。

## 已知问题与未验证边界

- 已以 OpenClaw 官方最新主线 `d1134a45f2fa6bfc691645d1a42650fa64c21dba` 确认 `hello-ok.server.connId` 是每条 WebSocket 连接的世代标识。协作更新重启后长期停留在 `health_pending` 的前端竞态已修复并有回归覆盖；真实目标 Gateway 的连续重启、能力发布和设置面板收敛仍待用户安装本地测试包验证。
- 用户消息协作按钮已完成组件级亮色与暗色共用主题 token、可访问名称、禁用态和粗指针尺寸验证；尚未在真实 Tauri 会话中完成亮色、暗色、窄窗口、悬停和键盘焦点截图验收。
- 智能体中心统一入口已通过路由、语言资源、特性注册和生产构建验证；尚未在当前源码的真实 Tauri 窗口中核对侧栏选中态、办公室空态、窄窗口滚动和四种主题。
- 智能体树状连线已通过纯几何测试证明滚动与换行坐标契约，并遵循系统减少动态效果偏好；尚未通过当前源码的真实 Tauri 连续抓帧核对滚动、缩放和卡片晚到时的视觉稳定性。
- 未经授权向用户真实 Gateway 注入测试消息，因此尚未连续实测活动运行中的转向、排队、中断并发送、Stop、失败和运行结束收敛。
- 暗色主题自动截图未成功，应用最终保持原浅色主题；暗色、护眼和暗黑主题仍需真实桌面视觉验收。
- 尚未在 Windows 和 Linux 验证窄窗口、输入法、修饰键和图标方向；当前真实窗口验证仅覆盖 macOS Tauri 调试客户端。
- 完整测试继续输出既有 Node.js `module.register()` 弃用提示和 Radix Select 服务端渲染提示；Rust 调试构建继续报告既有未使用函数 `current_search_path`。这些提示未导致本轮验证失败。
- 项目命令输出 `package.json#pnpm` 字段忽略警告；本轮没有变更依赖或锁文件，测试和构建仍完成。该警告需要单独核对项目锁定 pnpm 的覆盖配置，不能以当前执行环境推断目标安装环境。
- 未跟踪的 `.easycode/`、`.pnpm-store/`、`dogfood-output/` 和 `outputs/` 是用户既有内容，本轮未修改、删除或纳入变更。

## 失败方案

- 未保留三个并排主按钮，因为它使鼠标和 Enter 存在竞争动作，并压缩窄窗口输入空间。
- 未把参考动图的播放按钮实现为恢复同一次运行，因为 OpenClaw 没有对应暂停和恢复 RPC。
- 未保留 `sessions.steer` 或旧 Gateway 参数拒绝 fallback，因为最新版官方协议已提供统一 `chat.send.queueMode` 契约。
- 未从 `hello-ok.features.methods`、版本号、超时、空结果或本地状态猜测队列能力和运行终态。
- 未通过测试专用 Gateway 状态或硬编码会话字段生成活动运行截图。
- 未继续装饰旧 `/agents/live` 空页面，因为它与智能体中心重复拥有 Session 识别、轮询、详情和空态；删除双轨入口比维护第二套投影更符合当前边界。

## 下一步顺序

1. 如需安装验证，先基于当前源码重新生成本地测试包，不能复用提交 `fe77bbf6` 的旧 DMG。
2. 在当前源码的真实 Tauri 窗口核对侧栏“协作办公室”选中态、办公室空态、树状、网格和活动视图，覆盖标准与窄窗口。
3. 在真实会话连续核对中文输入法、用户消息操作栏、转向或排队、Stop 和终态收敛，并覆盖亮色、暗色、护眼和暗黑主题。
4. 在真实 Gateway 重启中确认协作设置从等待状态收敛为就绪。
5. 在 Windows 与 Linux 目标客户端验证输入法、Ctrl+Enter、窗口缩放和图标方向。

## GoClaw 对比审查

- 已只读审查 GoClaw `dev` 分支 `fc8a35eebda4232eaa1ebcbe72066edd616022eb`，并确认本地分支与远端 `dev` 一致；同时重新拉取 OpenClaw 官方主线 `041d48eccbc591c8a46b904c31358388cf563ae4` 作为当前协议依据。
- GoClaw 是独立 Go 语言重实现，不是 OpenClaw 插件或兼容发行包。它拥有自己的 Agent 循环、PostgreSQL/SQLite 存储、WebSocket v3、HTTP API、Web 管理台和 Wails 桌面端。
- GoClaw 连接参数仍使用顶层 `token`、`user_id`、`tenant_id` 等字段，协议常量为 v3；官方 OpenClaw 普通客户端当前要求 v4，并使用正式客户端身份、角色、scope、认证和设备证明握手。因此 GoClaw 不能替换 JunQi 当前 Gateway 而保持协议兼容。
- JunQi 当前已有 112 个 OpenClaw 命名的 Gateway 模块、252 个 Gateway TypeScript 模块、60 个涉及 OpenClaw 的 Rust 文件；接入 GoClaw 属于新增独立运行时和客户端协议，不是局部改造。
- GoClaw Standard 的 PostgreSQL 多租户、RBAC、租户 API key、用量门禁、审计、追踪、备份恢复和集中 Web 管理台更接近共享企业服务端。官方 OpenClaw 明确采用单一可信操作员边界，敌对租户需要每租户独立 Gateway cell。
- GoClaw Lite 桌面版本关闭 RBAC、多租户、知识图谱、向量检索和渠道能力，并限制五个 Agent、一个团队和五名成员，不能用 Lite 的桌面体验代表 Standard 的企业能力。
- GoClaw 根许可证为 CC BY-NC 4.0，当前中文版 README 徽章却标示 MIT；商业产品采用前必须取得明确授权并修正许可证识别。其主 CI 还允许契约测试因缺少服务而跳过，Tailscale 和 Redis 在变更日志中标记为未做真实生产验证。
- 本次未运行 GoClaw 全量测试、PostgreSQL 集成测试、租户渗透测试、并发压测、故障恢复演练或目标平台桌面验收，不能据源码结构宣称其已达到企业生产准入标准。
- 当前建议是不把 GoClaw 伪装成 OpenClaw Gateway。若继续评估，应先解决商业授权，再选择独立 GoClaw 产品模式；若保持 JunQi 的 OpenClaw 客户端定位，则优先建设每租户 Gateway cell 的企业控制面。

## 企业控制面实现设计

- 已以 OpenClaw 官方主线 `041d48eccbc591c8a46b904c31358388cf563ae4` 核对多租户、Gateway 客户端、可信代理认证、设备配对、审计、用量和宿主挂起契约。
- 企业控制面与 Gateway 数据面必须分离：控制面拥有租户、企业身份、成员与角色、Cell 注册表、生命周期操作、准入票据、审计索引和配额策略；每个租户使用独立完整 Gateway Cell，OpenClaw 继续拥有会话、运行、工具、渠道、设备配对和业务审计事实。
- 官方 Fleet 仅是实验性的单机 Docker 或 Podman 生命周期工具，不支持远程宿主、租户自助门户、计费或委派管理。单机验证可通过固定版本 Fleet 适配器完成；生产多机部署需要独立 Cell Controller，通过编排平台管理官方镜像、隔离状态卷、独立认证密钥卷、网络策略和资源限制。
- JunQi 企业登录采用系统浏览器中的 OIDC Authorization Code 与 PKCE。企业会话和刷新凭据只进入系统凭据库；控制面签发的短期 Cell 连接票据只用于企业接入层的 WebSocket Upgrade，不得写入 OpenClaw `connect.token`、URL、日志或前端持久存储。
- 现有 WebView `WebSocket` 无法可靠携带企业授权头。企业模式需要 Rust 原生透明 WebSocket 隧道：上游连接携带短期企业票据，下游只在随机回环端口转发原始帧；OpenClaw v4 握手、设备签名、配对、RPC 和事件语义仍由现有 TypeScript Gateway 客户端处理。
- 企业接入层验证票据和 Cell 授权后，删除客户端提供的转发与身份头，写入可信代理身份、转发地址和最小 `x-openclaw-scopes` 上限，再路由到唯一 Cell。Gateway 使用官方 `trusted-proxy` 模式；该头只限制权限，不授予权限。
- Cell 启用官方 `gateway.roles` 并使用最小默认角色。控制面将企业成员角色同步为 Gateway 命名角色，再通过 `users.setRole` 绑定可信代理创建的持久用户 Profile；角色同时约束他人会话可见性、可用 Agent 和 scope 上限，但不替代租户间 Cell 隔离。
- JunQi 是自定义 WebSocket 客户端，不能使用仅适用于 Control UI 与 WebChat 的自动设备批准。首次连接仍携带官方设备身份并处理精确配对请求；控制面只在请求设备身份、租户、Cell、用户和请求权限全部匹配时，通过每 Cell 管理身份调用官方配对 RPC。启用命名角色后，身份认证的 operator 连接不会取得可复用的非个人绑定设备或 bootstrap token，JunQi 每次连接都必须重新通过企业接入层验证身份。
- 企业角色不等于 OpenClaw scope。普通角色只包含 `operator.read`、`operator.write`、`operator.approvals` 等已确认权限；管理员角色才包含 `operator.admin`。企业接入层再用短期票据和 `x-openclaw-scopes` 对当前连接做进一步收窄，不能借该头扩大 Gateway 角色或设备已经授予的权限。
- 用户被移出租户或设备被吊销时，接入层立即拒绝新连接并关闭对应隧道，控制面同步清除 Gateway 角色绑定，并在存在配对记录时调用官方移除或令牌吊销 RPC 收敛 Cell 状态。仅撤销控制面登录而不处理 Gateway 侧身份与设备状态不构成完整闭环。
- 配额必须在拥有真实执行权的边界强制：连接和请求频率在接入层限制，CPU、内存、进程和存储在 Cell 编排层限制，模型费用通过每租户 Provider 项目额度或统一模型代理限制。官方 `usage.status`、`usage.cost` 与会话用量接口只用于观测，JunQi UI 不能充当硬配额执行器。
- 控制面审计与 Gateway 审计分别保存并关联。控制面记录登录、成员、角色、Cell 生命周期、设备授权、配置和配额变更；Gateway 的 `audit.activity.list` 与 `audit.run.inspect` 保持业务事实权威。关联键只保存 Cell、Gateway 实例、设备、Session、Run 和 revision 等必要引用，不复制密钥、提示词或工具结果。
- 本次仅完成权威契约核对和实现边界设计，尚未创建控制面服务、Cell Controller、Rust 隧道、企业页面、数据库或部署清单，也未执行企业身份、跨租户隔离、故障恢复、配额和目标平台验证。
- 产品决策已收敛到 `docs/adr/0003-defer-enterprise-control-plane-and-complete-single-user-desktop.md`：企业控制面整体延期，当前不新增企业接口、配置开关、占位页面或兼容分支；研发优先完成单用户安装、Gateway、权限、会话、工作台、桌面系统行为和发布质量闭环。
