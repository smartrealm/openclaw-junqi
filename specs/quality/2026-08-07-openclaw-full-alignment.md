# OpenClaw 全链路对齐规格

日期：2026-08-07

## 引导完成门禁

## Wizard 结构化步骤

JunQi 只呈现 Gateway `wizard.*` schema 已定义的步骤及字段。选项中的 `Skip for now`、可选插件和
推荐项由 Gateway 提供并原样回传；客户端不添加 CLI 专属 skip 参数。`externalUrl`、`deviceCode`、
`channels`、`accounts` 和 `preparedModelRef` 必须严格校验后投影到桌面 UI，不能从消息文本或终端输出
猜测二维码、授权完成或配置结果。

### 当前

JunQi 将“配置文件存在且包含默认模型引用”解释为 OpenClaw 已完成配置。

### 目标

只有以下条件同时成立时，JunQi 才允许选定运行时跳过 OpenClaw 引导并进入工作台：

1. 选定 runtime 的 Gateway 已通过认证身份探测。
2. Gateway 按官方 `openclaw.setup.verify` 返回已验证的当前默认推理路由。

`openclaw.setup.verify` 不可用、未授权、超时、返回无效或返回未验证结果时，JunQi 不得把静态模型文本
替代为成功；应保持配置或待核验状态。官方方法不可用必须与模型或凭据验证失败分开呈现，不能要求用户修正
模型凭据，也不能自动重新启动已完成的 Wizard。

官方服务交接后的认证连接等待仅适用于交接路径，且必须有明确上限。普通 Wizard 请求仍按常规连接超时处理；
不得将两者合并为全局无限重试。

### 验收

- [x] 缺少配置或默认模型时不能跳过引导。
- [x] 仅有默认模型文本但实时验证失败时不能跳过引导。
- [x] 官方验证成功后才能进入工作台。
- [x] 验证不会写入配置、凭据、会话或 transcript。
- [x] 官方实时验证方法不可用时不误报为模型或凭据失败，也不自动重跑 Wizard。
- [x] 官方服务交接后的有界重连等待不改变普通 Wizard 请求的等待策略。
