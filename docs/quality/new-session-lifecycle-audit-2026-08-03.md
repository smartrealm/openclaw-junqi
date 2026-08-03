# 新建会话生命周期审计

日期：2026-08-03

## 审查范围

本次审查覆盖所有用户可见的新建会话入口及其下游状态链：

```text
Chat 标签栏新建菜单
Dashboard 快捷操作
主导航侧栏新建对话
Agent 页面新建会话
Skill persona 新建会话
/new 本地命令
会话菜单分叉
→ createNativeSession
→ OpenClawSessionLifecycleClient
→ sessions.create
→ chatStore / gatewayDataStore
→ sessions.changed / sessions.list
→ Chat tab、history 与 composer
```

## 权威依据

- 仓库锁定依赖：`openclaw@2026.7.1-2`。
- 已安装协议 schema：`dist/schema-BuOFpc7K.js`。
- 已安装服务实现：`dist/sessions-UcKjjh_n.js`、`dist/session-create-service-14oZxrT5.js`。
- 官方安装版本文档：
  - `docs/gateway/protocol.md`
  - `docs/reference/session-management-compaction.md`
  - `docs/web/control-ui.md`

当前官方契约确认：

- `sessions.create` 需要 `operator.write`。
- 普通新会话可以只传 `agentId` 和 `label`。
- `parentSessionKey` 只建立父关联并继承运行时选择，不复制父 transcript。
- 操作员分叉必须传 `sessions.create({ parentSessionKey, fork: true })`。
- `fork: true` 缺少 `parentSessionKey` 会被拒绝。
- 分叉在父会话仍有活动运行时被拒绝，并受官方 transcript size policy 约束。
- 成功响应 schema 将 `sessionId` 和 `entry` 标为可选，但当前服务实现的正常成功路径会返回二者。JunQi 继续要求两者一致，属于有意的 fail-closed identity 门禁。

## 已确认正确的主链

- 新会话不再先创建本地伪 session；只有 Gateway 返回确认身份后才提交 UI。
- 日常连接请求了 `operator.read` 和 `operator.write`，符合 `sessions.create` 权限。
- Gateway 错误不会提交 chatStore 或 gatewayDataStore。
- Gateway 返回的顶层 `sessionId` 必须与 `entry.sessionId` 一致。
- 新会话成功后同步写入 chatStore 与 gatewayDataStore，并激活对应 tab。
- 新建入口会根据当前会话解析 agent；无法解析时才回退 `main`，Chat picker 与 Dashboard 已使用该共享规则。
- Native 与 Docker 仍通过当前选定 Gateway 执行同一 RPC，没有静默切换运行时。
- 路由型 `?agent=<id>&new=1` 在每个新的 location key 上最多执行一次，避免 React 重渲染重复创建。
- 相同创建请求在飞行期间会被去重，Gateway 拒绝后去重记录会释放。

## 发现

### BUG-NS-01 · CRITICAL · 会话菜单的“分叉”实际创建空白子会话

**位置**：

- `src/components/Chat/session-actions/SessionActionsMenu.tsx:97-102`
- `src/services/gateway/OpenClawSessionLifecycleClient.ts:85-94`

**当前行为**：

会话菜单提交：

```ts
{
  agentId,
  label,
  parentSessionKey: session.key,
}
```

但没有提交官方 `fork: true`。

OpenClaw 当前服务实现只在 `params.fork === true` 时调用 `forkSessionFromParent()`。只有 `parentSessionKey` 时，新 entry 会记录父关联并继承模型、thinking 等运行时选择，但 transcript 为空。

**影响**：

- 用户点击“分叉会话”，界面和文案声称复制当前上下文，实际得到空白会话。
- 父会话过大或仍在运行时，本应由官方 fork policy 明确拒绝；当前路径绕过这些分叉门禁。
- 后续依赖 `forkedFromParent` 或 transcript provenance 的功能看到的是普通子会话。
- 既有规格把 `sessions.create({ parentSessionKey })` 错写成普通分叉契约，已与锁定版本官方协议冲突。

**修复方向**：

为 create input 增加显式 `fork` 字段；会话菜单必须提交 `fork: true`。协议 client 应拒绝 `fork: true` 但没有父 key 的本地无效输入，并增加可在修复前失败的 wire-contract 测试。

### BUG-NS-02 · HIGH · 主导航侧栏仍把新会话硬编码到 main Agent

**位置**：`src/components/Layout/NavSidebar.tsx:604-620`

**当前行为**：

Chat picker 与 Dashboard 已调用 `resolveNewSessionAgentId(activeSessionKey, availableAgentIds)`，但主导航侧栏仍固定提交：

```ts
createNativeSession({ agentId: 'main', ... })
```

`WorkbenchPanel` 同时已经持有 `activeKey` 和 `agents`，因此该偏差不是信息缺失。

**影响**：

- 用户正在查看非 main Agent 的会话时，顶部新建菜单与 Dashboard 会在当前 Agent 下创建，侧栏主按钮却创建到 main。
- 同一产品动作的 Agent 归属取决于点击入口。
- 新会话成功后会立即切换到 main Agent，容易被误认为当前 Agent 配置或路由丢失。

**修复方向**：

侧栏复用 `resolveNewSessionAgentId(activeKey, agents.map(...))`，并增加跨入口行为测试，不再使用源码字符串断言代替归属行为。

### BUG-NS-03 · HIGH · “分叉”与普通创建共享不完整的飞行去重键

**位置**：`src/utils/sessionCreate.ts:89-105`

**当前行为**：

飞行请求只按：

```text
agentId + parentSessionKey
```

去重，不包含 label，也没有尚未支持的 `fork` 语义。两个不同用户意图只要 Agent 和父 key 相同，就会拿到同一个 Promise 和同一个会话。

**影响**：

- 同一 Agent 上并发触发的两个不同创建意图会静默合并。
- 补上 `fork: true` 后，如果去重键仍不包含 fork，父关联子会话与 transcript fork 仍可能错误合并。
- 两个不同 label 的创建请求只有第一个 label 生效，第二个调用方却收到成功结果。

**修复方向**：

以完整规范化创建意图生成去重键，至少包含 `agentId`、`label`、`parentSessionKey` 和 `fork`。只对完全相同的重复点击去重。

### BUG-NS-04 · MEDIUM · 创建确认与旧 complete sessions.list 快照之间缺少显式因果门禁

**位置**：

- `src/utils/sessionCreate.ts:58-105`
- `src/App.tsx:288-367`
- `src/stores/chatStore.ts:1280-1399`

**当前行为**：

`createNativeSession` 确认后立即把新 session 加入 chatStore。`setSessions(..., { completeSnapshot: true })` 会删除完整快照里不存在的非 canonical session。

已用当前 store 行为复现：

```text
addNativeSession(created)                    -> created 存在
setSessions(olderCompleteSnapshotWithoutIt) -> created 被删除
```

Gateway 的 `sessions.changed` 通常会使 App 的 request gate 失效，因此正常订阅路径会缩小这个窗口；但订阅失败被允许降级为轮询，创建协调器自身没有为已确认 mutation 失效已有 list 请求，也没有等待创建后的权威读回。

**影响**：

- 在订阅不可用、事件延迟或独立刷新交错时，刚创建并已激活的会话可能短暂从侧栏和 tab 投影中消失。
- Gateway 上的 session 实际存在，后续轮询又可能把它带回来，形成难以解释的闪退和复活。

**修复方向**：

建立创建 mutation 与 session-list request gate 的显式协调。可采用 mutation revision 或创建确认后的共享 invalidation，不应靠事件通常会及时到达这一时序假设。删除仍必须由创建后开始的 complete snapshot 或明确 delete event 驱动。

### BUG-NS-05 · MEDIUM · 路由创建在 Gateway 结果前消费一次性意图

**位置**：`src/hooks/useAgentScopedSession.ts:20-38`

**当前行为**：

Hook 在调用 `sessions.create` 前先从 URL 删除 `agent` 与 `new`。如果 Gateway 离线、Agent 已删除或请求失败，用户只收到 toast，当前页面没有保留可重试的创建意图。

**影响**：

- Dashboard 和 Agent Hub 的快捷入口失败后无法在原位置重试。
- 用户刷新页面不会重试，因为 URL 已被消费。
- 与 Chat picker 的行为不一致；picker 失败时保持打开，可以再次点击。

**修复方向**：

保留防重复执行门禁，但将 URL 终态处理与结果绑定：成功后消费参数；失败时提供明确重试动作，或保留失败状态并允许同一 intent 显式重试。不得通过 effect 自动无限重试。

### BUG-NS-06 · LOW · 创建入口的默认 label 不一致

**位置**：

- `src/components/Chat/ChatTabs.tsx:984-987`
- `src/hooks/useAgentScopedSession.ts:33`
- `src/components/Layout/NavSidebar.tsx:607-610`

**当前行为**：

三个入口分别使用 `sidebar.newSession`、`chat.newSessionLabel` 和 `sidebar.newChat`。中文结果包括“新建会话”“新会话”“新建对话”，这些动作型字符串会直接成为 Gateway session label。

**影响**：

- 相同的新会话在列表中显示不同占位标题。
- “新建对话”更像按钮动作，不像持久会话名称。
- 弱标题识别与后续自动标题展示更难保持一致。

**修复方向**：

所有普通创建入口使用同一个持久 label key；按钮文案继续使用各自的动作 key。分叉保留独立 label。

### BUG-NS-07 · MEDIUM · 核心入口和分叉缺少组件行为回归

**位置**：

- `src/utils/newSessionAgent.test.ts`
- `src/utils/sessionLifecycle.regression.test.ts`
- `src/utils/sessionCreate.test.ts`

**当前行为**：

已有纯函数和 coordinator 测试，但 picker、侧栏、路由失败重试和 SessionActionsMenu 分叉主要由源码字符串断言覆盖，分叉没有断言 `fork: true` 的行为测试。

**影响**：

- BUG-NS-01 和 BUG-NS-02 都在既有测试通过时存在。
- loading、重复点击、失败保留、成功关闭 picker、persona draft 归属等用户行为缺少真实组件契约。

**修复方向**：

增加组件级测试，mock `createNativeSession` 或 Gateway request 边界，验证传参、loading、错误、关闭和 active session 结果。源码 smoke test只保留结构性约束。

## 修复结果

在合并 `main` 的 `v2.2.0` 最新基线后逐项复核并完成修复：

1. BUG-NS-01：create contract、Gateway facade 和会话菜单已支持并发送 `fork: true`；无父 key 的 fork 在本地 fail closed。
2. BUG-NS-02：NavSidebar 已与 Chat picker、Dashboard 共用当前会话 Agent 解析规则。
3. BUG-NS-03：飞行去重 identity 已包含规范化的 agent、label、parent key 和 fork。
4. BUG-NS-04：创建确认与 App、gatewayDataStore 的两条 sessions.list 链已共享 mutation revision，拒绝确认前开始的旧快照；失败创建不会干扰列表读取。
5. BUG-NS-05：route intent 只在 Gateway 成功后消费；失败保留可访问错误条和显式重试，不自动循环。
6. BUG-NS-06：三个普通创建入口统一使用 `chat.newSessionLabel` 作为持久 label，按钮动作文案不变。
7. BUG-NS-07：补充 fork wire contract、完整 intent 去重、mutation revision、跨入口 Agent/label 和入口 loading、成功关闭、失败重试、persona 归属契约测试。

## 本次验证

已执行：

- 读取 OpenClaw 2026.7.1-2 schema、server handler、session-create service 与官方安装版本文档。
- 交叉读取全部 `createNativeSession` 调用方、Chat picker、Dashboard、NavSidebar、Agent route、Skill persona、Store commit 和 sessions.changed 刷新链。
- 定向测试：10 项通过。
- store 时序复现：确认旧 complete snapshot 可以删除刚提交的新会话。

定向测试首次未加载 `test-setup.ts`，触发既有 Node 环境缺少 localStorage 的测试启动错误；改用项目规定的 test setup 后 10 项全部通过。该错误不是产品运行时失败。

## 未验证边界

- 未启动或终止当前 Tauri 实例。
- 未对真实 Gateway 执行创建、分叉或删除。
- 未在 Windows、macOS 或 Docker 中录制 UI 行为。
- 未验证父会话活动运行、超大 transcript 和真实 fork transcript 内容。
- 已修改运行时代码并完成自动化验证；真实 Gateway 和 Tauri 行为仍待人工验收。
