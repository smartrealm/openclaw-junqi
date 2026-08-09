# OpenClaw 全链路对齐规格

日期：2026-08-07

2026-08-09 复审说明：本规格原先将 `openclaw.setup.verify` 作为安装完成门禁，该结论已由
`specs/quality/2026-08-09-openclaw-installation-completion-contract.md` 替代。以下内容已同步为当前官方契约。

## 引导完成门禁

## Wizard 结构化步骤

JunQi 只呈现 Gateway `wizard.*` schema 已定义的步骤及字段。选项中的 `Skip for now`、可选插件和
推荐项由 Gateway 提供并原样回传；客户端不添加 CLI 专属 skip 参数。`externalUrl`、`deviceCode`、
`channels`、`accounts` 和 `preparedModelRef` 必须严格校验后投影到桌面 UI，不能从消息文本或终端输出
猜测二维码、授权完成或配置结果。

### 当前问题

JunQi 曾先将“配置文件存在且包含默认模型引用”解释为 OpenClaw 已完成配置，随后又在官方 Wizard 终态后
追加实时模型验证。两种客户端判据都脱离了官方配置终态。

### 目标

只有以下条件同时成立时，JunQi 才允许选定运行时跳过 OpenClaw 引导并进入工作台：

1. 选定 runtime 的 Gateway 已通过认证身份探测。
2. Gateway 按官方 `openclaw.setup.detect` 返回 `setupComplete=true`。

`setupComplete=false` 时进入官方 Wizard。Wizard 返回官方终态后，客户端不得追加 `openclaw.setup.verify`
覆盖用户在官方流程中作出的跳过或继续选择。实时模型验证只属于用户明确触发的模型或业务就绪测试，失败时
不得伪造成功，也不得反向改写安装完成状态。

官方服务交接后的认证连接等待仅适用于交接路径，且必须有明确上限。普通 Wizard 请求仍按常规连接超时处理；
不得将两者合并为全局无限重试。

### 验收

- [x] `setupComplete=false` 时不能跳过官方引导。
- [x] 客户端不从默认模型文本推断安装完成。
- [x] `setupComplete=true` 时无需重复模型测试即可进入工作台。
- [x] Wizard 终态后不追加实时模型验证，也不自动重跑 Wizard。
- [x] 明确触发的模型验证不会写入配置、凭据、会话或 transcript。
- [x] 官方服务交接后的有界重连等待不改变普通 Wizard 请求的等待策略。
