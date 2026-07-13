# Gateway 单核心状态流转规格

## BUG-GSC01 · 唯一前端编排入口

**目标**：所有 Gateway 生命周期事实和意图经过 `GatewayConnectionManager.dispatch`。

**验收**：

- [x] Manager 中只有 dispatch 调用 FSM transition 和 emit。
- [x] App 不再直接组合 disconnect + ensure/retry + reconnect。
- [x] 手动恢复、启动恢复、配置变更、配对完成及首次安装均调用 Manager 的语义化薄封装。

## BUG-GSC02/03 · 一致状态快照

**目标**：进程状态、重启状态和 WebSocket 状态按固定优先级转换。

**验收**：

- [x] CONNECTED + running=false 离开 CONNECTED。
- [x] CONNECTED + error 进入 ERROR。
- [x] 任意状态 + retrying 进入 DETECTING，且快照不再 connected。
- [x] CONNECTED + running=true 保持 CONNECTED，不重复连接。

## BUG-GSC04 · Rust 原子 canonical 状态

**目标**：lifecycle 与 mode 原子读写，源码结构阻止旁路。

**验收**：

- [x] lifecycle/mode 存在同一个私有 Mutex 中。
- [x] 只有 `GatewayProcess::transition` 写入该状态。
- [x] 诊断快照从同一次锁读取 lifecycle 与 mode。
- [x] 子进程退出、外部端口发现、start/restart/stop/ensure/docker/update/storage 全部使用该入口。

## BUG-GSC05/06 · 主动恢复与回归证明

**目标**：恢复请求立即工作，并有行为测试覆盖原缺陷。

**验收**：

- [x] reconnect/retry 会失效旧异步任务并立即探测。
- [x] 每个 BUG 至少一个能在修复前失败的回归测试。
- [x] 完整前端和 Rust 测试、边界检查、生产构建通过。
- [x] 临时应用标识下的真实 Tauri 开发版成功启动并观察到健康 Gateway；未关闭正在运行的正式版。
- [x] 断开、进程离线、错误、重试、重连和重启提交由行为测试与旁路扫描覆盖。

## 验证记录

- 前端：567 项测试通过；边界测试 15 项通过。
- Rust：186 项通过，2 项环境集成测试按预期忽略。
- 构建：`npm run build`、`npm run lint`、`cargo check`、`cargo fmt --check` 通过。
- 运行时：以 `com.junqi.desktop.gateway-audit` 临时标识启动真实 Tauri 开发二进制；进程持续运行，OpenClaw Gateway 在 `127.0.0.1:18789` 健康响应。
- 保护：没有关闭正式版 JunQi，也没有为了验证而重启其共享 Gateway。
