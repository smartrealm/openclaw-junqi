# OpenClaw Gateway 入口与生命周期全链审计

日期：2026-08-05

审计对象：JunQi Desktop 当前提交 `8dc1b72d`，以及 OpenClaw 官方源码工作副本
`1e3880352e614116549c0a30c67a59a2d40ba259`。

## 结论

JunQi 的 Gateway 进程生命周期和 WebSocket 生命周期已分层：Tauri Rust 侧持有
Native、Docker、系统服务与子进程的变更权限；React 侧只观察已选择运行时、发起
受控恢复并投影状态；WebSocket 建连必须完成 OpenClaw 的 challenge、`connect` 和
`hello-ok` 握手后才可视为连接成功。

本次发现的首连重置问题已修复：Gateway 数据就绪状态由稳定的工作区首批数据协调器
管理，不再改变主连接 effect 的依赖，因此首次数据水合不会主动断开刚建立的
WebSocket。

本次已修复主窗口的运行时代码，并且没有启动浏览器版本。macOS、Windows、CentOS、
Ubuntu 的真实桌面窗口和各自系统服务行为仍须分别验收。

## 依据与范围

### JunQi 代码依据

- `src/App.tsx`：主窗口启动、冷启动恢复、Gateway 回调、会话和模型加载。
- `src/services/gateway/GatewayConnectionManager.ts`：连接状态机、生命周期 epoch、
  进程观察订阅和连接动作。
- `src/services/gateway/gatewayProcessObservation.ts`：进程存活与已认证端点探测。
- `src/services/gateway/GatewayLifecycleCoordinator.ts`：前端恢复、重启请求的单飞和
  优先级协调。
- `src/services/gateway/Connection.ts`：挑战握手、连接重试、断线清理和运行时身份失效。
- `src/pages/QuickChatRoot.tsx` 与 `GatewayClientLease.ts`：独立 Quick Chat WebView 的
  仅连接租约。
- `src-tauri/src/lib.rs`、`src-tauri/src/commands/gateway.rs`、
  `src-tauri/src/commands/ensure.rs`、`src-tauri/src/state/gateway_process.rs`：Tauri
  command 注册、运行时选择、进程所有权和全局操作锁。

### OpenClaw 官方依据

- 官方 `docs/gateway/protocol.md`：Gateway 先发送 `connect.challenge`；客户端首帧
  必须为 `connect`；`hello-ok` 返回协商协议、方法、事件、身份和连接策略。
- 官方 `packages/gateway-protocol/src/schema/frames.ts`：`ConnectParamsSchema` 和
  `HelloOkSchema` 的结构契约。
- 官方 `docs/cli/gateway.md`：`openclaw gateway run`、`restart`、运行时绑定和认证
  约束。

官方源码用于核对协议与平台生命周期语义；JunQi 在实际运行时仍以当前 Gateway
`hello-ok.features.methods`、协商协议、认证结果和已选择运行时为准，不能把源码主干
或本机环境假定为所有用户的可用能力。

## 生命周期图谱

### 主窗口

1. Tauri 启动时在 `src-tauri/src/lib.rs` 注册 `gateway_status`、
   `probe_selected_gateway`、`ensure_gateway_running`、`restart_gateway`、
   `stop_gateway` 等 command，并持有 `GatewayProcess`。
2. 已完成安装校验后，`App` 安装 Gateway 回调、订阅 `GatewayConnectionManager` 状态，
   调用 `gatewayManager.init()`，再回放已有 socket 状态。
3. `gatewayProcessObservation` 先读取 `gateway_status`，再只对当前选择运行时执行
   `probe_selected_gateway`。进程存活和已认证端点就绪是两个不同事实。
4. 连接管理器把观察结果送入状态机。就绪时通过目标解析器读取当前选择运行时的连接
   目标和凭据，再调用 `gateway.connect`；观察本身不启动进程。
5. `Connection` 接收 `connect.challenge` 后构造 `connect` 请求。仅在收到并校验
   `hello-ok` 后，主窗口把状态投影为已连接，并开始读取会话、模型和运行时数据。
6. WebSocket 关闭时，连接层清理临时投影、作废运行时身份、拒绝悬挂请求，并按策略
   重试。主窗口向状态机报告关闭；正常恢复的最终事实仍以新的握手和已认证探测为准。

### 冷启动与人工恢复

1. `App` 的冷启动 effect 先观察当前选择 Gateway。
2. 已就绪时只请求 WebSocket 重连；未就绪时调用 `ensure_gateway_running`。
3. `ensure` 失败后才通过 `GatewayLifecycleCoordinator` 请求重启。
4. Rust 侧的 `GatewayProcess.operation_gate` 串行化 ensure、start、restart、stop、
   Native/Docker 切换及存储迁移，避免两个前端请求同时变更同一运行时。
5. 重启完成后，前端仍须等待新的 WebSocket `hello-ok`。进程或 service command 返回
   成功不等同于客户端已完成协议握手。

### Quick Chat 与可选路由

- Quick Chat 是 Rust 创建的独立 Tauri WebView，`QuickChatRoot` 只获取连接租约；它
  没有启动、重启、恢复 Gateway 的 API。该 WebView 与主窗口各自拥有 JavaScript
  运行时，因此其 `setCallbacks` 不会覆盖主窗口 WebView 中的 callback。
- `/openclaw-commands` 等 Gateway 可选路由允许离线呈现页面，但不会关闭主窗口的
  全局冷启动恢复。进入该页面时仍看到“连接中”是当前产品行为，而非路由自身发起了
  另一套 Gateway 启动逻辑。

## 所有权与状态边界

| 范围 | 唯一事实来源 | 可执行动作 | 不可替代的完成条件 |
| --- | --- | --- | --- |
| 运行时选择 | Rust 路径和运行时身份 | Native 或 Docker 的受控操作 | 不得静默切换运行时 |
| 进程和 service 所有权 | `GatewayProcess`、`operation_gate`、已认证探测 | ensure、restart、stop、官方 service handoff | 不能用端口存活代替选定状态目录的身份 |
| WebSocket 连接 | `Connection` 和 OpenClaw 握手 | connect、断线重试、凭据更新 | `hello-ok`、协商协议、角色和 scope 已确认 |
| UI 连接状态 | `chatStore` 和连接管理器快照 | 呈现、通知、加载数据 | 不得将“进程已启动”显示为“已连接” |
| Quick Chat | 独立 WebView 的 `GatewayClientLease` | 仅连接和释放本窗口 socket | 不得接管主窗口的进程恢复 |

## 已验证结论

1. Rust 侧 mutating command 共用 `operation_gate`。`gateway_status` 在该锁被占用时
   保持观察语义，不会以过期查询结果覆写 `Starting` 或 `Reconnecting`。
2. 进程观察调用 `gateway_status` 后再调用 `probe_selected_gateway`；后者验证的是当前
   选择运行时的认证端点，不是任意监听同一端口的 TCP 服务。
3. 前端恢复协调器按 `reconnect`、`recover`、`restart` 强度合并并升级并发请求；Rust
   侧仍是最终的互斥和运行时所有权边界。
4. 当前精确代码中 `aegis:manual-reconnect` 监听器只注册一次，cleanup 也对应移除一次。
   早期并行输出中的重复片段不是当前代码问题。
5. OpenClaw 协议要求客户端在每次连接后重新读取 `hello-ok` 的方法、事件和策略；
   JunQi 不能把历史能力缓存或开发机配置当作通用契约。

## 修复记录

### GW-LC-01：首次 Gateway 数据同步重置主 WebSocket

状态：已修复，待真实 Desktop 多平台验收

证据链：

1. `src/App.tsx` 以 Gateway 数据仓库的 `lastFetch.sessions` 和
   `lastFetch.agents` 派生 `gatewayBootstrapDataReady`。
2. `markInitialWorkspaceDataReady` 依赖该布尔值，因此布尔值首次变化时该 callback
   的函数身份会变化。
3. 主 Gateway 初始化 effect 把该 callback 列入依赖数组；该 effect 的 cleanup 调用
   `gatewayManager.destroy()`，后者会主动 `gateway.disconnect()`。
4. 成功的 `setSessions` 与 `setAgents` 分别写入上述两个 `lastFetch` 时间戳。主连接
   成功后会话读取会触发该数据路径，因此正常首次数据水合可触发 effect 重建。

影响：首次认证 socket 建立并开始拉取会话、Agent 数据后，React 会执行一次旧 effect
cleanup，主动关闭 socket，再安装 callback 和状态订阅并重新连接。这个额外重连会干扰
首屏加载、语音状态和连接状态提示；它不是 OpenClaw 要求的恢复步骤。

修复：新增 `src/runtime/workspaceBootstrapReadiness.ts`。主窗口持有该协调器的稳定
实例，Gateway 数据就绪变化只调用 `updateGatewayDataReady`；
`markInitialWorkspaceDataReady` 保持稳定引用。主 Gateway 初始化 effect 不再因首批
会话或 Agent 快照到达而执行 cleanup。

自动化验证：`workspaceBootstrapReadiness.test.ts` 覆盖首批数据水合后的单次放行、
后续快照更新不重复放行，以及失败放行后的 reset 语义。仍须在真实 Tauri Desktop
窗口中验证首次 socket 不会被额外关闭或重新创建。

本次已执行并通过：目标回归测试、`pnpm lint`、`cargo check --lib`、`pnpm test`、
`pnpm build`、`pnpm verify:openclaw-docs` 与 `git diff --check`。完整测试存在既有的
SSR `useLayoutEffect` 警告，但没有测试失败。

## 未验证边界

- 未执行真实 Tauri Desktop 窗口冷启动，未连接实际 Gateway，未读取或写入用户凭据。
- 未在 Windows Scheduled Task、macOS launchd/Keychain、CentOS 或 Ubuntu systemd、
  Docker Desktop 冷启动环境中运行本次分支。
- 未把官方源码工作副本的当前主干视为 JunQi 已安装 Gateway 的版本承诺；运行时功能仍
  必须由实际握手和官方文档共同确认。

## 与历史审计的关系

`openclaw-gateway-lifecycle-audit.md` 和
`openclaw-gateway-service-ownership-audit.md` 保留了当时提交的缺陷和修复背景。本文件
只陈述 `8dc1b72d` 的当前代码事实；历史文档中的问题不得在未对照当前源码前直接当作
现状结论。

## 后续顺序

1. 运行相关前端测试、`pnpm lint`、`pnpm build`、`cargo check --lib` 和
   `git diff --check`。
2. 在 macOS、Windows、CentOS/Ubuntu 上分别完成真实 Desktop 冷启动、已运行 Gateway
   重连、系统服务恢复和 Docker 运行时验收，并在验证记录中区分自动化与真机结果。
