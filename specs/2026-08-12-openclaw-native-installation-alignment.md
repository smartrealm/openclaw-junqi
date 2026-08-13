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

1. JunQi 完成桌面环境和用户选择的运行时检查。
2. 缺少 OpenClaw 时，安装官方最新版包或官方 Docker image。
3. JunQi 启动或连接所选 Gateway，并完成身份与 `operator.admin` 权限核验。
4. 调用 `openclaw.setup.detect` 协商当前 Runtime 的正式配置能力；只有结构化 unknown-method 才切换到官方 `wizard.start/next/status/cancel`。
5. Guided 的 `setupComplete` 为真时，进入正常工作台，不重复 onboarding；Classic 则以当前官方 Wizard 会话的 `done` 作为终态证明。
6. Guided 的 `setupComplete` 为假时，呈现官方候选、不可用候选、认证方式和准备方式；Classic 忠实呈现官方步骤。
7. 需要认证或准备时，分别调用 `openclaw.setup.auth.start` 或 `openclaw.setup.prepare.start`，只投影结构化结果。
8. 用户确认候选后调用 `openclaw.setup.activate`。只有上游返回成功并且 `openclaw.setup.verify` 通过，才能认为推理配置成立。
9. 推理成立后，用独立 session 调用 `openclaw.chat`，首个请求携带 `welcomeVariant: "onboarding"`。
10. JunQi 按官方 reply、action、sensitive 和 agentDraft 呈现对话，不补造步骤或终态。
11. OpenClaw 返回退出或打开智能体动作后，JunQi 通过统一交接门禁复用当前已核验连接；连接失效时才重连。随后绑定同一连接核验所选 Runtime、`setup.detect` 与 `setup.verify`，再进入 Ready。
12. 用户从 Ready 进入工作台时再次核验 Gateway 与当前配置，随后一次性提交本地完成标记并切换页面。

## 明确的高级路径

- 支持 Guided 的 Runtime 中，用户显式选择“详细配置”后启动 Classic Wizard；不支持 Guided 的当前稳定 Runtime 直接使用官方 Classic Wizard。
- 渠道中心继续使用 `wizard.start { flow: "channels", channel }`。
- classic 的 workspace、daemon 和 remote 选择由官方步骤或正式 start 参数拥有。
- 如果用户明确选择不安装 daemon，JunQi 不得强制把官方服务交接作为完成条件；此时必须保持当前前台 Gateway 的真实所有权，并明确后台常驻不可用。
- 如果用户选择安装 daemon，Native 完成条件继续要求系统服务交接成功；服务切换使原连接失效时，必须重新建立并核验认证连接。
- 已有数据位置且没有待提交草稿时，读取完成后直接进入运行时阶段；不得插入只用于重复确认的“数据位置已就绪”页面。

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
- `openclaw.setup.activate` 超时或断线时保持待核验，重新调用前先执行 detect 或 verify。

## UI 契约

- 复用现有 SetupShell、共享状态面板、按钮、输入、错误和日志组件，以及 Aegis 语义 token。
- 默认只展示 guided inference；“详细配置”是次级入口，不与默认主操作并列争夺注意力。
- provider、认证方式、等待、成功、失败、取消、过期和未知状态全部来自结构化响应。
- 不展示技术占位语句，不在短步骤中强制固定高度或额外滚动条。
- 官方步骤正文复用稳定内容槽。用户前进时正文从左向右短距离切换，返回外层阶段时从右向左切换；后台检测、等待、错误和交接状态只淡入，不伪装为用户导航。
- 正文切换只使用 `transform` 与 `opacity`，不移动步骤器、标题、日志或底部操作；系统减少动态效果时立即完成。
- 亮色、暗色、窄窗口、键盘焦点和减少动态效果必须进入验收。

## 验收条件

- 新安装默认不会调用 `wizard.start`，而是依次使用正式 setup RPC 和 onboarding chat。
- 已配置 Gateway 的 `setupComplete: true` 会跳过 onboarding。
- fresh activation 未取得真实 completion 时不能进入工作台。
- npm 12 安装不会阻止 OpenClaw lifecycle script。
- classic no-daemon 与 install-daemon 两种官方选择都能得到真实且不同的生命周期结果。
- Guided 方法明确不受支持时进入同一 Runtime 的官方 Classic Wizard；连接、权限和响应错误不得触发该切换。
- Native、Docker 的选定运行方式和凭据作用域在整个流程中保持不变。
- 相关 TypeScript、Rust、协议、文档和边界测试通过。
