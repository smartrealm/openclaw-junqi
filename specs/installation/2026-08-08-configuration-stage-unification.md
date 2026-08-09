# 首次引导配置阶段统一规格

日期：2026-08-08

## 目标

将 Gateway 运行时就绪检查点与 OpenClaw 配置核验呈现在同一个“配置 OpenClaw”阶段。用户在同一页面中确认 Gateway 已就绪并主动开始配置核验；核验后，当前内容原地呈现官方 Wizard 或真实错误，不再以独立页面和切换动效造成两次进入配置阶段的感受。

## 契约与边界

- `gateway-ready` 仍是 JunQi 首次引导状态机中的运行时事实，只表示选定运行时的 Gateway 已就绪。
- 配置是否完成仍由现有 `config.get`、官方模型实时验证和官方 `wizard.start` 结果决定；JunQi 不把 Gateway 就绪映射为配置成功。
- 开始核验必须由用户显式触发，页面进入 `gateway-ready` 时不得自动启动 Wizard、写配置或跳过模型验证。
- 需要配置时，仅使用既有 OpenClaw 官方 Wizard 链路；页面不创建新的 RPC、配置字段或本地配置状态机。
- 已有配置满足门禁时，直接进入完成页；首次引导不创建本地渠道决策阶段。
- 首次配置仅调用默认 `wizard.start`。渠道选择、授权与跳过说明均属于该官方会话返回的结构化步骤，JunQi 不发送 `flow` 或 `skipChannels` 参数。

## 页面状态

| 底层状态 | 用户可见阶段 | 内容 |
| --- | --- | --- |
| `gateway-ready` 且空闲 | 配置 OpenClaw | Gateway 已就绪，提供“核验配置”操作 |
| `gateway-ready` 且核验中 | 配置 OpenClaw | 核验中的加载状态，操作不可重复提交 |
| `gateway-ready` 且核验失败 | 配置 OpenClaw | 真实错误和“重新核验”操作 |
| `configure-openclaw` | 配置 OpenClaw | Gateway 返回的官方 Wizard 结构化步骤 |

`gateway-ready` 与 `configure-openclaw` 共享同一个视觉场景键。底层状态转换不保留旧页面，也不触发场景位移动画；内容替换不延迟 Gateway 或 Wizard 的真实状态提交。

## 验收条件

1. Gateway 就绪后，顶部步骤器直接激活“配置 OpenClaw”，而不是将运行时完成状态展示成另一个配置前页面。
2. 用户未点击“核验配置”前，不会请求官方 Wizard 或自动跳转至其页面。
3. 核验中、失败和官方 Wizard 都在同一 `SetupShell` 场景内呈现。
4. `gateway-ready` 到 `configure-openclaw` 不重挂载步骤场景，不执行横向或纵向入场动效。
5. 亮色、暗色、窄窗口、键盘焦点、加载和错误状态均复用既有主题令牌与 Setup 底栏交互。
6. Gateway 返回渠道跳过说明时，说明在同一 Wizard 会话中可见；不会自动导航、另起渠道会话或把跳过误写为配置完成。
