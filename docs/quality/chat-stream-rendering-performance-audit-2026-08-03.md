# Chat 流式渲染性能审计

日期：2026-08-03

## 依据

- JunQi 当前安装的 OpenClaw 版本：`2026.7.1`，并对照其随包发布的 Control UI 生产资源。
- OpenClaw Gateway 的 `agent`、`chat`、`session.tool` 与终态事件仍是运行状态和消息内容的权威来源。
- OpenClaw Control UI 使用累计流快照更新当前消息，并在更新完成后通过动画帧和近底部阈值协调滚动；历史刷新会保留本地运行尾部并与权威 transcript 收敛。
- JunQi 的对应链路为 `ChatHandler -> App callbacks -> chatStore -> SemanticBlock -> ResponseGroup -> ChatView/Virtuoso`。

## 当前行为

JunQi 已具备以下基础：

1. `ChatHandler` 合并 OpenClaw 的双文本流，并以稳定的 session、run 和 message identity 投影累计快照。
2. Gateway 流事件先经过 50ms 微批处理，再进入 React 状态。
3. 流式正文只渲染轻量纯文本，终态才进入完整 Markdown 渲染。
4. ChatView 使用 Virtuoso，并在用户离开底部后锁定自动跟随。
5. final、error 和 abort 会先强制排空待处理快照，再提交终态。

现有主要成本位于 Store 派生层。每次 `updateStreamingMessage` 都对完整会话重新执行消息规范化、SemanticBlock 构建、ResponseGroup 分组和 RenderBlock 投影。虚拟滚动减少了 DOM 数量，但不能消除这部分随历史长度增长的 JavaScript 工作。

## OpenClaw 借鉴边界

本次借鉴 OpenClaw 的协议和状态处理原则，而不是复制其 Control UI 实现：

- 保留累计快照语义，不把 delta 误当成可直接追加的独立消息。
- 保留 replace、双流纠偏、工具边界、终态强制排空和 transcript 收敛。
- 保留稳定 run/message identity，不能为了性能拆成每 Token 一个节点。
- 流式优化只能改变 JunQi 的本地投影成本，不能改变 OpenClaw 的权威状态、字段或事件顺序。

OpenClaw Control UI 当前并未为 JunQi 的 SemanticBlock 和 ResponseGroup 业务层提供可直接复用的增量算法。JunQi 需要针对自身结构化消息、执行计划、协作时间线和预览能力实现受约束的尾部增量投影。

## 本次目标

当 OpenClaw 更新的是会话最后一条、且该消息已经位于最后一个 ResponseGroup 时：

1. 只重新规范化当前流式消息。
2. 只重建最后一个 ResponseGroup。
3. 复用此前所有 ResponseGroup 和 RenderBlock 的对象引用。
4. 不满足安全前提时回退到原有完整重算。
5. 首个流片段、工具边界、历史替换、非尾部更新和终态继续走现有权威路径。

该策略将常规流式刷新从“完整历史投影”收敛为“当前尾消息和尾分组投影”，同时保留现有协议行为。

## 后续阶段

本次不直接引入独立 LiveStream Store。该方案会影响语音流、协作时间线、执行计划、历史对账、通知和多会话后台运行，需要单独完成协议级设计和真实性能基准后再实施。

后续候选项：

- 将 ChatTabs 从高频消息缓存通知中隔离。
- 对 Thinking 文本滚动和行数统计做动画帧合并。
- 为 Virtuoso 增加稳定 item key，并用 React Profiler 核验可见历史行的提交次数。
- 在 500 条历史消息和超长单回复场景记录 Store 投影、React commit、布局测量和滚动耗时。
- 根据前台、后台和内容长度评估 50ms 微批间隔是否需要自适应调整。

## 验证结果

- Store 定向测试：25/25 通过，包含增量投影等价性、历史对象引用复用和非尾部安全回退。
- ChatHandler 定向测试：52/52 通过，覆盖 OpenClaw 双流、replace、终态、工具边界、history 收敛和多会话排空。
- 完整前端测试：2287/2287 通过。
- 脚本测试：233/233 通过。
- `pnpm lint` 通过，模块边界检查 761 个文件，桌面版本四处一致为 `2.0.0`，TypeScript 通过。
- `pnpm build` 通过，collaboration package contract 成功，Vite 完成 9104 个模块转换。
- `git diff --check` 和修改文件禁用 Unicode 符号扫描通过。

## 验证边界

自动化验证了投影等价性、历史对象引用复用和回退行为，但不能替代真实 Tauri 中的长会话帧率、滚动稳定性、亮暗主题及窄窗口验收。本次未执行真实性能录制，因此不声明已达到固定 FPS 或 commit 耗时目标。

## 2026-08-04 Gateway 响应阶段投影

官方 OpenClaw 当前源码在 `chat.send` 的 Control UI 连接上发出只读
`chat.send_timing` 事件，包含精确 `sessionKey`、`runId`、阶段以及 Gateway 端耗时。JunQi
同样以官方 `openclaw-control-ui` 客户端身份连接，因此可接收该事件；此前未消费它，界面只能
显示本地等待时间。

本次将事件严格解码，且只接受已在本地 Run 投影中确认活动的完全相同 `sessionKey + runId`。
它仅驱动输入中气泡下方的 Gateway 阶段和上游报告耗时，不影响 Stop、队列、Task checkpoint、
消息历史或 OpenClaw 终态判断。Run 结算、会话重置、删除和 identity 轮换都会清除该临时视图。

### 验证结果

2026-08-04 已通过 timing decoder、ChatHandler 和 ChatStore 定向回归（92 项），以及
`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`。未连接真实 Gateway
或执行 Windows、macOS、Linux 真机界面验收，因此不声明该事件已在具体运行环境中实测到达。

## 2026-08-07 动态岛跨窗口发布节流

### 发现

`DynamicIslandRuntime` 与聊天流状态订阅在同一渲染链路中。此前每次流式 Store 更新都会重新生成
快照，并立即向动态岛窗口发送一次 `dynamic-island:update` Tauri 事件。聊天流默认以 50ms 微批
进入 React 状态，因此该事件会把高频状态计算和跨窗口 IPC 叠加到同一时间段，可能造成窗口帧间歇性
抖动。该判断来自当前调用图和事件频率审查，尚未用 Tauri 真机录制确认具体卡顿帧。

### 调整

- `DynamicIslandUpdateScheduler` 将动态岛更新合并为 100ms 的尾部发布窗口。
- 发布时读取最新快照，不丢弃中间状态；动态岛显示、隐藏和 `ready` 初次同步仍由可见性控制器
  立即处理。
- 调度器销毁或隐藏时取消待发布回调，过期回调不能再次发送事件。
- 该改动只调整 JunQi 本地跨窗口 UI 投影频率，不改变 OpenClaw session、run、task 或 transcript
  的状态和事件语义。

### 验证结果与边界

2026-08-07 已通过动态岛调度器行为回归（合并、最新快照、取消和销毁），
并通过 `pnpm exec tsc --noEmit`、`pnpm lint` 和 `git diff --check`。尚未在真实 Tauri 窗口中
录制长时间聊天、终端高输出、拖拽调整大小等场景的帧时间；若卡顿仍出现在终端高输出或窗口拖拽
期间，需要沿终端渲染器和分割器事件链路继续单独测量，不能把本次节流视为所有卡顿已解决。
