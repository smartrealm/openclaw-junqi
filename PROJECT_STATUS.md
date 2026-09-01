# JunQi 项目状态

更新时间：2026-09-01

## 当前目标

以 OpenClaw 官方 `v2026.8.1` 为当前契约基线，发布包含插件编译、首次设置协议和结构化提问桌面交互对齐的 JunQi Desktop `v3.3.0`。JunQi 只呈现官方能力，不以版本分支、旧方法 fallback、本地状态或硬编码业务数据模拟能力。

## 已完成内容

- 已更新并核对 OpenClaw 官方 tag `v2026.8.1`，目标提交为 `ea806575e6450e4d1efdfc72c19f04be982a1b9b`。
- 协作插件升级到 `0.5.8`，钉钉插件升级到 `0.1.1`；两者以 OpenClaw `2026.8.1` 作为开发、插件 API 和最低 Gateway 基线，并已重建固定归档与生成元数据。
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

## 已知问题与未验证边界

- 尚未使用目标 Gateway 执行结构化普通问题和真实密钥问题的端到端回答；自动化不能证明服务端写入和事件终态已在目标部署中完成。
- 尚未在真实 Tauri 窗口连续验证亮色、暗色、窄窗口、键盘焦点、展开折叠、多个请求切换和输入法交互。
- 尚未运行固定 digest 的真实 Gateway 容器结构验证，也未执行 Windows、Linux 和移动端目标平台验证。
- 本次没有 Rust 源码改动，因此未运行 Rust 测试。
- `session-transcript-runtime` 的正式 JavaScript subpath 存在，但 `2026.8.1` 发布包排除了入口声明文件；当前只补充了所用官方 helper 的精确类型声明，等待上游发布完整声明后应删除该本地声明。
- 未跟踪的 `.easycode/`、`.pnpm-store/`、`dogfood-output/` 和 `outputs/` 属于既有工作区内容，本次未修改、删除或纳入变更。

## 失败方案与已删除路径

- 删除密钥回答的临时管理员连接，因为官方契约明确回答只需要正常问题 scope；保留会造成多余授权和重复 Gateway 生命周期。
- 删除 `crestodian.setup.*`、Wizard 降参重试和旧激活证据交接，不为旧版本保留双轨。
- 删除活动审计的旧账本 fallback，不用旧事件结构冒充当前活动账本。
- 会话搜索继续使用现有正式 `sessions.search` RPC；不为小组件、云工作器、实验 Fleet 或 Swarm 创建无正式桌面契约的入口。
- 不把 `hello-ok.features.methods` 缺失、超时、空结果或版本号解释为能力不存在。

## 下一步顺序

1. 提交并推送 `v3.3.0` 发布源到远端 `main`。
2. 创建并推送准确指向发布源提交的带注释标签 `v3.3.0`。
3. 核对同一提交的主线 CI、标签工作流、GitHub Release 和附件清单。
4. 在目标 Tauri 客户端继续验证结构化问题、亮暗主题、窄窗口、键盘焦点和中文输入法。
