# 运行时调整恢复审计

日期：2026-08-12

## 官方依据

- OpenClaw 官方 Gateway 生命周期由 `gateway status`、`gateway stop`、`gateway start` 和 `gateway restart` 管理。
- 本轮重新拉取 OpenClaw 官方仓库主线提交 `cbe5634a299a9375ab544ff4cfc264d7b2c8b994`，并核对该提交的 [Gateway 服务命令文档](https://github.com/openclaw/openclaw/blob/cbe5634a299a9375ab544ff4cfc264d7b2c8b994/docs/cli/gateway/service.md)和停止命令注册源码。主线明确要求非交互式 `gateway stop` 使用 `--force`，并继续区分受管服务停止与 `gateway run --force` 的端口监听者清理；JunQi 不能把后者当成恢复期通用杀进程接口。目标环境实测的 OpenClaw CLI 会明确拒绝 `gateway stop --force`，因此 JunQi 先以只读的 `gateway stop --help` 读取该运行时发布的参数契约，再且只再执行一次匹配的停止命令；不根据版本号推断，也不在副作用未知后换参数重放。
- 同一官方主线的 [卸载与手工服务清理文档](https://github.com/openclaw/openclaw/blob/a1b4f6f917240e1dadd5f1096ea67347620571aa/docs/install/uninstall.md) 给出无 CLI 时的正式服务痕迹：macOS 默认 LaunchAgent 为 `~/Library/LaunchAgents/ai.openclaw.gateway.plist`，Linux 默认用户单元为 `~/.config/systemd/user/openclaw-gateway.service`，Windows 为计划任务或 Startup 回退。Node.js 不兼容时只能据这些平台痕迹判断服务是否存在，不能把 OpenClaw CLI 无法启动直接解释为“已安装服务”。
- Windows 终止路径核对 [Microsoft taskkill 文档](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill)：`/T` 终止目标及其子进程，`/F` 才表示强制结束。JunQi 先尝试不带 `/F` 的退出，等待并重新核验身份后才使用带 `/F` 的既有进程树终止入口。
- macOS 默认使用 LaunchAgent，桌面应用不是 Gateway 的父进程；替换应用不会卸载或终止官方服务。
- 服务名称不是充分的所有权证据。JunQi 只有在状态目录、配置路径和运行时身份与所选环境一致时才可执行生命周期变更。

## 根因

JunQi 的运行时调整事务在创建时保存 Gateway 与官方服务快照。应用异常退出或服务状态随后变化时，恢复逻辑仍直接使用旧布尔值。当前实测事务记录服务未安装且未运行，但 `ai.openclaw.gateway` LaunchAgent 实际持续监听 18789。恢复过程没有停止该服务，却等待端口释放，因此每次都在 30000 毫秒后失败。

## 目标行为

- 恢复前使用事务保存的旧启动契约；没有旧契约时使用当前经过兼容性检查的 OpenClaw 运行时。
- 通过官方 `gateway status` 重新核验服务归属和当前状态。
- 每次停止前先读取同一已核验运行时的 `gateway stop --help`。帮助契约声明 `--force` 时用于非交互停止；未声明时使用该运行时的裸 `gateway stop`。帮助读取失败则停止操作，停止命令本身只执行一次。
- 真实服务事实与事务快照合并后用于恢复旧服务状态；当前实际存在的匹配服务通过官方停止入口处理。
- 常规自动恢复遇到外部、归属不明或无法核验的服务时保持失败关闭，不按端口或进程名称自行终止。
- 用户明确选择“关闭进程并恢复”时，JunQi 只读取当前恢复事务绑定的端口，展示脱敏后的进程名和 PID，并在执行前重新核对端口、PID、进程启动代次和当前用户。先请求正常退出，超时后才强制结束；占用者变化、跨用户、当前 JunQi 自身或无法再次核验时立即停止，不向新进程扩散终止动作。
- 端口释放后在同一个 Gateway 生命周期锁内继续恢复；不能把终止请求成功等同于恢复成功。
- 端口释放、旧布局恢复、服务恢复和 Gateway 健康均核验后才清除持久化事务。
- 数据位置确认遇到已安装 OpenClaw 但 Node.js 不兼容时，先读取当前平台的官方服务痕迹、JunQi 自有进程状态和目标端口。真实数据迁移还必须核验 Docker 残留；当前位置仅调整 Native 依赖时不会移动 Docker 挂载或改变容器，因此不要求 Docker 守护进程在线。只有当前操作范围内的证据均证明没有需保护的运行时，才允许进入后续 Node.js 自动修复；服务存在、证据无法核验、端口被占用或仍有恢复事务时继续失败关闭。
- 恢复路径成功启动并完成 Gateway 认证与运行时身份核验后，安装步骤必须一次性进入终态。Native 路径将已证明可运行的 Node.js、OpenClaw 和 Gateway 标为完成；本次未参与安装的 npm 标为已跳过，既有 npm 完成事实继续保留。不得在成功摘要旁保留旧的“进行中”或“等待中”状态。

## 当前验证边界

- 本机已复现 macOS LaunchAgent 与旧事务快照不一致的故障。
- 恢复入口现在先从事务指定的 npm 前缀解析原 OpenClaw 运行时，再通过官方服务状态与配置归属重新核验 LaunchAgent；核验事实会在停止服务前写回持久化事务。
- 自动化已覆盖快照未记录服务、恢复时发现匹配服务，以及当前服务缺失时保留原恢复契约的合并规则。
- 本机替换应用后，旧 `candidate_active` 事务已清除，旧布局已恢复；`ai.openclaw.gateway` 由官方 LaunchAgent 恢复运行，`gateway status --json` 返回配置存在、配置有效且 RPC 核验成功。
- Windows Scheduled Task 与 Linux systemd user service 使用相同结构化状态与归属判据，但仍需目标平台真机验证。
- macOS 无可执行 OpenClaw 的前置核验已增加 LaunchAgent 文件和 `launchctl list` 双证据；Linux 增加用户或系统 unit 文件与 `systemctl --user list-unit-files` 双证据；Windows 继续使用计划任务和 Startup 登录项。自动化覆盖解析和失败关闭判据，macOS 当前桌面需继续实测从数据位置进入 Node.js 安装，Linux 与 Windows 仍需目标平台真机验证。
- macOS 受控监听测试已证明端口探针能识别测试进程 PID 且拒绝终止 JunQi 自身；另一项独立受控进程测试已走完识别、身份参数提交、正常终止和端口释放。真实用户确认后的完整运行时恢复仍需当前桌面窗口操作验证。Windows `netstat`、Linux `ss` 和相应终止路径只有解析、权限与编译验证，仍需目标平台真机验证。
- 当前 macOS 真机在 Node.js 修复后进入官方服务停止，目标 CLI 明确拒绝 `--force`，证明固定采用主线参数不能覆盖该运行时。帮助契约参数选择回归与 Rust 编译已经通过；修复后的单次停止、布局恢复和 Gateway 健康仍需重启后的桌面窗口复测。
- 当前 macOS 真机已越过服务停止与恢复，取得“Gateway 连接与运行时身份已核验”终态，证明运行时恢复主链路成功。该次界面同时暴露 Node.js 仍为进行中、npm 仍为等待中的旧投影；原子终态收敛已增加纯函数回归，修复后视觉状态仍需下一次真实启动核对。
