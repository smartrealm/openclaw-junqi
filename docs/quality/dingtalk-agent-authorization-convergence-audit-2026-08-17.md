# 钉钉 Agent 授权收敛审计

日期：2026-08-19

## 依据

- OpenClaw 最新配置文档规定：非空 `tools.allow` 是严格白名单；`alsoAllow` 才是在既有 profile 上增加工具，二者不能在同一作用域同时存在。
- OpenClaw 最新 `config.patch` handler 支持按 `id` 合并配置数组；配置存在时必须携带 `config.get.hash`，并由 Gateway 返回的后续配置快照确认写入。
- JunQi 钉钉业务插件的 `allowedAgentIds` 是插件内第二道失败关闭门禁；空列表拒绝所有 Agent。

## 根因

旧的一键授权只更新当前 Agent 的 `tools.allow` 或 `tools.alsoAllow`，以及插件 `allowedAgentIds`。当全局 `tools.allow` 已存在且未包含 `junqi-dingtalk` 时，OpenClaw 仍会从当前 Session 的 `tools.effective` 过滤该插件工具。

后续发现，当前 Session 受 OpenClaw `sandbox.mode: "all"` 约束时，普通工具策略与插件 `allowedAgentIds` 即使都已写入，缺少 `agents.entries.*.tools.sandbox.tools` 的插件放行仍会在第二层 sandbox 工具策略中过滤插件工具。旧界面只看到运行时工具不存在，便把多种可能原因写成“当前 Agent 未授权”；该文案没有配置读取证据，属于错误归因。

## 目标行为

授权对话框默认选中当前 Session 的 Agent，并列出 Gateway 已发现的其他 Agent。用户可选择目标 Agent；调用前仍由 `config.get` 确认该 Agent 存在于显式配置中，不创建隐式 Agent。

一键授权在没有明确拒绝规则时，以一次带 `baseHash` 的最小 `config.patch` 同时处理：

- 全局工具策略；
- 当前显式 Agent 的工具策略；
- 当前 Session 实际受 `sandbox.mode: "all"` 约束时，该 Agent 的 `tools.sandbox.tools` 策略；
- `plugins.entries.junqi-dingtalk.config.allowedAgentIds`。

非空 `allow` 追加插件 id；缺失 `allow` 时追加 `alsoAllow`。空 `allow` 通过 Merge Patch 的 `null` 删除后改为 `alsoAllow`，避免把原本非限制性的空数组变成“只允许钉钉”的严格白名单。

sandbox 策略仅写入当前目标 Agent，使用 `agents.entries.*.tools.sandbox.tools.alsoAllow: ["junqi-dingtalk"]` 的等价最小 patch，不扩展其他 Agent。sandbox 的空 `allow` 保持 OpenClaw 的“允许全部”语义，不改写为限制性策略；全局或当前 Agent sandbox 明确拒绝钉钉时失败关闭。`sandbox.mode: "non-main"` 下，只有当前 Session 不是 OpenClaw 主会话时才写入该层；sandbox 未启用时不添加无效配置。

写入回执不是成功终态。JunQi 必须重新读取 `config.get` 并分别核验全局策略、目标 Agent 策略与插件 Agent 列表；重启和刷新后，只有目标就是当前 Session Agent 时，才能从同一 Session 的 `tools.effective` 确认未被拒绝的 `junqi_dingtalk_runtime_status`。选择其他 Agent 时，JunQi 只显示“配置已写入、Gateway 已重启，待目标 Session 核验”，不伪报有效工具已经出现。

`tools.effective` 缺少钉钉运行时工具只能证明当前 Session 的运行时工具投影尚未出现。页面改为显示这一事实，并指向 Gateway 重启后的重新检测、插件状态和 sandbox 策略核对；不再将快照缺失表述为 Agent 双重授权失败。

## 插件发现注册补充

OpenClaw 的正式插件注册模式除 `full` 外，还包含只读的 `discovery` 与面向可执行工具的 `tool-discovery`。这两种模式都会收集插件工具；它们不启动渠道运行时或其他长驻副作用。JunQi 钉钉插件此前只在 `full` 模式调用 `registerTool`，导致工具检查与部分运行时投影拿到空注册表，即使插件已安装、已启用、全局和 Agent 工具策略均允许，且 `allowedAgentIds` 已包含当前 Agent。

插件现在在 `full`、`discovery` 与 `tool-discovery` 三种官方模式注册同一组钉钉工具；`setup-only`、`setup-runtime` 与 `cli-metadata` 仍不注册。这个修改不改变工具权限、DWS 调用或渠道行为，只修复 OpenClaw 用于发现和投影工具的官方注册路径。

2026-08-19 的当前 macOS Gateway 实测中，`main` 已满足全局 `tools.alsoAllow`、Agent `tools.alsoAllow` 和插件 `allowedAgentIds` 三项配置。通过 OpenClaw 官方 `plugins install --force` 覆盖安装重建后的本地插件并重启 Gateway 后，`tools.effective(sessionKey: agent:main:main)` 返回 76 项工具，其中 `pluginId: junqi-dingtalk` 的工具为 33 项，包含未拒绝的 `junqi_dingtalk_runtime_status`。响应结构的工具列表位于 `groups[].tools`，不存在顶层 `tools` 字段；所有客户端判断必须基于该正式结构。

所有“重新检测”入口都收敛为同一次只读刷新：先读取当前 Session 的 `tools.effective`，再并行读取插件状态与受该快照约束的 DWS 身份。刷新期间按钮显示明确进行中状态，阻止重复刷新及与安装、重启、DWS 流程并发；异常保留在页面内联错误区域。

## 授权后的 Gateway 重启与工作区放行

钉钉授权写入完成后，页面只经 `gatewayLifecycle.restart` 请求一次统一生命周期操作。协调器负责停止或重启、认证连接、所选运行时身份核验；成功后业务页才刷新全局数据、当前 Session 的 `tools.effective`、插件状态和 DWS 身份。业务页不直接管理 Gateway 进程，也不把端口可用视为授权成功。

重启会触发数据层重新取得当前连接的会话快照。工作区首屏门禁以该集中快照为放行事实，而不再等待发起重启前某一次特定 `sessions.list` 请求。当前连接即使返回与重启前内容相同的会话快照，也必须更新该快照的读取时间后放行；后续刷新合法取代先前请求时，新的当前连接快照仍可解除“正在同步工作区”。智能体范围请求是会话读取的前置条件，已结算失败时页面显示可重试错误而不无限等待。完整记录见 [DWS 安装与工作区恢复审计](dws-install-and-workspace-recovery-2026-08-19.md)。

Gateway 生命周期进度统一来自 `useSetupProgress('gateway')`：全局工作区加载页、底部状态栏和钉钉就绪面板显示同一条本地化进度消息。钉钉配置写入尚未启动重启时保留本地“正在授权”状态；重启开始后立即切换到统一生命周期进度和真实百分比。

## 验证

- 定向授权与就绪提示回归 27 项通过，覆盖全局严格白名单、空 `allow` 迁移、普通与 sandbox 拒绝规则、sandbox 空 `allow` 允许全部、`sandbox.mode: "all"` 的当前 Agent sandbox 工具补丁、非 sandbox 主会话不写入无效 sandbox 配置、id 数组局部补丁、写后配置未收敛、目标 Agent 收集与 `tools.effective` 成功条件。
- `pnpm lint` 通过，包含 TypeScript 与模块边界检查；`pnpm build` 通过，重建协作与钉钉插件 bundle、TypeScript 与 Vite 生产构建。
- 工作区首屏放行回归测试通过，覆盖“首个请求被后续刷新取代、但当前连接集中会话快照已到达”的情况。
- 钉钉插件包定向回归 21 项通过，新增回归覆盖 `full`、`discovery` 与 `tool-discovery` 三种工具注册模式，以及三个非工具模式拒绝注册。
- `pnpm lint` 和 `pnpm build` 通过；生产构建重新生成钉钉插件 bundle。当前 macOS Gateway 已按上一节完成真实插件覆盖、Gateway 重启和 `tools.effective` 会话快照核验。
- 已重新构建 macOS Apple Silicon DMG，`hdiutil verify` 通过；应用内嵌的钉钉插件归档 SHA-256 与当前资源一致。
- 已从包含本次授权收紧的当前工作区重新生成 macOS Apple Silicon DMG；`hdiutil verify` 通过。该镜像使用 `--no-sign` 构建，未签名、未公证，且未在真实 Gateway 上完成授权端到端验收。

## 未验证边界

- 未在用户的 Windows Gateway 上实际执行这次授权，因此不能将 macOS 实测描述为 Windows 真机授权成功。
- DWS 安装、钉钉登录和业务工具调用不属于本次授权修复；它们仍须由当前 Gateway 与 DWS 的结构化结果确认。
- 本轮本地前端构建与交互状态测试通过，但当前环境没有可用的受控浏览器，尚未完成亮色、暗色、窄窗口与键盘焦点的真实视觉验收。
- 非当前 Agent 的真实 Session 工具核验仍需用户切换到该 Agent 的 Session 后执行“重新检测”；JunQi 不根据配置写入或当前 Agent 的工具快照推断其成功。
- 未在真实 Gateway 中连续执行“授权、重启、会话刷新”并录制亮色、暗色、窄窗口及键盘操作序列；自动化和 macOS 协议快照已验证，真机视觉验收仍待完成。
