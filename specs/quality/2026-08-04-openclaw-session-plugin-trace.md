# OpenClaw 会话插件追踪对齐

## 依据与差异

- 最新 OpenClaw 官方推理文档 `https://docs.openclaw.ai/tools/thinking`：`/trace` 是会话级插件追踪输出开关，公开取值为 `on`、`off`，默认关闭。
- OpenClaw 官方主线 ACP 控制面为插件追踪声明的可选值同样是 `off`、`on`，并通过 `sessions.patch.traceLevel` 写入会话覆盖。
- 当前运行环境的已安装协议 schema 将 `traceLevel` 定义为 `string | null`；本地运行时代码仍可识别 `raw`。这与最新版公开文档和主线 ACP 可选值不一致，不能静默把 `raw` 视为 `on`、`off` 或继承。

## 当前行为

JunQi 不投影或控制 `traceLevel`。当前 Gateway 若有插件追踪覆盖，桌面客户端无法回读、关闭、恢复继承或明确显示不受当前 UI 支持的值。

## 目标行为

- 读取会话行时保留 Gateway 返回的原始非空 `traceLevel`，不在读取层篡改。
- 会话运行时控制仅提供最新官方公开的继承、开启、关闭，分别写入 `null`、`"on"`、`"off"`。
- `raw` 或任何其他未知值显示为 Gateway 未支持的当前值，不作为继承或可写选项；用户须显式选择支持状态后才覆盖它。
- 显式保存复用既有每会话串行 `operator.admin` 的 `sessions.patch` 通道；成功回执若含未知值则同样保留为未知，不静默改写本地状态。

## 验收

1. 最新官方 `on/off/null` 写入值和界面选项精确双向映射。
2. 已安装 Gateway 投影的 `raw` 和其他未知字符串被保留并以未知状态呈现，而非错误显示为继承。
3. 写入仅经 `operator.admin` 和既有会话 mutation 串行通道，且只影响目标会话。
4. 三种支持语言具备完整文案；紧凑触发器不因新增状态溢出，弹层在受限高度仍可保存或取消。
5. JunQi 不生成插件追踪行、不将普通响应追溯冒充插件追踪，也不在发送时修改 trace 覆盖。

## 未验证边界

- 未在真实 Gateway、插件和渠道上验证追踪行的生成、脱敏、展示与授权边界。
- 未在 macOS、Windows、CentOS、Ubuntu 真机验证主题、窄窗口、键盘焦点和未知值的视觉呈现。
