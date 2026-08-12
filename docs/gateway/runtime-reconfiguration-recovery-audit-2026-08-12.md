# 运行时调整恢复审计

日期：2026-08-12

## 官方依据

- OpenClaw 官方 Gateway 生命周期由 `gateway status`、`gateway stop`、`gateway start` 和 `gateway restart` 管理。
- macOS 默认使用 LaunchAgent，桌面应用不是 Gateway 的父进程；替换应用不会卸载或终止官方服务。
- 服务名称不是充分的所有权证据。JunQi 只有在状态目录、配置路径和运行时身份与所选环境一致时才可执行生命周期变更。

## 根因

JunQi 的运行时调整事务在创建时保存 Gateway 与官方服务快照。应用异常退出或服务状态随后变化时，恢复逻辑仍直接使用旧布尔值。当前实测事务记录服务未安装且未运行，但 `ai.openclaw.gateway` LaunchAgent 实际持续监听 18789。恢复过程没有停止该服务，却等待端口释放，因此每次都在 30000 毫秒后失败。

## 目标行为

- 恢复前使用事务保存的旧启动契约；没有旧契约时使用当前经过兼容性检查的 OpenClaw 运行时。
- 通过官方 `gateway status` 重新核验服务归属和当前状态。
- 真实服务事实与事务快照合并后用于恢复旧服务状态；当前实际存在的匹配服务通过官方停止入口处理。
- 外部、归属不明或无法核验的服务保持失败关闭，不按端口或进程名称强制终止。
- 端口释放、旧布局恢复、服务恢复和 Gateway 健康均核验后才清除持久化事务。

## 当前验证边界

- 本机已复现 macOS LaunchAgent 与旧事务快照不一致的故障。
- 恢复入口现在先从事务指定的 npm 前缀解析原 OpenClaw 运行时，再通过官方服务状态与配置归属重新核验 LaunchAgent；核验事实会在停止服务前写回持久化事务。
- 自动化已覆盖快照未记录服务、恢复时发现匹配服务，以及当前服务缺失时保留原恢复契约的合并规则。
- 本机替换应用后，旧 `candidate_active` 事务已清除，旧布局已恢复；`ai.openclaw.gateway` 由官方 LaunchAgent 恢复运行，`gateway status --json` 返回配置存在、配置有效且 RPC 核验成功。
- Windows Scheduled Task 与 Linux systemd user service 使用相同结构化状态与归属判据，但仍需目标平台真机验证。
