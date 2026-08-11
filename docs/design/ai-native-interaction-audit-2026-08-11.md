# AI 原生交互全量审查

## 目标与范围

本次审查以当前 `Blues-Code/Jarvis` 合并 `main` 后的源码为基线，目标不是复制外部示例的
演示组件，而是在不改变 OpenClaw 权威语义的前提下，统一 JunQi Desktop 的交互节奏、信息层级和
视觉反馈。

审查覆盖路由入口、应用外壳、主题 token、共享组件、会话、安装向导、渠道、任务与审批、文件预览、
终端、Jarvis 语音和业务工作台。审查时保留现有未提交的会话交互视觉收敛改动，未将它们视为已提交
结论。

## 已核对的事实

- 路由树在 `src/AppRouteTree.tsx` 中包含 31 个桌面页面入口，页面源码约 4.1 万行；体验不能靠
  单个聊天页的局部样式代表全局质量。
- Aegis 已有语义颜色、字号、圆角、控制尺寸和四档动效 token，`framer-motion`、Radix Dialog、
  Popover、Dropdown 和现有共享加载器均已安装；当前不需要增加动效或 UI 库。
- 会话输入、消息、工具调用、会话轨迹、任务账本、审批、渠道账户、首次安装和文件预览均已接入
  Gateway 或 Tauri 的真实状态。界面优化只能投影这些状态，不能制作本地成功、假任务、假推荐、
  假来源或假工具结果。
- `SceneTransition`、`TabMotion`、`SetupStepTransition` 和动态岛已经读取系统减少动态效果偏好；
  但仓库内有 195 个包含动画或过渡的生产文件，CSS 的全局减少动态效果覆盖仅在少数局部区域出现，
  不能假定所有动效已经被统一约束。
- 生产源码中有 196 个包含颜色、渐变或直接 RGB 写法的文件。该统计是审查信号，不等同于全部错误；
  主题定义、图表、PDF 和终端配色可有正当用途，但普通业务组件必须逐项收敛到现有语义 token。

## 示例交互与真实场景映射

| 参考交互 | 可落地场景 | 数据与行为边界 |
| --- | --- | --- |
| 像素加载、经过时间 | Gateway、文件预览、PDF、安装长操作 | 只显示真实开始时间、进度和取消能力；不可伪造阶段或百分比。 |
| 可展开思考轨迹 | 工具调用、响应轨迹、任务详情 | 只展示 OpenClaw 已投影的工具、审计和结构化轨迹；不展示或生成隐藏推理。 |
| 流式文字与来源芯片 | 助手流式回复、文件和来源引用 | 文本来自 transcript，来源必须有可验证 URL、文件或消息引用。 |
| 人工确认卡 | 原生审批 | 按 Gateway 返回的允许决策绘制；不可本地增加“总是允许”等选项。 |
| 工具摘要行和展开明细 | `ToolCallBubble`、响应轨迹 | 输入、输出、错误、截断和时长必须为真实投影。 |
| 任务行、状态和重试 | 原生 Task Ledger | 只用 Gateway 状态和已有 cancel、delivery retry、dismiss 语义。 |
| 输入框、提及、附件、语音 | 会话 Composer | 复用当前附件、技能、语音和发送 hook；不新增未验证的模型或数据源菜单。 |
| 建议、候选方案、上下文卡片 | 仅限 OpenClaw 已返回的结构化决策、文件和会话产物 | 无上游字段时保持不可用，不创建本地推荐、RAG 上下文或审批协议。 |
| 表格筛选和记录表 | 渠道、配置、业务工作台、分析 | 只过滤已有官方或 DWS 投影数据，不建立平行业务模型。 |

## 问题分级

### P0：先守住真实状态和交互完整性

1. 会话页同时存在 Composer、`PromptEditor`、终端 `PaneComposerBar` 等输入实现。它们分别拥有
   不同的快捷键、焦点、动态和样式策略，且部分旧实现仍带有来源于演示或旧产品的命名。应先建立
   可复用的输入交互约束，保留各自的真实发送边界，不能强行合并不同 runtime 的发送逻辑。
2. 多个长操作各自使用 spinner、文本、按钮禁用、局部动画或自定义样式。安装、Gateway、文件预览、
   渠道和任务必须共享同一组“等待、可取消、已完成、失败、待验证”的视觉状态；状态内容仍由各自
   官方或 Tauri 契约提供。
3. 聊天主视图中仍有 `CompactDivider` 的渐变与无限 shimmer，和 Aegis 的克制桌面语言及减少动态
   效果策略不一致。它必须改成无障碍、无干扰的会话分隔表达，不能影响虚拟列表稳定性。

### P1：统一信息层级和细腻交互

1. 真实的工具调用、响应轨迹、Task Ledger 和审批已经具备可展开的内容，却使用了不同的标题、状态
   徽标、详情分隔和 hover 语法。应以“摘要行、状态、可展开详情、操作区”四层统一，而不改变数据模型。
2. 安装向导的步骤器、状态卡、日志和底部操作已经具备正确的步骤语义；应统一页面切换时的空间稳定性、
   内容高度和按钮反馈，避免重复的“已就绪”展示及横向滚动。
3. 渠道中心具有真实的 catalog、账号、运行证据和二维码流程，但列表、详情、账号操作的密度和层级
   仍偏配置表单式。可以引入清晰的摘要与展开关系，不能隐藏未核验状态或把插件安装表示成已连接。
4. 文件预览的文本、Markdown、PDF、图片和二进制分支已统一入口，但预览容器对亮暗主题、加载过渡、
   操作锚点和窄窗口的处理不完全一致。HTML iframe 的白色背景是安全预览边界，不能为主题统一而改变。

### P2：收敛全局视觉债务

1. 应用外壳、侧边栏、聊天标签、安装流和终端仍有零散渐变、硬编码颜色、内联样式和独立 transition。
   其中主题预览、图表和终端渲染属于例外；普通控件应迁回 Aegis token 与共享 motion token。
2. `AppLayout`、终端及若干页面保留历史英文注释和“conceptual”“kooky”等命名痕迹。仅在对应文件被
   本轮重构时翻译直接相关注释，并删除无真实消费者的旧实现；不做无关语言大扫除。
3. 共享 UI 基础层已有 Button、Dialog、Dropdown、LoadingIndicator、SceneTransition 和 TabMotion，
   但使用不一致。先补足这些组件能表达的当前状态，再替换页面重复的视觉壳；不新建通用抽象来覆盖
   尚未确认的场景。

## 当前未验证边界

- 本次完成的是源码、契约、静态结构和既有测试审查，未在 macOS、Windows、Linux 分别进行完整视觉
  回归；跨平台字体、滚动条、窗口尺寸和系统减少动态效果需要每一批实现后实际验收。
- 未以本地状态推断任何 OpenClaw 运行结果。官方能力是否存在仍需每项具体改动前按对应 Gateway
  handler、协议和当前可复现实验再核对。
- 未把用户提供的外部示例代码复制进生产代码；后续只使用其信息层级、展开语法和微交互原则。

## 实施进度

- 已完成会话主路径首轮收敛：Composer、消息表面、工具调用、上游思考内容、响应轨迹与侧栏对话框
  统一为可聚焦的摘要和详情交互；上下文压缩分隔已移除无限渐变动效。
- 已完成安装进度面板首轮收敛：状态色改为 Aegis 语义 token，安装进度不再使用渐变或硬编码错误色，
  自动滚动与脉冲遵循系统减少动态效果。
- 已完成公共视觉基线收敛：默认卡片、浮层和菜单阴影降低为轻层级，常用圆角与过渡时长收紧；颜色过渡
  只施加于可交互控件，避免路由和数据刷新时整页表面迟滞。已删除无消费者的流光边框与思考微光样式，
  不再保留仅用于旧展示效果的全局动画路径。
- 应用外壳与导航侧栏已移除背景渐变和无消费者的环境光节点，统一为单一 Aegis surface；窗口结构在
  主题切换、宽度动画和路由切换时不再叠加装饰层。
- 渠道中心、Task Ledger、审批、文件预览、Jarvis、终端和业务工作台仍按计划逐批处理；未经真机
  验收的视觉结果不视为跨平台完成。

## 审查依据

- `src/AppRouteTree.tsx`
- `src/components/Layout/AppLayout.tsx`
- `src/styles/primitives.css`、`src/styles/index.css` 与 Aegis 主题文件
- `src/pages/ChatPage.tsx`、`src/pages/ChatView.tsx`、`src/components/Chat/`
- `src/pages/SetupPage/`、`src/components/setup/SetupFlowPanels.tsx`、`src/motion/setupStepTransition.tsx`
- `src/pages/ChannelsCenter/`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`、`src/components/Activity/OpenClawApprovalsPanel.tsx`
- `src/components/FileExplorer/FilePreviewSurface.tsx`
- `src/pages/TerminalPage/`、`src/components/Terminal/`
- `src/components/Chat/JarvisVoiceOverlay.tsx`、`src/components/settings/JarvisVoiceSettingsPanel.tsx`
- `src/pages/BusinessApplicationsPage.tsx`
