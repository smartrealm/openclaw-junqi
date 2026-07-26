# Windows OpenClaw Wizard Bugfix Spec

## BUG-WIZ-01 · Admin RPC contract

**Current**：Wizard 管理 RPC 使用只申请 `operator.read/write` 的日常连接，错误诊断被通用文案覆盖。

**Target**：所有 `wizard.*` 请求使用 `operator.admin` 管理连接；原始 RPC 诊断及最后已知 session/step 可见。

**Acceptance**：
- [x] `wizard.start/next/cancel` 不经过日常 `gateway.call`。
- [x] admin 请求不改变日常连接的 scopes、轮询或 runtime identity。
- [x] RPC 失败不再退化为只有 `(unknown)/(none)` 的通用文案。

## BUG-WIZ-02 · Payload error state

**Current**：running session 返回 payload `error` 时，被拒答案仍被加入 history。

**Target**：payload error 保留活动 session 和当前 step，但不提交 history；terminal error 才清理活动 session。

**Acceptance**：
- [x] 被拒答案不会被 Back 或 Retry 重放。
- [x] Retry 通过无 answer 的 `wizard.next` 恢复当前官方 step。
- [x] 成功恢复后不残留旧 failed step 诊断。

## BUG-WIZ-03 · Scope upgrade recovery

**Current**：admin 握手中的结构化授权 issue 被降为字符串，requestId 丢失。

**Target**：握手、requester、Wizard UI 全程保留 `kind/code/requestId/recommendedNextStep`。

**Acceptance**：
- [x] `PAIRING_REQUIRED` scope-upgrade 握手失败返回类型化授权错误。
- [x] Wizard 错误包含 requestId 和准确批准命令。
- [x] setup 未完成时仍渲染官方 Pairing approval 界面。
- [x] token mismatch 不得伪装成设备批准请求。

## BUG-WIZ-04 · Terminal cancellation

**Current**：`status: cancelled` 被当成缺少 step/session 的协议错误。

**Target**：done、error、cancelled 使用统一 terminal 判定；cancelled 清理 session 并进入可重试状态。

**Acceptance**：
- [x] cancelled 响应不要求 step 或 sessionId。
- [x] cancelled 不触发完成交接或模型探测。
- [x] Retry 从新官方 session 开始。
