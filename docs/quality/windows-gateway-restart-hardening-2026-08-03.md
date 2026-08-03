# Windows Gateway 重启等待契约加固

日期：2026-08-03

## 依据

本机锁定的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。该版本的官方 CLI 源码
`lifecycle-yIOsvBfe.js` 将 Windows `gateway restart` 的重启后健康检查上限设为
180 秒（`WINDOWS_POST_RESTART_HEALTH_TIMEOUT_MS = 180000`）。JunQi 的
`restart_gateway` 之前只等待 45 秒回收 `openclaw gateway restart` CLI 进程，两个
契约不一致。

## 当前行为

Native 重启先通过 `gateway status --json --no-probe` 核对选定 state/config/runtime
的服务归属。只有确认服务属于当前选定配置时，才调用官方 `gateway restart`；Foreign、
Unverifiable 和检查失败均直接报错，不启动竞争的桌面托管进程。重启完成后还会用选定
配置的 token/RPC 重新核对端点身份，并再次读取官方服务状态。

## 修复行为

`src-tauri/src/commands/gateway.rs` 新增
`native_gateway_restart_command_timeout_secs()`。外层等待上限复用 Native Gateway
冷启动就绪预算：Windows 为 210 秒，其他平台为 180 秒，覆盖 OpenClaw 官方 Windows
180 秒健康检查及服务启动开销，不再用固定 45 秒提前杀掉 CLI。

同一条链路还根据 `gateway status --json --no-probe` 返回的服务运行状态处理官方
Scheduled Task：已运行的选定服务执行 `gateway restart`；已安装但明确停止的选定任务不再
调用 OpenClaw 的 `gateway start`。本机 `2026.7.1-2` 的 `gateway start` 在服务已注册时
仍会进入同一个 `restartRegisteredScheduledTask`，而该实现先执行 `/End`，对已停止任务会
在真正启动前失败。JunQi 只在服务身份、运行态都已确认且任务注册存在时，直接对该选定
任务执行 Windows `schtasks /Run`；任务不存在时才保留 OpenClaw 的启动命令作为官方登录项
回退。运行态为 unknown、任务注册不可验证或身份不匹配时全部失败关闭。只有端点已就绪、
服务仍属于选定 state/config/runtime 且官方运行态为 running，才会向前端报告重启成功，
从而排除旧进程短暂占用端口或任务实际停止导致的假成功。

这只延长 JunQi 对官方 CLI 的等待，不改变服务归属、端口、token 或 runtime 选择，也
不会把选定服务失败静默降级为桌面子进程。如果重启后服务状态无法再次证明为选定且运行中，
JunQi 会保持失败状态，不会把仅有端口健康误报为成功。

## 验证

- Rust 单元测试覆盖重启 CLI 等待上限必须覆盖 Native 服务就绪契约。
- `gatewayRecoveryRegression.test.ts` 固定必须使用平台就绪预算，禁止恢复固定 45 秒
  超时，并固定重启成功前必须重新核对官方服务运行态。
- Windows Scheduled Task 的实际冷启动、权限、杀毒软件和用户登录态仍需在 Windows
  真机验收；当前开发机未运行 Windows Task Scheduler。
