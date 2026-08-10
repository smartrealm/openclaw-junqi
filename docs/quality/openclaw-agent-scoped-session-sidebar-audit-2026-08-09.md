# OpenClaw 智能体作用域会话侧栏审计

日期：2026-08-09

## 权威依据

- OpenClaw `SessionsListParamsSchema` 正式提供 `agentId`、`archived`、分页和展示标题参数。
- OpenClaw `chat.history`、`chat.send`、`chat.abort` 以及会话读写 RPC 都把 `agentId` 定义为可选
  路由字段；当 key 的规范存储目标为 `global` 时，该字段决定真实智能体。
- OpenClaw `session-request-agent.ts` 明确接受 `agent:<agentId>:global` 作为 `global` 的智能体作用域
  别名；官方 Control UI 用该别名隔离本地会话视图与事件缓存，同时在线请求仍使用规范 key 与
  `agentId`。
- OpenClaw 官方侧栏由当前选中的智能体决定会话作用域；切换智能体后只呈现该智能体会话。
- 官方侧栏支持按自定义分组或不分组，并支持按创建顺序或最近更新排序。
- 官方完整会话页承担跨智能体查询与批量管理，侧栏不把其他智能体会话混入当前作用域。
- `agents.list` 的 `defaultId`、`mainKey` 和 `scope` 共同确定默认主会话；其他智能体主会话只能从 Gateway 已返回的会话身份中解析，客户端不得拼接猜测。

核对源码：

- `/Users/wei/DevTool/project/mine/gui/Openclaw/packages/gateway-protocol/src/schema/sessions.ts`
- `/Users/wei/DevTool/project/mine/gui/Openclaw/packages/gateway-protocol/src/schema/logs-chat.ts`
- `/Users/wei/DevTool/project/mine/gui/Openclaw/src/gateway/session-request-agent.ts`
- `/Users/wei/DevTool/project/mine/gui/Openclaw/ui/src/lib/sessions/session-requests.ts`
- `/Users/wei/DevTool/project/mine/gui/Openclaw/ui/src/lib/sessions/session-key.ts`
- `/Users/wei/DevTool/project/mine/gui/Openclaw/ui/src/components/app-sidebar-session-navigation.ts`
- `/Users/wei/DevTool/project/mine/gui/Openclaw/ui/src/components/app-sidebar-session-menu-renderers.ts`
- `/Users/wei/DevTool/project/mine/gui/Openclaw/ui/src/components/session-data-controller-events.ts`

## 审计发现

### BUG-SS-01 · 严重 · 会话侧栏没有智能体作用域

`WorkbenchPanel` 直接使用全局会话集合，所有智能体的普通会话进入同一列表。用户无法判断新会话属于哪个智能体，切换工作对象也不会收敛会话范围。

影响：

- 不同智能体会话混排，侧栏与 OpenClaw 的智能体会话归属不一致。
- 新建会话仍根据当前活动会话推断智能体，界面选择与创建目标无法形成同一契约。

### BUG-SS-02 · 严重 · 所选智能体主会话没有固定入口

侧栏对所有普通会话统一执行运行状态和更新时间排序。即使 Gateway 已返回智能体主会话，它也可能被其他活动会话挤离首位。

影响：

- 主会话不是稳定入口。
- 默认智能体与其他智能体的主会话呈现规则不一致。

### BUG-SS-03 · 中等 · 分组依赖客户端镜像字段和日期分桶双轨

分类区按 OpenClaw `session.category` 收集会话，未分组区却读取 `chatStore` 从该字段派生的 `session.groupId`，再把未分组会话放入客户端日期分桶。当前完整 `sessions.list` 投影会同步两个字段，因此没有复现重复行；但同一分组语义存在两个客户端字段和两套呈现规则，没有必要继续保留。

影响：

- 稀疏或中间态投影必须额外维持 `category` 与 `groupId` 一致。
- 侧栏分组行为与 OpenClaw 官方 `category` 或不分组模式不一致。

### BUG-SS-04 · 中等 · 分组和排序交互偏离官方侧栏

当前侧栏固定叠加自定义分类和日期分桶，并始终采用“运行中优先、最近活动优先”排序。用户没有官方侧栏提供的“分组依据”和“排序方式”选择。

### BUG-SS-05 · 中等 · 缺少侧栏内的完整会话入口

JunQi 已有 `/sessions` 完整会话管理页，但当前会话侧栏没有稳定的“所有会话”入口，用户需要切换到其他导航面板才能进入。

### BUG-SS-06 · 严重 · 智能体选择器误删官方管理操作

首轮实现把 OpenClaw 官方智能体菜单简化成只负责切换智能体的 `Select`。虽然独立智能体页仍保留新建入口，但会话侧栏不再提供官方菜单中的“新建智能体”和当前智能体设置，用户切换作用域后无法就近管理对应智能体。

影响：

- 原本存在的智能体创建和设置入口从当前工作流消失。
- 侧栏外观接近 OpenClaw，但交互能力被错误裁剪。

### BUG-SS-07 · 严重 · 创建顺序没有优先使用官方创建时间

首轮修复为了覆盖旧会话缺少 `createdAt` 的情况，在生产路径始终使用首次收到会话行的相对顺序。Gateway 默认列表按更新时间返回，因此首次相对顺序通常与“最近更新”一致；即使最新版 OpenClaw 已在 `SessionRowSchema.createdAt` 返回正式创建时间，JunQi 也会忽略该字段，导致两种排序看起来没有区别。

影响：

- 存在 `createdAt` 的会话仍按首次活动顺序排列。
- “创建时间”和“最近更新”可能得到相同结果，用户无法确认排序切换是否生效。
- 缺少 `createdAt` 的旧会话仍需要稳定且可解释的次级顺序。

### BUG-SS-08 · 中等 · 排序字段与侧栏显示字段不一致

上一轮修正已让创建排序优先读取 `SessionRowSchema.createdAt`，但侧栏行尾始终显示
`lastActivityAt`、`updatedAt` 等最近活动时间。用户切换到“创建时间”后，看到的仍是最近更新
时间，无法据此核对排序结果，因而表现为“创建时间没有生效”。

同时，`SessionRowSchema.createdAt` 是可选字段。旧会话或较早 Gateway 可能没有返回该字段。
客户端此前用本窗口首次收到行的顺序作为所谓“稳定创建顺序”；而 Gateway 默认列表按更新时间
返回，该本地顺序既不能证明是创建顺序，也会再次让两种排序趋同。

影响：

- 已有真实创建时间时，行内显示与排序依据相互矛盾。
- 缺少真实创建时间时，客户端把接收顺序错误地呈现为创建顺序。
- 用户无法区分“创建时间已按官方数据排序”与“Gateway 未提供该字段”。

### BUG-SS-10 · 中等 · 新建会话以客户端时间伪造创建时间

`projectCreatedNativeSession` 曾在 `sessions.create` 回执未提供 `entry.createdAt` 时，退回读取
`entry.updatedAt`，再退回读取本机 `Date.now()`。这两个值都不是 OpenClaw 已确认的会话创建时间；下一次
`sessions.list` 刷新也可能不含 `createdAt`，造成刚创建时可排序、刷新后不可排序的前后不一致。

影响：

- 本机时钟或更新时间会被错误展示为 Gateway 创建时间。
- 创建排序在刷新前后出现不可解释的变化。

### BUG-SS-11 · 中等 · 详情和活动投影混用更新时间

会话详情的“会话时长”此前在 `createdAt` 缺失时以 `updatedAt` 计算；活动历史规范化也把
最近活动时间写回 `createdAt`。这会让没有官方创建时间的会话看起来像具有可信创建时间，且与侧栏
的不可用语义矛盾。

影响：

- 会话详情会错误显示“会话时长”。
- 历史活动投影可能把最近更新标记为创建时间，污染后续消费者。

### BUG-SS-12 · 严重 · 路由新建会话先挂载旧会话

`/chat?agent=<id>&new=1` 的创建由副作用发起。在 Gateway 回执返回前，旧实现仍会挂载当前活动会话的
`ChatView` 与输入框。连接已建立且旧会话为空时，历史自动加载会因此针对旧会话启动，用户会看到“正在加载
历史”，并可能在新会话身份尚未确认时向错误目标输入内容。

影响：

- 新建会话首屏可能显示并加载旧会话历史。
- 用户无法将“创建中”与“当前会话历史加载中”区分，首条消息的可发送状态不可靠。

### BUG-SS-09 · 严重 · 全局会话缺少智能体作用域，导致跨会话缓存与控制请求串扰

最新版 OpenClaw 的 `global` 不是可由客户端单独识别的唯一会话：同一个 `global` key 可分别属于
多个智能体。官方 `sessions.list` 在按 `agentId` 查询时为该行确定所属智能体，并且官方 Control UI
为本地选择、事件和缓存使用 `agent:<agentId>:global` 作用域别名。线上 RPC 则把规范 key `global`
与 `agentId` 一起发送，防止落入默认智能体。

JunQi 当前存在同一根因的多个表现：

- `OpenClawSessionListClient`、`gateway.getSessions` 和 `gatewayDataStore.fetchSessions` 都以未带
  `agentId` 的 `sessions.list` 获取全局集合；对于 `global` 行，这不能保留完整的官方所有者证据。
- `projectOpenClawSessionForChat`、`coalesceSessionsByKey`、`chatStore`、`ChatHandler`、运行围栏、
  删除标记、会话命令串行器和 Gateway 数据缓存都只用裸 key 作为本地身份。多个 `global` 行会被
  合并、覆盖或互相清理。
- `chat.history`、`chat.send`、`sessions.abort`、`sessions.patch`、`sessions.compact`、
  `sessions.delete`、`sessions.reset` 及相关预览、产物、检查点调用，存在未从当前会话作用域传递
  `agentId` 的路径。对裸 `global`，Gateway 会按默认智能体解释或拒绝，客户端不能据此声称操作了
  用户当前选择的智能体。
- `ChatHandler` 对广播事件只按 `sessionKey` 建索引；OpenClaw 只会为全局会话事件额外发送
  `agentId`，当前实现没有把该字段纳入本地身份，因此不同智能体的流式输出、停止和恢复投影可互相
  覆盖。

影响：

- 侧栏可能遗漏非默认智能体的全局主会话，或把其显示为另一个智能体的会话。
- 历史加载、发送、Stop、压缩、删除、重置和运行时设置可能落入默认智能体，或在本地显示为已完成
  而实际目标未知。
- 同时运行的多个全局会话可能共享消息、输入草稿、发送队列、流式文本、运行围栏和删除状态。

### BUG-SS-13 · 高 · Gateway 首次连接时会话轮询与智能体快照竞争

`gatewayDataStore.startPolling` 曾在连接建立后并发启动 `agents.list` 与会话读取。后者必须以
`agents.list` 已确认的智能体范围逐项调用 `sessions.list`，因此在首个快照尚未写入状态仓时会收到空范围。
客户端随后将这个本地时序问题显示为“会话列表加载失败”，即使 Gateway 连接和会话能力本身正常。

影响：

- 首次进入仪表盘时侧栏可能显示错误重试提示。
- 该提示没有反映 Gateway 的实际会话读取结果，误导用户排查连接或凭据。

## 技术决策

- 会话读取必须以 `agents.list` 返回的真实智能体集合为范围，对每个智能体调用官方
  `sessions.list` 并显式请求 `includeGlobal`。不得再把无作用域列表当作多智能体 `global` 会话的
  权威来源。活动与归档结果仍由单一的 Gateway 会话读取服务维护，不在侧栏另建轮询。
- 对 Gateway 返回的 `global` 行，只有在同一次按智能体作用域的响应中取得有效 `agentId` 后，才可
  投影为官方已支持的本地作用域别名 `agent:<agentId>:global`。该别名只解决客户端身份和缓存冲突；
  出站 RPC 必须还原为 `{ key: 'global', agentId }`。没有可核验所有者的 `global` 行保留为待核验，
  不得混入任一智能体会话。
- 所有会话缓存、流式事件、运行围栏、发送队列、草稿、删除标记、mutation 串行器与 UI 选择都以
  作用域后的会话身份为键。普通 `agent:<id>:...` key 保持原样；不建立另一套本地会话或任务语义。
- 所有会话 RPC 从同一作用域目标构造请求。普通会话不附加冗余 `agentId`；全局会话必须附加已验证
  的 `agentId`。调用方缺少该所有者时应拒绝操作并显示待核验，而不是默认回落到主智能体。
- 智能体选择来自 `agents.list` 投影。当前活动会话变化时同步选择；用户主动切换后只改变侧栏作用域，不伪造或修改会话归属。
- 主会话使用现有 `resolveKnownAgentMainSessionKey`，只固定 Gateway 已确认的 key。
- 最新 OpenClaw Control UI 将主会话入口折叠进智能体身份区；JunQi 依据已经确认的产品要求保留主会话首行，但不改变主会话身份和生命周期语义。
- 删除日期分桶及其本地存储，不保留双轨分组；只持久化与 OpenClaw 官方侧栏一致的分组偏好。
- 侧栏仅提供官方侧栏所需的自定义分组或不分组、创建顺序或最近更新；跨智能体高级管理继续由 `/sessions` 承担。
- 最新 OpenClaw 侧栏还包含状态、创建者和定时会话过滤。本次只实现用户已确认的智能体作用域、分组和排序，不把 JunQi 现有后台活动区或归档区扩展成另一套过滤状态。
- 智能体作用域控件采用官方智能体菜单模式：同一菜单承担智能体切换、新建智能体和当前智能体设置；JunQi 只连接已有 `/agents?new=1` 与 `/agents?agent=<id>` 页面，不新增管理协议。
- 创建排序和行尾时间显示使用同一字段选择：创建模式只读取最新版 OpenClaw
  `SessionRowSchema.createdAt`，最近更新模式读取 Gateway 活动或更新时间。所有顺序只影响侧栏
  呈现，不写回 OpenClaw。
- `createdAt` 缺失时，JunQi 不再以首次接收顺序或新建后的本地提升伪造创建顺序。存在可核验
  时间的行按时间倒序；没有时间的行保持 Gateway 本次返回的相对顺序。当前作用域没有任何
  可核验创建时间时，“创建时间”选项不可用，并明确说明原因。
- `sessions.create` 回执也只在返回 `entry.createdAt` 时投影该字段；更新时间和客户端时钟均不能成为
  创建时间替代值。
- 共享创建时间解析只接受 Gateway 明确返回的 `createdAt`。会话详情和历史活动投影在字段缺失时保留
  未知，不借用最近更新时间。
- 带新建意图的路由在 `sessions.create` 未确认前只展示创建状态或原地重试，不挂载旧 `ChatView`。
  成功后才移除路由意图并展示 Gateway 已确认、带空 leaf 的会话；客户端不自行创建会话或转录记录。
- 首次轮询先完成 `agents.list` 的有效快照，再启动按智能体范围的活动与归档 `sessions.list`。智能体
  范围尚不可用时不提交会话错误；真正的 Gateway 拒绝、鉴权失败或畸形会话响应仍按原错误路径呈现。

## 未验证边界

- 尚未在真实远程 Gateway、多智能体大列表和 OpenClaw `scope=global` 环境完成桌面视觉验收。
- 自动化只能验证作用域、排序、分组和主会话固定契约，不能替代 macOS、Windows 和 Linux 真机窗口缩放验收。
- 尚未对一个实际缺少全部 `createdAt` 的旧 Gateway 在 Tauri 窗口中完成视觉验收；自动化只覆盖
  其不可用语义和稳定 Gateway 顺序。
- 尚未在真实多智能体、`scope=global` 的 Gateway 与 Tauri 中完成历史、发送、Stop、删除、重置、
  流式事件和断线恢复的端到端验收；本轮先以官方协议、handler 与 Control UI 源码确定收敛契约。
- 尚未在真实 Tauri 与 Gateway 中复现路由创建期间的窗口视觉状态；自动化覆盖了未确认时不挂载
  `ChatView` 的结构契约，以及已确认空 transcript 的不加载历史和首发不预热逻辑。

## 本轮实施与验证

- `OpenClawSessionProjection` 与新建会话投影现严格保留官方回执中的数值 `createdAt`，拒绝负数或
  非有限值；不会以本地活动时间、首次接收顺序、更新时间或本机时钟补造创建时间。
- 侧栏创建排序与行尾时间显示都读取同一 `createdAt` 字段。主会话与置顶会话仅因既定布局固定在
  各自区域，不参与普通会话的重排；普通会话及归档会话在各自区域内按创建时间倒序排列。
- 当当前智能体范围内没有可核验的 `createdAt` 时，控件回退为“最近更新”并明确显示不可用原因；
  部分历史会话缺少该字段时，缺失项保持 Gateway 返回顺序，不被伪造为新的会话。
- `sessions.list` 已按 Gateway 确认的每个智能体独立读取，并显式请求 `includeGlobal`、
  `includeUnknown`、`configuredAgentsOnly`、派生标题和最后一条消息。返回的裸 `global` 立即投影为
  `agent:<agentId>:global`，出站 RPC 再还原为规范 key 与 `agentId`。
- 已执行 TypeScript 类型检查及 73 项定向回归测试，覆盖创建时间投影、排序、缺失字段降级、智能体
  范围列表、全局别名、会话解析、订阅、历史与 Gateway 数据投影。真实 Gateway 与三平台桌面视觉
  验收仍属于上述未验证边界。
- 2026-08-09 对当前已认证 Gateway 进行只读实测：`sessions.list` 返回 15 条会话，全部有
  `updatedAt`，没有一条返回 `createdAt`。因此当前运行时不能提供可核验的创建时间排序；侧栏应自动
  选择“最近更新”，并在分组与排序菜单说明该字段不可用。此结论只描述当前运行时响应，不将其作为
  OpenClaw 版本能力门禁。
- 路由新建会话现由 `useAgentScopedSession` 暴露待确认状态，`ChatPage` 在该状态下不渲染会话标签、历史或
  输入区。仅当官方 `sessions.create` 成功回执提交会话并消费路由参数后，正常聊天界面才挂载。
- 新建链路再次对照最新版官方协议：`SessionsCreateResultSchema` 将 `sessionId` 与 `entry` 标为可选，
  但当前官方 `sessions.create` handler 在成功创建或重置后都会返回两者。JunQi 当前只接受带完整会话
  身份的回执，避免在身份未核验时挂载旧 transcript；该严格门禁与当前 handler 的真实回执一致。若后续
  上游 handler 改为省略身份，必须先通过官方会话读取接口重新取得身份，不能直接放宽为本地推断。
- 2026-08-10 已修复首次 Gateway 连接的轮询顺序：数据层只在 `agents.list` 产生有效快照后读取会话，
  并新增回归覆盖“智能体请求先于两次活动和归档会话请求、会话错误保持为空”。该修复不改变
  `sessions.list` 的参数、分页校验或真实错误语义。
