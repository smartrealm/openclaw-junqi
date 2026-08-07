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
替代为成功；应保持配置或待核验状态。

### 验收

- [x] 缺少配置或默认模型时不能跳过引导。
- [x] 仅有默认模型文本但实时验证失败时不能跳过引导。
- [x] 官方验证成功后才能进入工作台。
- [x] 验证不会写入配置、凭据、会话或 transcript。
