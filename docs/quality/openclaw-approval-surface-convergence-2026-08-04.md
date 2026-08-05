# OpenClaw 审批界面与事件收敛

日期：2026-08-04

## 依据

- [OpenClaw Gateway client guide](https://docs.openclaw.ai/gateway/clients) 要求具有
  `operator.approvals` 的客户端在 `hello-ok` 后先安装审批事件监听，再以
  `exec.approval.list` 回填连接前请求，并按 approval ID 协调 list 与事件竞态。
- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 定义
  `operator.approvals` 为独立 operator scope，且将
  `plugin.approval.requested` / `plugin.approval.resolved` 置于该 scope 的显式广播规则。
- OpenClaw 官方
  [`approval.ts`](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/approval.ts)
  定义统一 `approval.history`、`approval.get`、`approval.resolve`；统一 handler 覆盖
  exec、plugin 与 system-agent，并对终态 resolve 返回 `applied: false`，不重新打开执行权。

## 审计发现

活动中心同时挂载 `OpenClawApprovalsPanel` 与 `GatewayApprovalPanel`。

- 前者使用 `OpenClawApprovalClient`，以审批 scope 调用 native pending list，并呈现统一
  history、terminal snapshot 和 system-agent 状态。
- 后者使用独立的旧 `approvals.ts` 模型以及专用事件 socket，只能处理 exec/plugin，直接将
  旧事件 payload 投影到第二个待处理队列。
- 两者均能对同一 exec/plugin 请求发出决策，因此同一页面存在重复入口。旧事件 socket 的
  生命周期和重连没有与统一快照、history 或 system-agent 语义协调。

## 目标行为

- 活动中心只呈现一个原生审批面板，所有 UI 状态由当前 `OpenClawApprovalClient` 的严格解析
  结果提供。
- 面板挂载且主 Gateway 已连接时，先登记 approval 事件监听、再取得专用
  `operator.approvals` transient 连接、最后调用 pending list 回填；事件携带的官方 approval
  ID 只触发统一快照重新读取，不直接成为 UI 状态。
- 同一 ID 的事件与 list 并发时，store 的请求序列保证较旧列表响应不能覆盖较新的回填读取。
  resolve 后依旧以 Gateway 的 resolve 回执及后续 list/history 刷新确定终态。
- 轮询保留为事件连接断开、老 Gateway 不广播或后台状态变化时的恢复兜底；它不声明为实时
  订阅的替代品。
- 不创建本地审批、不合成决策、不写入 OpenClaw 审批策略，也不扩大为 `operator.admin`。

## 删除范围

在全局引用确认后删除旧面板、旧 hook、旧 list/resolve facade、旧 payload 解析以及只服务于
这些模块的测试和翻译键。`approvalEventBridge.ts` 保留，但改为严格的事件 ID 失效桥接，不能
再依赖旧面板的数据模型。

## 验证与边界

自动化将覆盖 scoped transient 连接、事件 ID 识别、事件到快照回填的竞态保护、统一 client
的 list/history/resolve 契约和活动中心不存在第二个审批入口。将执行 lint、完整前端测试、
build、官方链接验证和差异检查。

尚未在 macOS、Windows、Ubuntu 或 CentOS 真机与真实 Gateway 上验证审批 scope 升级、配对和
断线重连；这些结果不得由本机自动化替代。
