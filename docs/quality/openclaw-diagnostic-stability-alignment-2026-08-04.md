# OpenClaw 稳定性诊断只读对齐

日期：2026-08-04

## 依据

本次实现以当前 OpenClaw 官方协议与源码为契约；已安装包只用于本地复现，不用于能力门禁或
版本分支。

- [Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 将 `diagnostics.stability` 列为
  `operator.read` 的诊断方法，并明确快照是有界的 recorder 投影，排除聊天文本、工具输出、
  原始请求响应与 secret。
- [diagnostics handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/diagnostics.ts)
  对参数进行官方规范化后返回 Gateway recorder 的快照。
- [diagnostic stability recorder](https://github.com/openclaw/openclaw/blob/main/src/logging/diagnostic-stability.ts)
  定义空查询的默认窗口、`limit/type/sinceSeq` 筛选、环形容量、事件脱敏及 `summary.byType`。

## 当前行为

1. 维护中心的 OpenClaw 稳定性诊断区不在挂载时调用 Gateway。用户点击读取按钮后，JunQi 才以
   attested connection id 调用 `diagnostics.stability`，并严格发送 `{}`。
2. `OpenClawDiagnosticStabilityClient` 仅保留 `generatedAt`、capacity/count/dropped、可选首末序号、
   事件 `seq/ts/type` 与 `summary.byType`。Gateway 的通道、提供方、模型、会话、工具或未来
   additive 字段不会进入 JunQi 状态或 UI。
3. 方法是否出现在 `hello-ok.features.methods` 不决定是否调用；省略时仍真实请求。Gateway 正式
   method-not-found、断线或连接身份改变进入不可用状态；已知字段无效进入协议无效状态。
4. 此面板只提供诊断可观测性：不宣布 Gateway 健康、不参与自动恢复或官方 repair、不写入
   OpenClaw 配置、日志、文件或前端持久化存储。

## 验证结果

- `OpenClawDiagnosticStabilityClient.test.ts` 覆盖空参数、fenced identity、脱敏投影、未知扩展字段、
  malformed 响应、方法广告省略、method-not-found、断线和连接替换。
- `OpenClawDiagnosticStabilityPanel.test.tsx` 覆盖只显示安全投影、显式读取入口与不可用提示。
- `MaintenanceCenter.test.ts` 与上述定向测试共 14 项通过。
- `pnpm exec tsc --noEmit` 通过。

## 未验证边界

- 未连接真实 Gateway 读取实际 recorder 快照；因此未声称任何事件类别、容量、丢弃数量或响应
  时延已在现场验证。
- 未在 macOS、Windows、CentOS、Ubuntu 真机验证维护界面、远程 Gateway 权限拒绝和 recorder
  负载。实现未使用平台专属 API。
- 未实现诊断 bundle、自动告警、自动 repair、状态评分或 OpenClaw 未公开字段的展示。
