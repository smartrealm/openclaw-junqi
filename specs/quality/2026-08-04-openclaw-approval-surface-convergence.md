# OpenClaw 审批界面与事件收敛规格

日期：2026-08-04

## 范围

将活动中心的原生审批控制面收敛为一个严格解码的 OpenClaw 客户端投影，并按官方客户端指南
接入 approval events 与 pending list 回填。

## 验收条件

1. 活动中心只挂载 `OpenClawApprovalsPanel`，不得显示第二个 exec/plugin 审批面板。
2. 事件连接只能请求 `operator.approvals`，并绑定当前已认证 Gateway 的连接身份、URL、token
   与 device token；主连接变化、页面卸载或 Gateway 断开时必须释放该连接。
3. 只有官方 `exec.approval.requested`、`exec.approval.resolved`、
   `plugin.approval.requested`、`plugin.approval.resolved` 且具有非空 approval ID 的事件可触发
   失效刷新。事件 payload 不能直接构造、修改或确认 UI 审批状态。
4. 订阅回调必须先于 event socket 启动登记；连接建立后执行 pending list 回填。后启动的刷新
   必须使先前 list 请求的响应失效，防止旧快照复活已处理审批。
5. `approval.history`、`approval.get`、`approval.resolve` 继续使用统一 client 的严格响应解析；
   system-agent、terminal status、reason、resolver 和 `applied` 语义不得退化。
6. 旧 `GatewayApprovalPanel`、`useGatewayApprovals`、旧 approval facade、旧 payload parser 及仅
   引用它们的翻译键、测试、文档和导出必须无残留。
7. 没有 `operator.admin` fallback、硬编码成功结果、本地审批状态机或伪造的兼容协议。

## 非目标

- 不创建或修改 Gateway exec approvals policy。
- 不实现未由当前官方协议定义的 system-agent event。
- 不将浏览器 API 用作桌面持久能力的权威实现。
