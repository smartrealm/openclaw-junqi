# JunQi 项目状态

更新时间：2026-09-01

## 当前目标

以 OpenClaw 官方 `v2026.8.1` 为当前契约基线，完成 JunQi Desktop `v3.3.1` 不可变标签和 GitHub Release 发布。后续进入目标设备安装、升级和真实 Gateway 交互验收；JunQi 继续只呈现官方能力，不以版本分支、旧方法 fallback、本地状态或硬编码业务数据模拟能力。

## 已完成内容

- 已更新并核对 OpenClaw 官方 tag `v2026.8.1`，目标提交为 `ea806575e6450e4d1efdfc72c19f04be982a1b9b`。
- 协作插件升级到 `0.5.9`，钉钉插件保持 `0.1.1`；两者以 OpenClaw `2026.8.1` 作为开发、插件 API 和最低 Gateway 基线，并已重建固定归档与生成元数据。
- 协作插件已适配 2.0 SDK 类型变化和 Agent wait 的 `pending` 状态；助手镜像继续调用官方 transcript helper，没有复制 transcript 写入逻辑。
- 首次设置只调用最新版 `openclaw.setup.*` 与官方 Classic Wizard；已删除 `crestodian.setup.*` 方法族、`installDaemon` 降参重试、旧激活结果交接和对应过时文档。
- 活动审计只调用正式 `audit.activity.list`；已删除旧 `audit.list` 回退、旧来源投影、提示文案和专属测试。
- 主 Gateway 连接按官方客户端指南增加 `operator.questions`，并统一承载 `question.list`、`question.get`、`question.resolve`、`question.requested` 和 `question.resolved`；没有创建第二条问题连接或独立生命周期。
- 密钥问题的回答只使用 `operator.questions`。只有 Gateway 侧创建密钥请求需要管理员权限和可信 Agent 运行身份，桌面回答不再触发 `operator.admin` 授权。
- 主会话和 Quick Chat 均接入结构化问题卡，支持一至三个步骤、单选、多选、自定义答案、跳过、超时刷新、多个请求切换、键盘导航和输入法组合保护。
- 问题卡展开时替换输入框，折叠后恢复输入框；多个待答请求切换时保留各自组件局部草稿，密钥值不进入 Zustand、日志、消息或持久化。
- 问题回答失败按请求标识隔离，切换其他待答请求时不显示无关错误。
- 问题卡复用共享 `Button`、`IconButton`、`LoadingIndicator`，并使用 `aegis-card`、`aegis-surface`、`aegis-border`、`aegis-text`、`aegis-primary` 和状态色等现有主题 token。
- Quick Chat 的 Enter 发送增加输入法组合态保护，避免中文候选确认被误提交。
- 官方真实 Gateway 结构验证基线更新为 `ghcr.io/openclaw/openclaw:2026.8.1@sha256:e7849cb6c1ef1ead39ab4be7d85edb2df89611f486e283284c7cf35ce39a20d4`。
- OpenClaw 版本与不可变 Gateway 镜像只保存在协作插件构建元数据中；插件校验器、真实 Gateway 验证器及其测试均读取该来源，不再复制版本或摘要。
- `v3.3.0` 已准确指向提交 `804809227cb51ce68cbafecc811ee580288e2d28`，但主线 CI 运行 `33471619664` 发现 OpenClaw 正式包缺少 transcript 子路径入口声明，标签发布运行 `33471629203` 已停止且没有创建失败 Release。
- transcript 补充声明已从依赖既有类型的模块增强改为独立正式模块声明，覆盖当前使用的两个官方函数及其精确参数和结果类型；协作包 TypeScript 配置明确纳入声明文件，插件版本随新归档升级到 `0.5.9`。
- 发布源提交 `a5cbe79435d1f37b5ea825903b2eeacd33d13f06` 的主线 CI `33472625972` 已通过。
- 远端带注释标签 `v3.3.1` 解引用后精确指向发布源提交；标签发布工作流 `33472911707` 已通过。
- GitHub Release `JunQi Desktop 3.3.1` 已发布：<https://github.com/smartrealm/openclaw-junqi/releases/tag/v3.3.1>。Release 不是草稿或预发布版本，共包含 11 个已上传附件及其 GitHub SHA-256 摘要。
- `v3.3.0` 保持不可变失败标签且没有 GitHub Release，没有删除、覆盖或移动。

## 关键技术决策

- OpenClaw 方法名、事件名、scope、schema 上限和固定包版本属于集中管理的正式协议或构建元数据；业务文案、状态、路径、平台、模型、目标环境和能力判断不得散落硬编码。
- 版本只用于固定插件编译与真实验证制品，不作为运行时能力开关。客户端按官方请求契约调用，再依据结构化响应判断成功、拒绝或不支持。
- 能处理交互问题的桌面客户端必须在主连接申请 `operator.questions`；事件、恢复列表和回答共用主连接，避免并行 socket、重复配对和第二套重试状态机。
- 密钥值只存在于输入组件和当次 `question.resolve` 参数。前端不得缓存、记录、回显或写入 transcript。
- 展开问题时由问题卡占用唯一主输入位置；折叠仅作为用户显式恢复普通输入的紧凑入口。
- 2.0 配置和模型路由迁移继续由官方 Doctor 拥有，JunQi 不自行扫描或改写用户配置。

## 核心文件

- `src/services/gateway/OpenClawQuestionClient.ts`
- `src/services/gateway/questionEventBridge.ts`
- `src/services/gateway/GatewayConnectionPolicy.ts`
- `src/services/gateway/index.ts`
- `src/stores/openclawQuestionsStore.ts`
- `src/components/Chat/ChatQuestionDock.tsx`
- `src/components/Chat/openClawQuestionAnswers.ts`
- `src/pages/ChatView.tsx`
- `src/pages/QuickChatPage.tsx`
- `src/services/gateway/OpenClawGuidedSetupClient.ts`
- `src/services/openclawWizard.ts`
- `src/services/setup/openClawSetupHandoff.ts`
- `packages/junqi-collab/`
- `packages/junqi-collab/src/openclaw-session-transcript-runtime.d.ts`
- `docs/quality/tag-release-validation-2026-09-01-v3.3.1.md`
- `packages/junqi-dingtalk/`
- `docs/quality/openclaw-2026-8-1-desktop-compatibility-audit-2026-09-01.md`
- `specs/2026-09-01-openclaw-2026-8-1-desktop-compatibility.md`
- `plans/2026-09-01-openclaw-2026-8-1-desktop-compatibility.md`

## 测试与验证

- `pnpm lint` 通过，模块边界、桌面版本一致性和 TypeScript 检查通过。
- `pnpm test` 通过，前端测试 2968 项、脚本测试 238 项。
- 协作插件完整测试通过。
- 钉钉插件完整测试通过，共 23 项。
- `pnpm verify:openclaw-docs` 通过。
- `pnpm build` 通过，协作与钉钉插件契约校验、固定包重建、TypeScript 和 Vite 生产构建完成。
- 结构化问题定向回归覆盖协议解析、主连接 scope、事件路由、重叠刷新、提交、跳过、请求错误隔离、密钥不进入全局状态和输入法组合保护。
- `git diff --check` 通过。
- 远端主线 CI `33472625972` 通过，包含干净依赖安装后的生产构建、桌面与协作测试、Rust 格式、Clippy、检查和库测试。
- 远端标签工作流 `33472911707` 通过，macOS ARM64、macOS x64、Windows x64 构建、签名校验、updater 清单生成和 GitHub Release 创建均成功。
- GitHub Release 查询确认 `v3.3.1` 于 `2026-09-01T05:42:46Z` 发布，11 个附件全部为 `uploaded` 状态。

## 已知问题与未验证边界

- 尚未使用目标 Gateway 执行结构化普通问题和真实密钥问题的端到端回答；自动化不能证明服务端写入和事件终态已在目标部署中完成。
- 尚未在真实 Tauri 窗口连续验证亮色、暗色、窄窗口、键盘焦点、展开折叠、多个请求切换和输入法交互。
- 尚未运行固定 digest 的真实 Gateway 容器结构验证，也未执行 Linux 和移动端目标平台验证。
- 尚未在 macOS 与 Windows 目标设备执行真实安装、升级、系统信任、权限、凭据库、输入法和 Gateway 端到端验证。
- macOS 制品使用工作流临时签名身份，不代表 Apple Developer ID 签名或公证完成；Windows 制品使用内部测试证书，不具备公共证书颁发机构信任。
- 本次没有 Rust 源码改动；远端主线 CI 已执行并通过 Rust 格式、Clippy、检查和库测试。
- `session-transcript-runtime` 的正式 JavaScript subpath 存在，但 `2026.8.1` 发布包排除了入口声明文件；当前只补充所用官方 helper 的精确类型声明，等待上游正式包包含入口声明后删除该本地声明。
- 未跟踪的 `.easycode/`、`.pnpm-store/`、`dogfood-output/` 和 `outputs/` 属于既有工作区内容，本次未修改、删除或纳入变更。

## 失败方案与已删除路径

- 删除密钥回答的临时管理员连接，因为官方契约明确回答只需要正常问题 scope；保留会造成多余授权和重复 Gateway 生命周期。
- 删除 `crestodian.setup.*`、Wizard 降参重试和旧激活证据交接，不为旧版本保留双轨。
- 删除活动审计的旧账本 fallback，不用旧事件结构冒充当前活动账本。
- 会话搜索继续使用现有正式 `sessions.search` RPC；不为小组件、云工作器、实验 Fleet 或 Swarm 创建无正式桌面契约的入口。
- 不把 `hello-ok.features.methods` 缺失、超时、空结果或版本号解释为能力不存在。

## 下一步顺序

1. 在 macOS ARM64 与 x64 目标设备验证 DMG 安装、首次启动、升级、窗口生命周期、系统信任和凭据库行为。
2. 在 Windows x64 受控内部测试设备导入发布附带证书后，验证 NSIS 安装、升级、UAC、计划任务、凭据库和卸载行为。
3. 使用目标 OpenClaw Gateway 验证结构化普通问题、真实密钥问题、授权、事件终态和断线恢复。
4. 在目标 Tauri 客户端继续验证亮暗主题、窄窗口、键盘焦点、中文输入法和连续异步状态流转。
5. Linux 和移动端没有本次正式发布制品，保持未验证状态，待存在明确发布范围后单独验收。
