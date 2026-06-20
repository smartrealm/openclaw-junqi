# 远程终端 / Agent 架构移植计划

> 状态：**待实现**（规划阶段）
> 来源：参考 nezha dashboard `service/rpc/io_stream.go` + `cmd/dashboard/controller/terminal.go`
> 目标：让 junqi-desktop 能连接部署在**远程服务器**上的 nezha agent，获得远程 Web 终端 + 远程文件管理能力。
> 本地 PTY 后端（已实现的 `terminal.rs`）保留不动，作为离线/本机回退。

---

## 0. 背景：为什么现在没有远程

junqi-desktop 当前的终端是**纯本地**的：
- `src-tauri/src/commands/terminal.rs` —— `portable-pty` 直接在本机开 shell
- 渲染层走 Tauri IPC（`invoke` + `emit`），不经过网络

已完成的第一步移植（commit `93d80ea`）只抄了 nezha 的 **session 管理模型**（`IoStreamContext` / 流限额 / 双向复制 / 关闭语义），**没有网络层**，因为没有远程 agent 可连。

本计划补上网络层 + agent 协议，实现真正的"连远程机器开终端"。

---

## 1. 目标架构

```
junqi-desktop 渲染进程
   │  (xterm.js)
   ▼
window.aegis.terminal.write / onData
   │
   ▼  ┌─────────────────────────────────────────┐
src-tauri (Rust)                          │
   │                                       │
   ├─ 本地路径 (已实现)                      │
   │   terminal_create → portable-pty       │
   │                                       │
   └─ 远程路径 (本计划)                      │
       terminal_connect(host, token)        │
         → gRPC 连远程 nezha agent           │
         → RequestTask 下发 TerminalGRPC      │
         → 等 agent IOStream dial 回来        │
         → 双向 io::copy (已移植的模型)        │
                                          │
                          远程服务器          │
                          ┌──────────┐       │
                          │ nezha    │       │
                          │ agent    │       │
                          │ (PTY)    │       │
                          └──────────┘       │
                          └─────────────────┘
```

**关键点**：渲染层 `TerminalPage` 完全不用改 —— 它只认 `create/write/resize/kill + onData/onExit` 这套契约。后端根据 tab 类型（local / remote）路由到不同的 session 实现，复用同一套 `IoStreamContext`。

---

## 2. nezha 的远程终端协议（要照抄的）

### 2.1 gRPC 双向流（`proto/nezha.proto`）

```protobuf
service NezhaService {
  rpc RequestTask(stream TaskResult) returns (stream Task);   // 下发任务
  rpc IOStream(stream IOStreamData) returns (stream IOStreamData);  // 双向数据流
}
message Task { uint64 id = 1; uint64 type = 2; string data = 3; }
message IOStreamData { bytes data = 1; }
```

### 2.2 建立终端会话的三步握手（`terminal.go` + `io_stream.go`）

1. **dashboard 创建 stream**：`CreateStream(streamId, user, server)` —— 分配 UUID，登记到 `ioStreams` map，做流限额检查（20/user、40/server）。
2. **dashboard 下发任务**：`server.SendTask(&Task{Type: TaskTypeTerminalGRPC, Data: {streamId}})` —— 通过 `RequestTask` 流告诉目标 agent "给我开个终端，关联这个 streamId"。
3. **agent dial 回来**：agent 收到任务后，用 `IOStream` RPC 建立到 dashboard 的双向流，dashboard 侧 `AgentConnected(streamId, agentIo)` 登记 agent 端的 IO 端点。
4. **双向复制**：`StartStream` 里起两个 goroutine `io.CopyBuffer`，把 user 端 WebSocket 和 agent 端 gRPC 流对接。user 端 WebSocket 由 `terminalStream` controller 升级 HTTP 连接得到。

### 2.3 安全模型（必须照抄，否则 = RCE）

- **streamId 只对创建者 + admin 可见**（`IsStreamAuthorizedForUser`）—— 任何学到 streamId 的认证用户都能劫持终端拿到 shell。
- **agent 侧归属校验**（`IsStreamAuthorizedForAgent`）—— 只有 dashboard 选定的那台 server 的 agent 才能 `IOStream` 接入，防止别的 agent 抢答别人的终端流。
- **PAT server 白名单二次校验**（`StreamTarget` + `CanAccessServer`）—— admin 的受限 token 也不能越权。
- **`ff05ff05` magic marker** —— IOStream 握手首 4 字节，区分协议帧。

> ⚠️ 单机桌面应用 = 单用户，creator/user 授权模型大幅简化（只有"本机用户"一个主体）。但 agent 归属校验 + token 传输加密**不能省**——因为要连的是远程机器，凭证会过网络。

---

## 3. 实现拆解（任务清单）

### 阶段 A：gRPC 客户端层（连远程 agent）

- [ ] **A1**. 引入 Rust gRPC 栈。候选：`tonic` + `prost`（nezha 用的是 Go gRPC，Rust 侧 tonic 是事实标准）。定义 `nezha.proto` 的 Rust 镜像（Task / IOStreamData / Host / State）。
- [ ] **A2**. 实现 agent 连接管理：`AgentClient { host, port, secret }`，维护到 agent 的 gRPC 长连接 + `RequestTask` 流。支持多 agent（一个 host 列表）。
- [ ] **A3**. agent 凭证存储：agent 的 `ClientSecret` / 地址存到 `aegis-config.json`，加密 at rest（参考现有 secrets 管理）。

### 阶段 B：远程终端 session（复用已移植的 IoStreamContext）

- [ ] **B1**. `terminal_connect_remote(agent_id) -> { id }`：创建 streamId → `CreateStream` → 下发 `TaskTypeTerminalGRPC` → 等 `AgentConnected` → 把 agent 的 gRPC IOStream 包成 `Box<dyn ReadWriteCloser>`，塞进现有 `IoStreamContext` 的 reader/writer 线程。
- [ ] **B2**. 复用 `pty_reader_thread` / `pty_writer_thread`：它们只认 `Box<dyn Read>` / `Box<dyn Write>`，把 gRPC stream 适配成这俩 trait 即可，**线程代码零改动**（这就是当初抽象的好处）。
- [ ] **B3**. `resize` 远程：把 cols/rows 编进 IOStream 首帧或单独 task 下发给 agent。

### 阶段 C：渲染层（几乎不改）

- [ ] **C1**. `TerminalPage` 新建 tab 时，tab 类型区分 `local` / `remote:agentId`。`createTab(opts?)` 把 `opts.agentId` 透传给后端，后端路由到本地或远程实现。
- [ ] **C2**. agent 选择 UI：tab 栏 "+" 旁边加一个"远程"入口，弹出已配置的 agent 列表。

### 阶段 D：安全 + 凭证（不可跳过）

- [ ] **D1**. agent 归属校验：连上后校验 agent 上报的 serverId 与 stream 目标一致（`IsStreamAuthorizedForAgent` 的 Rust 版）。
- [ ] **D2**. gRPC over TLS：远程连接必须 TLS，拒绝明文。
- [ ] **D3**. 凭证轮换 UI：agent secret 过期/更换时的处理。

### 阶段 E（可选扩展）：照搬 agent 的其他能力

这些复用同一套 IOStream / RequestTask 通道，边际成本低：

- [ ] **E1**. **远程文件管理器**（`TaskTypeFM` + `FsList/Read/Write/Delete/Transfer`）—— nezha 的 fm.go，大文件走 IOStream 分块。
- [ ] **E2**. **远程命令执行**（`TaskTypeCommand`）—— 一次性跑命令回传 stdout，不开交互终端。
- [ ] **E3**. **系统监控仪表盘**（`ReportSystemState`）—— agent 持续上报 CPU/内存/网络，junqi-desktop 现有的 `system-metrics` 事件可直接对接渲染。**这个最简单、价值最高**，建议优先于终端实现。

---

## 4. 风险与决策点

| 决策 | 选项 | 倾向 |
|---|---|---|
| gRPC 库 | tonic vs 自研 WebSocket | **tonic**（nezha 原生 gRPC，互操作必须）|
| agent 发现 | 手动配置 vs mDNS | 手动配置（先简单）|
| 是否兼容官方 nezha agent | 严格按 proto vs 自定义协议 | **严格按 proto**（能直接连用户已部署的 nezha agent）|
| 本地/远程 tab 统一 | 同一 TerminalPage vs 分离页面 | **统一**（契约已对齐）|

**最大风险**：gRPC 跨语言（Go agent ↔ Rust tonic）的 IOStream 帧兼容性。nezha 用了 `ff05ff05` magic + 空帧 keepalive，Rust 侧必须精确复现，否则握手失败。需要对着真实 nezha agent 联调。

---

## 5. 不做什么（明确排除）

- ❌ **抄 nezha 的多租户/用户体系** —— 桌面应用单用户，creator/admin/PAT 那套授权降级为"本机用户即可"。
- ❌ **抄 dashboard 的 Web 服务** —— junqi-desktop 是桌面客户端，不做服务端，只做 agent 的客户端。
- ❌ **抄 nezha 的 server-transfer / NAT 穿透** —— 与终端无关，范围外。

---

## 6. 建议实施顺序

1. **E3（监控仪表盘）** —— 最简单、最快见效，先验证 gRPC 客户端层通不通。
2. **A1-A3 + B1-B3** —— 远程终端核心。
3. **D1-D3** —— 安全加固（可与 B 并行）。
4. **C1-C2** —— 渲染层接入。
5. **E1-E2** —— 文件管理、命令执行（锦上添花）。
