# Windows OpenClaw Gateway 重启规格

日期：2026-08-03

## 依据

- 本机安装的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。
- 官方 Windows service 实现使用 Scheduled Task；`gateway restart` 先执行
  `/End`，再执行 `/Run`。当前版本的 `gateway start` 对已注册任务也复用该 restart
  路径，因此已停止任务不能依赖 `gateway start`。
- 官方 `gateway status --json --no-probe` 提供服务归属、安装状态和运行状态；
  JunQi 还需要用选定配置的 token/RPC 验证 Gateway 端点。

## 当前行为

Native 重启先校验服务属于当前选定的 state/config/runtime。已运行服务使用官方
`gateway restart`；已安装且明确停止的 Windows Scheduled Task 在任务身份和注册状态
再次核验后使用 `schtasks /Run`，没有该任务时才使用官方登录项启动回退。运行态为
unknown 时不执行生命周期命令。命令成功后等待选定端点通过 liveness 与鉴权检查，再
重新读取服务状态。

## 完成条件

只有以下条件全部满足，`restart_gateway` 才返回成功：

1. 官方服务命令退出成功。
2. 选定端点在平台就绪预算内可访问，并接受选定配置的凭据。
3. 重读的官方服务仍已安装、属于选定 state/config/runtime，且运行态为 `running`。

服务归属不可验证、端点健康但服务停止、服务仍指向旧 runtime/locale，均返回失败，
不静默启动桌面托管 Gateway 或其他 runtime。

## 验证边界

- 已通过 Rust Gateway/Gateway service 单元测试、TypeScript Gateway 回归测试、
  TypeScript 类型检查、Rust 格式检查和 `git diff --check`。
- 当前开发机不是 Windows，未执行真实 Scheduled Task、UAC、杀毒软件、登录态和冷启动
  验收；这些边界仍待 Windows 真机验证。
