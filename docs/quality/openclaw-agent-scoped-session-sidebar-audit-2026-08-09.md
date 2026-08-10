# OpenClaw 智能体作用域会话侧栏审计

日期：2026-08-09

## 权威依据

- OpenClaw `SessionsListParamsSchema` 正式提供 `agentId`、`archived`、分页和展示标题参数。
- OpenClaw 官方侧栏由当前选中的智能体决定会话作用域；切换智能体后只呈现该智能体会话。
- 官方侧栏支持按自定义分组或不分组，并支持按创建顺序或最近更新排序。
- 官方完整会话页承担跨智能体查询与批量管理，侧栏不把其他智能体会话混入当前作用域。
- `agents.list` 的 `defaultId`、`mainKey` 和 `scope` 共同确定默认主会话；其他智能体主会话只能从 Gateway 已返回的会话身份中解析，客户端不得拼接猜测。

核对源码：

- `/Users/wei/DevTool/project/mine/gui/Openclaw/packages/gateway-protocol/src/schema/sessions.ts`
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

## 技术决策

- 复用 Gateway 全局权威会话缓存。该缓存已经通过官方 `sessions.list` 完成活动与归档分页，并由 Gateway 事件持续更新；侧栏只做基于官方 `agentId` 或规范会话 key 的只读作用域投影，不新增第二套轮询、缓存或协议。
- 智能体选择来自 `agents.list` 投影。当前活动会话变化时同步选择；用户主动切换后只改变侧栏作用域，不伪造或修改会话归属。
- 主会话使用现有 `resolveKnownAgentMainSessionKey`，只固定 Gateway 已确认的 key。
- 最新 OpenClaw Control UI 将主会话入口折叠进智能体身份区；JunQi 依据已经确认的产品要求保留主会话首行，但不改变主会话身份和生命周期语义。
- 删除日期分桶及其本地存储，不保留双轨分组；只持久化与 OpenClaw 官方侧栏一致的分组偏好。
- 侧栏仅提供官方侧栏所需的自定义分组或不分组、创建顺序或最近更新；跨智能体高级管理继续由 `/sessions` 承担。
- 最新 OpenClaw 侧栏还包含状态、创建者和定时会话过滤。本次只实现用户已确认的智能体作用域、分组和排序，不把 JunQi 现有后台活动区或归档区扩展成另一套过滤状态。
- 智能体作用域控件采用官方智能体菜单模式：同一菜单承担智能体切换、新建智能体和当前智能体设置；JunQi 只连接已有 `/agents?new=1` 与 `/agents?agent=<id>` 页面，不新增管理协议。
- 创建排序以最新版 OpenClaw `SessionRowSchema.createdAt` 为首要依据，按时间倒序排列。只有缺少该官方字段的旧会话才使用首次收到时的稳定相对顺序，并排在可核验创建时间之后；客户端刚确认但仍缺少时间的会话可在当前窗口提升到首位。最近更新排序继续读取 Gateway 活动或更新时间字段。所有顺序都只影响侧栏呈现，不写回 OpenClaw。

## 未验证边界

- 尚未在真实远程 Gateway、多智能体大列表和 OpenClaw `scope=global` 环境完成桌面视觉验收。
- 自动化只能验证作用域、排序、分组和主会话固定契约，不能替代 macOS、Windows 和 Linux 真机窗口缩放验收。
