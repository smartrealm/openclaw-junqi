# JunQi Desktop 会话功能与 UI 分析

## 概述

JunQi Desktop 是基于 Tauri 2、React 18、TypeScript 和 OpenClaw Gateway 的跨平台桌面 AI 工作台。本文档详细记录会话管理系统的所有功能和 UI 组件。

## 证据边界

本文是基于 `Blues-Code/code` 分支共同祖先 `c61e6075` 的历史分析快照，不是当前分支的行为契约，也不是
OpenClaw 官方能力清单。文中的组件、数量、超时、状态、入口和交互描述没有在本次合并前逐项按当前源码、测试
和最新版 OpenClaw 官方文档重新核验；它们只能作为后续核对线索，不能直接作为实现、UI 入口或可用性承诺。

当前分支在该快照之后已经收敛会话上下文工具栏，并调整了主会话标签关闭和助手头像视觉层次。因此，阅读本文时
应以当前源码、`PROJECT_STATUS.md` 及对应质量文档为准。

---

## 一、会话标签栏（ChatTabs）

### 核心交互功能

- **多标签浏览器风格**：类似浏览器的标签页界面，支持同时打开多个会话
- **拖放排序**：使用 @dnd-kit 实现标签拖动重排序
  - 激活距离：5px
  - 触摸延迟：200ms
- **双击重命名**：双击标签可内联编辑会话名称
- **中键关闭**：鼠标中键点击标签即可关闭会话
- **右键菜单**：提供重命名、关闭、关闭其他标签等操作

### 会话类型区分

- **主会话（Main Session）**
  - 图标：Shield 盾牌
  - 特性：关联 agent 的持久会话
- **桌面会话（Desktop Session）**
  - 图标：FilePlus 文件
  - 特性：临时沙盒会话

### 状态指示器

**连接状态点**：
- 绿色：运行中/已连接
- 黄色：连接中
- 红色：错误/离线

**其他指示器**：
- 未读消息徽章：显示未读消息数量
- 会话目标（Goal）：显示 Crosshair 图标及目标状态

### Agent 状态悬停卡片（AgentStatusTooltip）

悬停在标签上时显示详细信息：
- Agent 名称和当前模型
- 连接状态（Active/Offline）
- 压缩次数（Compactions）
- 会话时长（Session Age）
- 上下文使用率进度条
- 压缩阈值
- 心跳间隔
- Agent Runtime ID
- 思维级别（Thinking level）

---

## 二、新建会话选择器（NewSessionPicker）

### 创建会话流程

1. **选择 Agent**：下拉菜单选择目标 agent
2. **Persona 预设**：显示技能页面传入或 agent 默认的 persona 芯片
3. **会话类型选择**：
   - 打开主会话
   - 创建新的桌面会话
4. **现有会话列表**：显示已存在但未打开的会话（按 agent 过滤）
5. **内联操作**：可直接重命名或删除未打开的会话

---

## 三、会话上下文栏（SessionContextBar）

位于聊天界面顶部的工具栏，分为左右两个功能区。

### 左侧信息区

- **Agent 名称**：大写显示当前 agent
- **工作区选择器（WorkspacePicker）**
  - 显示当前工作区文件夹名称
  - 下拉搜索最近使用的工作区
  - 支持选择新文件夹作为工作区
  - 持久化到 localStorage
- **运行时控制**（SessionRuntimeControl）
- **状态提示**
  - 压缩进行中（旋转动画）
  - Agent 状态消息
  - 上下文预算警告（compact/trim-tools/compact-and-trim-tools）
  - 会话目标显示
  - 最后运行错误
  - 中止标记

### 右侧工具区

> 当前工具清单以 `SessionContextBar` 的实际消费者为准。旧制品下载器、全局技能计数、全局工具配置、
> 全局活动、会话变更、会话文件和会话伴侣入口均已移除。

按钮从左到右：
- **有效工具控制**（EffectiveToolsControl）
- **浏览器控制中心**（BrowserControlCenter）
- **会话分支控制**（SessionBranchesControl）
- **会话检查控制**（SessionInspectionControl）
- **会话产物控制**（SessionArtifactsControl）
- **上下文使用率**：显示 `${usedK}K/${maxLabel}` 格式的 token 使用
- **导出 Markdown**：导出会话内容
- **刷新按钮**：触发 `aegis:refresh` 事件

---

## 四、消息输入区（MessageInput）

### 输入界面组件

- **ComposerInputSurface**：主输入框
- **ComposerAttachmentTray**：附件托盘显示
- **ComposerVoiceRecorder**：语音录制界面
- **MessageQueuePanel**：消息队列面板

### 输入功能

- 文本输入与发送
- Steer 模式（引导式输入）
- 停止/中断功能
- 语音录制与发送
- 附件管理（预览、移除）
- 建议补全（Suggestions）
- 菜单快捷操作

### 状态控制

- 连接状态检测
- 历史加载等待（shouldWarmUpHistoryBeforeFirstSend）
- 发送中状态（isSending）
- 输入中状态（isTyping）
- 语音输出激活状态（voiceOutputActive）
- 待发消息计数（pendingCount）

---

## 五、附件系统（AttachmentBar）

位于聊天视图上方的附件条，显示：

- **附件芯片**：显示文件名（最大 260px 宽度截断）
- **移除按钮**：每个附件的 × 按钮
- **清空所有**：一键清空所有附件
- **附件计数**：显示附件数量
- 完整路径通过 title 属性显示

### 拖放集成

支持拖放文件到应用：
- 通过 `aegis:files-dropped` 自定义事件协调
- App.tsx 设置 pendingFiles + 派发事件
- ChatPage 监听事件并将文件附加到当前会话
- 使用稳定的 EMPTY_ATTACH 空数组引用避免 React #185 问题

---

## 六、聊天视图（ChatView）

### 消息呈现

**虚拟滚动**：
- 使用 Virtuoso 实现高性能消息列表
- 历史记录限制：500 条
- 历史请求超时：12 秒
- 后台重试基础间隔：30 秒（最大 120 秒）
- 启动重试基础间隔：3 秒（最大 12 秒）

**消息类型**：
- **MessageBubble**：用户消息（右侧蓝色）、助手消息（左侧灰色）
- **ToolCallBubble**：显示工具执行状态
- **ThinkingBubble**：显示推理过程
- **TypingIndicator**：实时打字动画
- **ResultCard**：
  - DecisionCard：结构化决策
  - ExecutionPlanCard：执行计划
  - FileResultCard：文件输出
  - SessionEventCard：会话事件
  - WorkshopEventCard：工作坊事件

**Fallback 组件**：
每种消息类型都有对应的 Fallback 组件，在 Suspense 加载期间显示简化版本：
- MessageBubbleFallback
- ToolCallFallback
- ThinkingFallback
- ResultCardFallback

### 交互功能

- **QuickReplyBar**：快速回复栏
- **InlineButtonBar**：内联按钮栏
- **ChatMessagePreviewPanel**：消息预览面板
- **ChatResponseTracePanel**：响应追踪面板
- **ChatTraceSourceMessagePanel**：追踪源消息面板
- **TaskExecutionRecoveryBanner**：任务执行恢复横幅
- **SessionCompanionPanel**：会话伴侣面板

### 协作功能

- **CollaborationChatProvider**：协作上下文提供者
- **CollaborationRunAnchor**：运行锚点
- **CollaborationSessionDock**：会话停靠栏
- **CollaborationUnanchoredBanner**：未锚定横幅
- **buildCollaborationChatTimeline**：时间线构建函数

---

## 七、会话状态管理（chatStore）

### 核心状态

```typescript
interface ChatStore {
  sessions: Session[];
  openTabs: string[];
  activeSessionKey: string;
  messagesPerSession: Record<string, ChatMessage[]>;
  drafts: Record<string, string>;
  draftAttachments: Record<string, string[]>;
  messageQueue: Record<string, QueuedMessage[]>;
  sendingBySession: Record<string, boolean>;
  loadingHistoryBySession: Record<string, boolean>;
  tokenUsage: TokenUsage;
  compactionStatusBySession: Record<string, CompactionStatus>;
  // ... 更多状态
}
```

### 会话属性

```typescript
interface Session {
  key: string;                      // 会话唯一标识
  sessionId?: string;               // OpenClaw 会话 ID
  agentId?: string;                 // 关联的 agent
  label?: string;                   // 用户自定义标签
  topic?: string;                   // 自动生成的会话主题
  unread?: number;                  // 未读消息数
  hasPendingCompletion?: boolean;   // 待完成标记
  agentStatus?: string;             // agent 状态消息
  contextBudgetStatus?: string;     // 上下文预算状态
  goal?: SessionGoal;               // 会话目标
  lastRunError?: string;            // 最后运行错误
  abortedLastRun?: boolean;         // 中止标记
  // ... 更多属性
}
```

### 自动主题生成

**deriveSessionTopic** 函数从用户消息中提取有意义的主题：

1. 移除 `[OPENCLAW_DESKTOP_CONTEXT]` 块
2. 移除代码块
3. 移除 Markdown 图片和链接语法
4. 移除 Markdown 格式符号
5. 提取第一行或第一句话
6. 限制长度为 40 字符

**弱主题检测**（isWeakSessionTopic）：
过滤以下模式：
- 时间戳格式（如 "10:30 AM"）
- "agent:"、"session:" 前缀
- "new chat"、"untitled"
- UUID 格式
- "desktop-" 前缀

### 消息队列

- 最大队列大小：`MAX_SESSION_MESSAGE_QUEUE_SIZE`
- 最大队列字节数：`MAX_SESSION_MESSAGE_QUEUE_BYTES`
- 队列满时阻止新消息入队

### 会话身份转换

- **collectSessionIdentityTransitions**：收集会话身份变化
- **publishSessionIdentityTransitions**：发布身份转换事件

### 持久化

- 标签页状态持久化到 localStorage
- 工作区选择器的最近目录列表持久化
- 会话组织（sessionOrganization）持久化主题

---

## 八、技术架构

### 前端技术栈

- **React 18**：UI 框架
- **TypeScript**：类型安全
- **Zustand**：状态管理（chatStore, gatewayDataStore）
- **@dnd-kit**：拖放功能
- **Virtuoso**：虚拟滚动列表
- **i18next**：国际化
- **Lucide React**：图标库

### 后端集成

- **Tauri 2**：桌面应用框架
- **Rust**：后端逻辑和系统集成
- **OpenClaw Gateway**：AI agent 后端服务

### 关键模式

- **Lazy Loading**：使用 React.lazy 和 Suspense 延迟加载组件
- **Fallback Components**：为每个异步组件提供加载态
- **Custom Events**：通过自定义事件协调跨组件通信（如 `aegis:files-dropped`, `aegis:refresh`）
- **Stable Empty References**：使用常量空数组避免不必要的重渲染（React #185）
- **Agent-Scoped Sessions**：通过 URL 参数 `?agent=<id>&new=1` 创建特定 agent 的会话

---

## 九、会话生命周期

### 创建

1. 用户通过 NewSessionPicker 选择 agent 和会话类型
2. 或通过 URL 参数 `?agent=<id>&new=1` 创建 agent-scoped session
3. 生成会话 key 格式：`agent:<agentId>:<sessionType>`

### 激活

- 点击标签页切换活跃会话
- `activeSessionKey` 更新
- 对应的消息、草稿、附件加载

### 主题生成

- 用户发送第一条消息时触发
- 从消息内容中提取主题
- 过滤弱主题模式
- 持久化到 sessionOrganization

### 关闭

- 中键点击或右键菜单关闭
- 从 openTabs 中移除
- 会话数据保留在 sessions 中（可重新打开）

### 删除

- 右键菜单彻底删除会话
- 清理相关消息、草稿、附件
- 从 sessions 和 openTabs 中移除

---

## 十、OpenClaw 集成点

### RPC 调用

- **会话历史加载**：通过 Gateway 获取历史消息
- **消息发送**：通过 Gateway 发送用户消息
- **Agent 配置更新**：更新工作区、模型等配置
- **工具调用**：执行 OpenClaw 工具
- **状态同步**：订阅 agent 状态变化

### 协议契约

- 会话 ID（sessionId）由 OpenClaw 提供
- Agent ID（agentId）关联 OpenClaw agent
- 消息格式遵循 OpenClaw 消息规范
- 工具调用结果由 OpenClaw 返回
- 会话制品（artifacts）由 OpenClaw 管理

### 边界约束

根据 `AGENTS.md`：
- JunQi 只是 OpenClaw 的桌面客户端
- 不拥有独立于 OpenClaw 的 agent、任务、会话、工具语义
- OpenClaw 原生未定义的能力，JunQi 不得自行捏造或模拟
- 所有增强必须基于最新版 OpenClaw 官方文档和协议

---

## 附录：相关文件清单

### 核心组件

- `src/pages/ChatPage.tsx` - 聊天页面容器
- `src/components/Chat/ChatTabs.tsx` - 会话标签栏
- `src/components/Chat/ChatView.tsx` - 消息视图
- `src/components/Chat/MessageInput.tsx` - 消息输入组件
- `src/components/Chat/SessionContextBar.tsx` - 会话上下文栏

### 状态管理

- `src/stores/chatStore.ts` - 会话状态管理
- `src/stores/gatewayDataStore.ts` - Gateway 数据管理

### 工具与服务

- `src/services/gateway.ts` - Gateway RPC 客户端
- `src/hooks/useAgentScopedSession.ts` - Agent 作用域会话钩子
- `src/hooks/useComposerAttachments.ts` - 附件管理钩子
- `src/hooks/useComposerSuggestions.ts` - 建议补全钩子
- `src/hooks/useMessageSend.ts` - 消息发送钩子
- `src/utils/confirmedEmptyTranscript.ts` - 历史预热工具

---

**文档版本**：2026-08-07
**分析基于**：Blues-Code/code 分支 commit c61e6075
