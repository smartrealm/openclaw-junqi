# Gateway 生命周期统一验证记录

日期：2026-08-10

## 协议依据

- OpenClaw 官方 [Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 规定客户端完成 challenge 与
  `connect` 后由 Gateway 返回 `hello-ok`，其中 `server.connId`、协议、功能、快照、认证角色与 scope 属于握手结果。
- OpenClaw 官方 [Embedding OpenClaw](https://docs.openclaw.ai/gateway/embedding) 明确把 `hello-ok` 作为认证 RPC 的
  应用就绪条件。JunQi 因此不能把进程命令退出或端口健康单独视为连接完成。
- 本轮在 2026-08-10 重新核对上述最新版官方页面；本地安装版本只用于测试当前实现，不作为能力开关。

## 根因

全局协调器此前只等待进程命令与所选端点探测，随后立即返回成功。新的 WebSocket `hello-ok` 和 Runtime
Identity 仍在异步建立，导致钉钉业务页另建 60 秒轮询，而渠道、配置和设置页面可能提前提示重启完成。
此外，冷启动、命令面板、聊天断线恢复和设置停止仍存在直接 manager 或 IPC 调用，旧浏览器命令兼容桥与日志
文本进度推断继续保留了第二套入口和状态来源。

## 当前行为

- `gatewayLifecycle` 是普通恢复、重连、重启和停止的唯一前端入口。
- `GatewayLifecycleCoordinator` 记录操作前 connection ID；进程操作成功后等待不同的新 connection ID、当前
  连接围栏以及同一连接上的已验证 Runtime Identity。
- 钉钉工作台删除业务专属重连等待，只在统一结果成功后刷新工具、插件和 DWS 数据。
- 冷启动恢复直接调用统一 `recover`，命令面板与聊天断线入口不再直接调用 manager。
- 设置中的停止动作通过统一 `stop`，与其他生命周期请求共享串行化。
- `aegis:manual-reconnect` 命令兼容桥和无生产消费者的日志文本进度推断已删除。
- 边界扫描从 TypeScript AST 识别别名导入和方法调用，阻止普通代码重新绕过协调器。

## 事务例外

官方 Wizard 显式 Gateway 目标与凭据交接仍由 Setup 事务调用连接管理器；协作 bootstrap 与 OpenClaw 更新仍使用
其带操作身份、目标指纹和回滚语义的专用事务。这些不是普通页面重启入口，不能用全局协调器替代其事务字段。

## 自动化证据

- Gateway 连接收敛、协调器和连接管理器定向测试 25 项通过；边界扫描定向测试 9 项通过。
- `pnpm lint` 通过：模块边界扫描 931 个生产文件，四处版本一致，TypeScript 类型检查通过。
- 完整 `pnpm test` 通过；输出保留既有 Node `module.register()` 弃用提示和 Radix Tooltip 服务端渲染提示，
  没有测试失败。
- `pnpm build`、`pnpm dingtalk:validate` 与独立 Vite 生产构建通过。
- `pnpm test:rust` 通过：686 项通过、2 项忽略、零失败。
- `pnpm verify:openclaw-docs` 与 `git diff --check` 通过。

## 未验证边界

- 尚未在真实桌面进程验证 Native、Docker 和官方系统服务的重启后新握手。
- 尚未在 Windows、Linux 验证停止与重启行为。
- 尚未验证真实钉钉插件安装后 DWS Profile 是否在统一生命周期完成后立即刷新。

## 2026-08-11 仪表盘用量与轮询收敛

### 依据与根因

- 当前 Gateway 的官方 `usage.cost` 响应包含按日费用、Token 与 `missingCostEntries`；实测 30 天响应有
  30 个日期桶，其中 17 天存在非零费用，同时存在无法估价的历史调用。因此 Token 存在不等于费用可估价，
  JunQi 不得把未知费用显示为零费用。
- OpenClaw 官方 `sessions.usage` 会从会话存储、缓存和已发现的转录中聚合历史统计。它适合可见页面的
  历史分析，不应在用户离开页面后仍作为全局后台轮询持续读取。

### 当前行为

- Dashboard 首屏在费用请求尚未启动或尚未返回时显示加载态；只有收到真实空结果或错误后才展示对应状态。
- `cost` 与 `usage` 采用引用计数的页面级轮询：Dashboard、活动中心和已打开的智能体设置面板在可见期间
  保留读取，最后一个消费者离开后停止对应定时器。手动刷新仍只执行一次官方读取，不会意外常驻后台轮询。
- 会话列表不再将完整投影序列化为 JSON 来判断变化，而是逐字段比较 Gateway JSON 投影；无变化快照不会
  更新 Zustand 状态或触发订阅者重渲染。

### 自动化验证

- `gatewayDataStore` 定向测试覆盖相同会话投影不更新以及用量轮询仅在页面保留期间启动。
- 已运行 Dashboard 交互测试、`gatewayDataStore` 测试、TypeScript 类型检查和 `git diff --check`。

### 未验证边界

- 尚未在真实 macOS、Windows、Linux 桌面窗口持续运行后采集 WebView 帧率与 CPU 对比；该验证需要在目标
  平台安装包中进行，不能由当前源码测试替代。
