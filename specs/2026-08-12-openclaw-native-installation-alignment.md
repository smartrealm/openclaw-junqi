# OpenClaw 原生安装对齐目标规格

状态：代码已实现，自动化验证进行中

## 目标

JunQi 首次设置必须按当前所选 OpenClaw Runtime 的正式 RPC 能力呈现配置流程：支持 `openclaw.setup.detect` 时使用 guided inference；明确返回 unknown-method 时使用官方经典 Wizard。JunQi 只负责桌面安装、运行时选择、结构化协议呈现、Gateway 生命周期和可验证完成门禁，不重定义 OpenClaw 安装语义。

## 范围

- Native 与 Docker 本地运行方式的首次安装。
- 已安装 OpenClaw 的首次进入与重复启动。
- guided inference 的检测、认证、准备、激活、验证和 onboarding chat。
- 显式 classic Wizard 与渠道 Wizard。
- npm 安装完整性、Gateway 生命周期、完成门禁和错误恢复。
- macOS、Windows 与 Linux 的契约审查。

Remote Gateway 本轮只保留为未实现的官方能力，不新增猜测性入口。

## 目标状态机

1. JunQi 完成桌面环境检查后进入数据位置页面。读取只填充最终表单，不能推进步骤。
2. 用户明确点击“下一步”后提交 `configure_storage`；只有成功响应可以进入运行时，失败必须留在当前页面。
3. JunQi 检查用户选择的运行时；缺少 OpenClaw 时安装官方最新版包或官方 Docker image。
4. JunQi 断开此前连接并启动所选 Gateway；连接动作重新解析所选 Runtime 的正式目标，不读取历史手动地址，目标解析失败时不能猜测默认端点。只有新连接的 `hello-ok`、连接围栏和 Runtime Identity 核验全部收敛后才继续，并按官方请求需要完成 `operator.admin` 权限核验。
5. 调用 `openclaw.setup.detect` 协商当前 Runtime 的正式配置能力；只有结构化 unknown-method 才切换到官方 `wizard.start/next/status/cancel`。
6. Guided 的 `setupComplete` 为真时，进入正常工作台，不重复 onboarding；Classic 则以当前官方 Wizard 会话的 `done` 作为终态证明。
7. Guided 的 `setupComplete` 为假时，呈现官方候选、不可用候选、认证方式和准备方式；Classic 忠实呈现官方步骤。
8. 需要认证或准备时，分别调用 `openclaw.setup.auth.start` 或 `openclaw.setup.prepare.start`，只投影结构化结果。
9. 自动候选按官方顺序尝试，但必须跳过 `credentials === false` 的候选；已有默认模型候选激活失败后立即停止自动尝试，不得静默替换为其他模型。
10. 自动候选激活成功后，呈现官方“使用当前路径”或“查看其他选项”确认。激活结果已经由 OpenClaw 持久化；用户选择其他选项时在当前有效路径上打开完整选择器，不能伪装成尚未写入。
11. 用户明确选择其他候选或手动凭据时调用 `openclaw.setup.activate`。只有上游返回成功并且 `openclaw.setup.verify` 通过，才能认为推理配置成立。
12. 推理成立后，用独立 session 调用 `openclaw.chat`，首个请求携带 `welcomeVariant: "onboarding"`。
13. JunQi 按官方 reply、action、sensitive 和 agentDraft 呈现对话，不补造步骤或终态。
14. OpenClaw 返回退出或打开智能体动作后，JunQi 通过统一交接门禁复用当前已核验连接；连接失效时才重连。随后绑定同一连接核验所选 Runtime、`setup.detect` 与 `setup.verify`，再进入 Ready。
15. 用户从 Ready 进入工作台时再次核验 Gateway 与当前配置，随后一次性提交本地完成标记并切换页面。

## 明确的高级路径

- 支持 Guided 的 Runtime 中，用户显式选择“详细配置”后启动 Classic Wizard；不支持 Guided 的当前稳定 Runtime 直接使用官方 Classic Wizard。
- 渠道中心继续使用 `wizard.start { flow: "channels", channel }`。
- classic 的 workspace、daemon 和 remote 选择由官方步骤或正式 start 参数拥有。
- 如果用户明确选择不安装 daemon，JunQi 不得强制把官方服务交接作为完成条件；此时必须保持当前前台 Gateway 的真实所有权，并明确后台常驻不可用。
- 如果用户选择安装 daemon，Native 完成条件继续要求系统服务交接成功；服务切换使原连接失效时，必须重新建立并核验认证连接。
- 数据位置读取完成后必须停留在可编辑表单，由用户点击“下一步”确认；提交成功后直接进入运行时阶段，不得自动越过该页面，也不得插入“数据位置已就绪”二次确认页。
- 数据位置读取路径不得调用阶段完成回调；只有用户触发且 `configure_storage` 成功后可以生成 `StorageCompletion`。
- 数据位置提交期间必须保留同一表单和内容标识，只锁定表单并在主操作上呈现真实忙碌状态；不得用客户端自造百分比或独立进度卡替换页面正文。
- 普通步骤的调试日志默认收起。依赖安装在宽窗口同时呈现执行步骤与执行记录，窄窗口才使用二选一切换；失败、等待和步骤变化不得改变用户在窄窗口选择的视图。
- Gateway 连接与运行时身份核验完成后，必须原地更新运行时执行摘要和主操作。`gateway-ready` 只作为内部核验状态存在，不能渲染成独立页面或重复完成卡片。
- 首次设置启动 Gateway 时必须建立新的连接代次；任意旧连接的 connected 状态、同端口可达和历史手动地址均不能作为所选 Runtime 已连接的证据。
- 显式启动命令未返回终态前，进程状态订阅不得触发首次连接；启动成功后只允许一次限定为所选 Runtime 的连接动作。
- 普通设置页的显式 Gateway 地址不属于首次设置目标解析，不能因首次设置收紧而被删除或忽略。

## 安装契约

- npm 安装目标仍使用一次解析得到的确切版本，不在事务中重新解析 latest。
- npm 安装必须包含官方要求的 `--allow-scripts=openclaw`。
- staging prefix 验证除入口文件和 engines 外，还要证明官方安装脚本要求的 bundled plugin 产物完整。
- npm 源 fallback 必须继续满足确切版本和 Node.js 契约一致。
- Native 与 Docker 失败时不得互相静默切换。

## 持久完成语义

- `junqi-setup-done` 只能作为界面缓存，不能作为 OpenClaw 已配置事实。
- 每次冷启动在认证 Gateway 可用后先协商 Guided 能力。支持时调用 `openclaw.setup.detect`；不支持时保留先前由官方 Classic `done` 提交的本地证明，不从健康状态或配置文本重建终态。
- 安装包或 Docker image 缺失仍由桌面安装健康检查提前拦截。
- `openclaw.setup.verify` 用于 fresh activation 的强制完成门禁和用户触发的诊断，不改变上游对已配置 Gateway 的跳过语义。
- 方法未注册、未授权、连接失败和协议解析失败必须分别呈现，不得统一映射为“需要重新配置”。

## 安全与权限

- 所有 `openclaw.setup.*` 和 `openclaw.chat` 请求使用现有 privileged Gateway 通道。
- API key 和 token 只存在于当前受控请求边界，不写入日志、Markdown、测试快照或前端持久存储。
- 认证和准备操作必须支持取消；结果未知时不得自动重放。
- Provider Wizard 通过官方 `wizard.cancel` 取消；onboarding chat 内嵌 Wizard 通过官方 `wizardCancel` 取消。取消失败必须保留在当前操作附近，不能只在组件卸载时静默清理。
- `openclaw.setup.activate` 超时或断线时保持待核验，重新调用前先执行 detect 或 verify。

## UI 契约

- 复用现有 SetupShell、共享状态面板、按钮、输入、错误和日志组件，以及 Aegis 语义 token。
- 默认只展示 guided inference；“详细配置”是次级入口，不与默认主操作并列争夺注意力。
- provider、认证方式、等待、成功、失败、取消、过期和未知状态全部来自结构化响应。
- `unavailableCandidates` 的原因和正式修复入口、`recommendedInstalls` 的安装建议必须按官方检测结果呈现；不存在正式入口时只展示不可用原因。
- setup admission busy 必须按官方 `UNAVAILABLE`、固定错误文案和 `retryable: true` 组合识别；Classic 进入 reclaim，Guided 显示可重试的占用提示。
- 不展示技术占位语句，不在短步骤中强制固定高度或额外滚动条。
- 共享页面骨架可以占满窗口，但步骤卡片和正文切换容器必须按真实内容高度布局；只有日志和官方长选项可以在明确边界内局部滚动。
- 国际化资源不得让同一解析路径同时指向对象与字符串等不同类型；资源加载和测试必须拒绝该冲突，业务组件只读取稳定的字符串叶子。
- 官方步骤正文复用稳定内容槽。用户前进时正文从左向右短距离切换，返回外层阶段时从右向左切换；后台检测、等待、错误和交接状态只淡入，不伪装为用户导航。
- 正文切换只使用 `transform` 与 `opacity`，不移动步骤器、标题、日志或底部操作；系统减少动态效果时立即完成。
- 亮色、暗色、窄窗口、键盘焦点和减少动态效果必须进入验收。

## 验收条件

- 已配置数据位置的读取完成后仍停留在数据位置表单，且不会调用阶段完成回调。
- 用户点击“下一步”并取得 `configure_storage` 成功响应后只推进一次；失败、重复点击和返回竞争不能推进。
- 数据位置提交前后保持同一表单内容标识，不出现独立的客户端进度步骤。
- 普通安装步骤首次呈现时日志均为收起状态；依赖安装在宽窗口按左右栏同时显示步骤和记录，在窄窗口默认显示步骤且只有用户触发后切换到记录。
- Gateway 启动摘要从执行中原地切换到已核验，用户点击核验配置后才进入正式 Guided 或 Classic 配置；中间不得出现第二张运行时就绪页面。
- 首次设置已有旧连接时，启动所选 Runtime 必须先断开旧连接，随后以 `selected-runtime` 目标范围重新解析正式配置；读取失败不能使用历史手工地址或默认端点，只有新连接的 Runtime Identity 已核验时才能进入配置能力协商。
- 端点状态先于启动命令完成到达时不能提前连接；启动失败必须进入统一错误态，启动成功只能产生一次 `selected-runtime` 连接动作。
- 官方 `done` 和其他短步骤不会被通用容器强制撑满窗口，也不会产生空白局部滚动区。
- 英语、简体中文和繁体中文资源均不存在扁平键与嵌套路径的类型冲突；数据位置提交进度读取明确的字符串叶子。
- 新安装默认不会调用 `wizard.start`，而是依次使用正式 setup RPC 和 onboarding chat。
- 自动候选不会尝试 `credentials === false` 的项；已有默认模型候选失败后不会继续激活后续候选。
- 自动候选成功后必须先显示当前已激活路径的使用或改选确认，不能直接进入 onboarding chat。
- 无可用候选时可以看到官方不可用原因、可用认证或手动凭据入口以及推荐安装建议。
- Provider Wizard 和 chat 内嵌 Wizard 都有可访问的显式取消入口，并调用各自的官方取消协议。
- 官方 setup admission busy 可以分别进入 Classic reclaim 和 Guided 可重试错误，不会退化为 unknown。
- 已配置 Gateway 的 `setupComplete: true` 会跳过 onboarding。
- fresh activation 未取得真实 completion 时不能进入工作台。
- npm 12 安装不会阻止 OpenClaw lifecycle script。
- classic no-daemon 与 install-daemon 两种官方选择都能得到真实且不同的生命周期结果。
- Guided 方法明确不受支持时进入同一 Runtime 的官方 Classic Wizard；连接、权限和响应错误不得触发该切换。
- Native、Docker 的选定运行方式和凭据作用域在整个流程中保持不变。
- 相关 TypeScript、Rust、协议、文档和边界测试通过。
