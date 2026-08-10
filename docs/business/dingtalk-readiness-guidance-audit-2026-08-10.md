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
- 2026-08-10 通过 npm 官方 registry 复核当前发布包 `dingtalk-workspace-cli@1.0.57`，其 `bin.dws` 指向
  `bin/dws.js`。该版本仅用于记录本次验证范围，不作为能力开关；Native 调用因此绑定 npm 包入口并由所选
  Node.js 直接执行，不假定 Windows 存在 `dws.exe`。

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

## Gateway 重连与 DWS 安装复核

本机复现表明，Gateway 进程在约 17.9 秒后已成功恢复，但钉钉业务页直接调用底层进程重启，WebSocket 的普通
重试在服务恢复前耗尽。后续 60 秒循环只观察连接，没有主动发起新连接，因此超时文案错误地掩盖了连接生命周期
缺口。业务页现统一通过 `GatewayLifecycleCoordinator` 重启；协调器在所选运行时恢复后主动重连，并以新的
connection ID、官方 `hello-ok` 和 Runtime Identity 作为全局完成门禁。钉钉页面不再维护私有 60 秒轮询，
只在统一生命周期返回成功后刷新 Session 工具、插件与 DWS 状态。

DWS 安装也不再以 npm 进程退出成功作为完成条件。Native 安装使用 JunQi 已选择的 Node.js 及其配套 npm CLI，
绑定该运行时报告的绝对全局 prefix；安装后由所选 Node.js 直接执行该 prefix 下的准确 npm `bin/dws.js` 入口完成
JSON 版本核验，避免 Windows `dws.cmd` 的 shell 调用与参数注入。核验通过后，前端按官方 `config.get`、`hash`、
`config.patch` 契约把准确绝对入口写入 `plugins.entries.junqi-dingtalk.config.dwsPath`，
再通过统一生命周期重启和重连。Docker 安装在所选容器内执行并在同一容器内进行 JSON 核验，不向宿主插件配置写入
容器路径。授权完成后额外执行 `dws auth status --format json`，不能以登录进程退出成功推断授权有效。

安装、授权、重连、身份卡和接入检查的用户可见状态已接入简体中文、繁体中文和英文资源。Rust 诊断仍只作为
受控操作输出，不作为成功投影。已复核 `docs/previews/junqi-first-run-flow.html`：DWS 属于完成 OpenClaw 首次设置后的
业务运行时接入，不改变首次启动步骤，因此本次无需修改该预览。

## 未验证边界

- 尚未在真实钉钉租户完成浏览器扫码与 Profile 返回。
- 尚未在 Docker 真机核验设备码授权输出。
- 尚未完成 Windows 和 Linux 桌面浏览器唤起与视觉验收。
- 尚未在 Native、Docker 真实安装过程中验证 npm 包下载、DWS JSON 版本核验和插件路径热重载后的完整桌面闭环。
