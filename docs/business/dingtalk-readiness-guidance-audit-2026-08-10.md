# 钉钉接入状态与授权引导审计

日期：2026-08-10

## 问题

- 插件状态尚未返回时，工作台把空状态提前解释为插件缺失或 Agent 未授权。
- 插件安装后重启 Gateway，页面没有等待新的连接身份，也没有按新连接自动重读 Session 工具和 DWS 身份。
- Agent 授权引导要求用户分别进入 Tools 和 Advanced 修改两处配置，缺少当前业务上下文内的受控入口。
- Native 与 Docker 都执行 `dws auth login --device`，没有使用 DWS 为本机桌面提供的浏览器扫码流程。

## 官方依据

核对 DWS 官方仓库提交 `2bc4ded969d752c20b78fc8599abee5001401df3`：

- `dws auth login` 是本机 OAuth Loopback 流，会打开浏览器并提示扫码授权。
- `dws auth login --device` 返回设备码和短链接，只用于 Docker、SSH 或无图形界面的运行时。

核对 OpenClaw 官方仓库提交 `79eb5bde433a8a50db932b430fffc8409caa18ad`，并与当前安装版本
`2026.7.1-2` 交叉复核：

- Agent 工具策略支持插件 ID 作为 allow 条目；`deny` 最终优先。
- `allow` 与 `alsoAllow` 不能在同一作用域同时新建；已有非空 `allow` 应追加，未设置 `allow` 时使用
  `alsoAllow` 保留默认工具面。
- 插件配置位于 `plugins.entries.<pluginId>.config`。
- 配置写入使用 `config.get` 返回的有效快照和原样 `hash`，再通过 `config.patch` 提交最小 patch。
- 当前主线使用 `agents.entries`；当前安装版本仍返回 `agents.list`。JunQi 只在快照已经证明对应结构且当前
  Agent 为显式条目时写入，不按版本号选择，也不创建猜测性的 Agent。

## 修复结论

- Native 授权改用 `dws auth login`；Docker 保持 `--device`。
- 插件状态增加明确的加载态，状态未返回前不判断插件缺失或 Agent 未授权。
- “配置授权”改成“一键授权当前 Agent”。一次带 `baseHash` 的最小 `config.patch` 同时更新当前 Agent
  工具策略和插件 `allowedAgentIds`，不覆盖其他 Agent、其他工具或插件配置。
- 显式 `deny`、缺少显式 Agent、未知 Agent 配置结构和未确认写入回执均失败关闭。
- 重启后必须观察到新的 Gateway connection ID，并等待 Runtime Identity 绑定该新连接；随后刷新 Session、
  `tools.effective`、插件状态和 DWS Profile。旧连接仍存活时不会提前显示成功。

## 未验证边界

- 尚未在真实钉钉租户完成浏览器扫码与 Profile 返回。
- 尚未在 Docker 真机核验设备码授权输出。
- 尚未完成 Windows 和 Linux 桌面浏览器唤起与视觉验收。
