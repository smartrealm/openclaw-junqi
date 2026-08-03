# OpenClaw 稳定性诊断只读投影

## 目标

在 JunQi 的维护中心提供 OpenClaw 原生 `diagnostics.stability` 的显式、只读读取入口，
用于查看 Gateway 已脱敏且有界的稳定性诊断元数据。JunQi 只呈现 Gateway 返回的投影，
不把该快照推断为 Gateway 健康、会话健康或修复结果。

## 约束

- 契约来自 OpenClaw 当前官方 Gateway protocol、`server-methods/diagnostics.ts` 与
  `logging/diagnostic-stability.ts`；安装版本仅作本地复现，不作为能力开关或版本分支。
- 仅使用现有 `operator.read` 的认证 Gateway 连接调用 `diagnostics.stability`，不增加
  scope、Tauri command、后台服务、浏览器 transport 或本地记录器。
- 默认严格发送 `{}`，由 Gateway 决定默认数量与环形缓冲窗口；用户未明确筛选时 JunQi 不发送
  `limit`、`type` 或 `sinceSeq`。
- 读取必须绑定 attested Gateway connection id。断线、连接替换、method-not-found 和 malformed
  响应都必须进入明确失败状态，不能降级为健康、空快照或本地模拟数据。
- 只保留 `generatedAt`、容量/计数、序号、事件时间/类型和 `summary.byType`。未知 additive
  字段一律忽略；不保存、复制、记录或呈现 Gateway 原始对象、通道、模型、会话、工具、消息或
  其他潜在敏感扩展字段。
- 面板不自动读取、不轮询、不参与 Gateway 自动恢复或官方 repair；用户点击读取按钮才发起 RPC。

## 验收条件

1. 维护中心存在独立 OpenClaw 稳定性诊断区，首次打开不发送 RPC；读取动作只调用一次
   identity-fenced 的 `diagnostics.stability`，参数为 `{}`。
2. 界面说明该信息不是 Gateway 健康结论，显示快照时间、记录数、容量、丢弃数、事件类型汇总
   和最多八条事件时间/类型元数据。
3. 客户端严格拒绝 malformed 必填字段及非法数值；未知顶层、事件和 summary 扩展字段不进入
   JunQi 状态或 UI。
4. 方法遗漏于 `hello-ok.features.methods` 时仍真实请求；只有 Gateway 的正式 method-not-found、
   连接围栏或断线错误才映射为不可用。
5. 三语文案完整；该能力不修改 OpenClaw 配置、不创建任务/会话、不触发 repair，也不依赖
   macOS、Windows、CentOS 或 Ubuntu 的专属 API。

## 不在范围内

- Gateway 健康评分、告警阈值、自动修复、崩溃包读取、稳定性记录器配置或本地事件采集。
- `diagnostics.stability` 当前未承诺的字段、事件详情、诊断 bundle 导出和任意原始数据展示。
- 通过 Desktop 自行推断模型、工具调用、会话或语音唤醒的运行状态。
