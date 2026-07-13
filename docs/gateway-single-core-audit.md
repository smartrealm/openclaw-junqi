# Gateway 全局状态流转审计

日期：2026-07-13

## 审计结论

当前 Gateway 已有进程级单飞锁和前端重启单飞 Promise，但仍未满足“只有一个核心方法”：应用层存在多条直接恢复路径，Manager 内部也有绕过状态机的快照写入；Rust 的 canonical lifecycle 与 runtime mode 分锁保存，并由两个转换函数和若干直接写锁共同维护。

本轮将唯一核心编排入口定义为 `GatewayConnectionManager.dispatch`。所有进程观测、WebSocket 事件、重试、重置和重连都必须进入该方法。Rust 是 IPC 后的状态存储边界，只保留 `GatewayProcess::transition` 一个原子写入原语，不建立第二套编排流程。

## 严重问题

### BUG-GSC01 · CRITICAL · 应用恢复流程绕过 Gateway Manager

**位置**：`src/App.tsx`、`src/hooks/useSetupFlow.ts`、多个设置与快捷入口。

**证据**：调用方可以直接组合 `gateway.disconnect()`、`ensureRunning()`、`gateway.retry()` 与 `gatewayManager.reconnect()`。不同入口拥有各自的步骤、错误处理和并发门闩。

**影响**：同一次故障可被启动恢复、手动恢复、配置保存和 WebSocket 自恢复以不同顺序处理，Manager 的状态不再代表实际正在执行的流程。

**修复**：Manager 提供单一 `dispatch` 编排入口和语义化薄封装；App 只请求动作或提交事实，不再自行拼接断开、探测、启动、重启和重连。

### BUG-GSC02 · HIGH · CONNECTED 状态忽略进程离线与错误

**位置**：`src/services/gateway/GatewayStateMachine.ts`。

**证据**：CONNECTED 收到任意 `STATUS_RECEIVED` 都直接返回 NONE，包括 `running=false` 或 `error!=null`。

**影响**：进程轮询已经确认 Gateway 退出时，只要 WebSocket close 事件尚未到达，UI 仍持续显示已连接。

**修复**：先处理 retrying、error 和 running=false，再应用 CONNECTED + healthy 的稳定规则。

### BUG-GSC03 · HIGH · retrying 快照绕过状态机

**位置**：`src/services/gateway/GatewayConnectionManager.ts`。

**证据**：`onStatusChanged` 遇到 `status.retrying` 时直接修改 `this.retrying`、emit 并 return，没有提交 `STATUS_RECEIVED`。

**影响**：快照可同时出现 `state=connected`、`connected=true`、`retrying=true`，且 FSM 不知道恢复已经开始。

**修复**：状态订阅只能构造事件并进入 `dispatch`；错误、retrying、startAttempted 等派生字段也只能在 dispatch 中提交。

### BUG-GSC04 · HIGH · Rust canonical 状态可撕裂且存在多个写入口

**位置**：`src-tauri/src/state/gateway_process.rs`、`src-tauri/src/commands/gateway_supervisor.rs`、`gateway.rs`。

**证据**：lifecycle 与 runtime mode 使用两个 Mutex；`transition_lifecycle`、`transition_runtime` 和 `gateway_status` 的直接 lock 写入都能改变 canonical 状态。诊断快照也分两次取锁。

**影响**：读取方可观察到新 mode 搭配旧 lifecycle；新增调用点可以绕过日志和状态约束，无法从代码结构保证唯一写入方法。

**修复**：合并为一个私有 `GatewayRuntimeState` Mutex；只暴露 `GatewayProcess::transition` 写入和只读 snapshot。删除全部直接写锁和旧转换函数。

## 中等问题

### BUG-GSC05 · MEDIUM · 重置与重试不会立即驱动探测

**位置**：`GatewayStateMachine.ts`、`GatewayConnectionManager.ts`。

**证据**：RETRY/RESET 只回到 DETECTING 且无动作，调用方必须记住额外调用 `probe()`。

**影响**：不同 UI 入口表现不同，部分入口最长等待下一次 2 秒轮询。

**修复**：恢复意图由核心方法统一失效旧 generation、断开旧连接并立即探测；调用方不再组合 reset + probe。

### BUG-GSC06 · MEDIUM · 既有测试验证源码片段多于真实状态行为

**位置**：`src/services/gateway/gatewayRecoveryRegression.test.ts`。

**证据**：多数断言使用正则匹配源码，未直接运行 FSM 的进程离线、错误和重试转换。

**影响**：代码仍可能匹配正则但状态语义已经回归。

**修复**：每个状态缺陷增加可执行的纯状态机或 Rust 单元测试；源码边界测试仅用于证明没有旁路。

## 修复后证明

- 前端编排状态只有 `GatewayConnectionManager.dispatch` 调用 FSM transition 和 emit。
- 应用运行、手动恢复、配置变更、配对、Native 首次启动与 Docker 首次启动均通过 Manager 语义入口。
- Rust canonical lifecycle/mode 位于同一个私有 Mutex，只有 `GatewayProcess::transition` 可写。
- 源码扫描确认旧 `transition_lifecycle`、`transition_runtime`、`runtime_mode` 和直接 lifecycle lock 写入为 0。
- 真实 Tauri 开发二进制使用隔离应用标识成功启动，并连接到健康的本地 Gateway。

## 完成性复核补充（2026-07-13）

上一轮证明只覆盖了 lifecycle/mode，没有覆盖同样参与生命周期判断的 `restarting`，也没有证明只读状态查询不会覆盖正在执行的操作。按“所有 Gateway 状态”重新枚举后，补充以下缺陷。

### BUG-GSC07 · CRITICAL · 重启标记与 canonical 状态分裂

**位置**：`src-tauri/src/state/gateway_process.rs`、`src-tauri/src/commands/gateway.rs`。

**证据**：`restarting` 使用独立 Mutex，并由 `restart_gateway` 和 RAII guard 直接写入；`gateway_status`、`start_gateway_locked` 又读取它决定对外状态和是否启动。

**影响**：即使 lifecycle/mode 只有一个写方法，系统仍存在第二个生命周期状态源，无法原子观察 `reconnecting + restarting`。

**修复**：把 restarting 合并进私有 `GatewayRuntimeState`，所有变更仍只经过 `GatewayProcess::transition`。

### BUG-GSC08 · CRITICAL · 状态查询可覆盖正在执行的生命周期

**位置**：`src-tauri/src/commands/gateway.rs`。

**证据**：`gateway_status` 未持有 `operation_gate`，但在子进程退出或发现外部端口时调用 transition；`restart_gateway` 还在获取 gate 前写 port。

**影响**：状态轮询可以把 STARTING/RECONNECTING 覆盖为 STOPPED/RUNNING；并发重启等待者可以在真正获得所有权前污染 owner 的 port。

**修复**：重启获得 gate 且确认不是合并请求后才写 port；状态查询仅在成功取得 observation gate 时清理 child 和提交观测状态。

### BUG-GSC09 · HIGH · 前端核心外仍有状态写入和悬挂启动 Promise

**位置**：`GatewayConnectionManager.ts`、`GatewayStateMachine.ts`。

**证据**：init 直接替换 FSM 并写 error/retrying/startAttempted；executeAction 写 startAttempted/error。异步 start 在 generation 失效后直接 return，pending Promise 永不 settle。

**影响**：源码无法证明 dispatch 是唯一状态提交点；设置向导切换生命周期时可能永久等待旧启动。

**修复**：增加 INITIALIZE/RECOVERY_REQUESTED 事件；FSM 在 STARTING 状态吞掉重复离线轮询，从而删除 startAttempted；失效 start 明确 reject waiter。

## 2026-07-14 最终复核

### BUG-GSC10 · HIGH · 离线返回值与 canonical runtime 不一致

**位置**：`src-tauri/src/commands/gateway.rs`。

**证据**：`gateway_status` 在受管 child 存活但端口失联、或无 child 且端口离线时返回 `running: false`，却不更新 runtime；诊断页仍可能看到 `running/managed_child`、`running/system_service` 或 `running/docker`。

**修复**：把观察事实映射为纯 runtime 归约；只有取得 observation gate 的查询可以提交，并且仅在状态真正变化时调用 `transition`，避免轮询刷日志。

### BUG-GSC11 · HIGH · ensure 异常会让恢复界面永久 retrying

**位置**：`src/services/gateway/GatewayConnectionManager.ts`。

**证据**：`ensureRunning()` 直接 await 原生 Promise，没有异常归一化。IPC reject 时既不提交 `STATUS_RECEIVED`，也不清除 retrying。

**修复**：将 reject 归一化为 `{ healthy: false, error }` 并通过 dispatch 进入 ERROR；增加 Manager 行为测试，同时证明 stale setup start 会 reject 且后续启动仍可执行。
