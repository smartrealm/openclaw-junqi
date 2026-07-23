# Windows OpenClaw Wizard 链路审计

审计范围：Windows Native 安装、Gateway 启动与凭据解析、WebSocket 授权、官方 Wizard 会话、失败恢复、完成后的 Scheduled Task 交接。

官方依据：OpenClaw 将 `wizard.*` 固定映射为 `operator.admin`；`wizard.next` 的 payload 错误可能表示回答校验失败而会话仍在运行；`wizard.next/status` 不回传 `sessionId`。参见 [Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)、[Wizard schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/wizard.ts) 和 [Wizard server methods](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/wizard.ts)。

## 🔴 BUG-WIZ-01 · Wizard RPC 使用了不具备 admin scope 的日常连接

**位置**：`src/hooks/useSetupFlow.ts`、`src/services/gateway/Connection.ts`

日常连接明确只申请 `operator.read/write`，原实现却通过 `gateway.call` 调用 `wizard.start/next/cancel`。Gateway 返回 `missing scope: operator.admin` 后，错误包装又覆盖真实诊断，最终形成 `(unknown)/(none)`。

**影响**：Windows 首次配置在 Wizard 创建会话前即失败；用户无法从原文判断是权限、配对还是协议错误。

**修复**：Wizard 只通过 admin 管理通道调用；保留 RPC 原始错误和最后已知 step/session。

## 🔴 BUG-WIZ-02 · 被 Gateway 拒绝的答案会写入“已接受历史”

**位置**：`src/services/openclawWizard.ts`

官方服务会用成功 RPC payload 中的 `error` 表示回答校验失败，此时会话仍为 running。当前 `next()` 仍执行 `history.push()`，把被拒答案当成已接受答案。

**影响**：Back/Retry 重建会话时会重放无效答案；敏感字段可能在内存中被错误保留并再次提交；恢复后的 step 和诊断上下文可能错位。

**修复**：区分 payload 校验错误与 terminal error。前者保留活动 session/当前 step，不推进 history；成功 resume 后清理失败快照。

## 🔴 BUG-WIZ-03 · admin scope 升级信息在握手失败链路中丢失

**位置**：`src/services/gateway/Connection.ts`、`src/services/gateway/index.ts`、`src/hooks/useSetupFlow.ts`

代码能解析 `PAIRING_REQUIRED`、`AUTH_SCOPE_MISMATCH`、`requestId` 和 `recommendedNextStep`，但握手 reject 分支没有触发结构化授权回调；一次性 admin requester 最终只收到普通字符串。安装阶段又不挂载工作台 Pairing overlay。

**影响**：仅有 device token、需要 admin scope upgrade 的 Windows/远程 Gateway 无法给出批准命令，用户只能反复重试。

**修复**：握手失败必须发出完整 `GatewayAuthorizationIssue`；admin requester 用类型化错误携带 requestId；Wizard 错误面给出可执行的 `openclaw devices approve <requestId>` 诊断；安装分支也必须挂载现有 Pairing approval 界面。

## 🟡 BUG-WIZ-04 · cancelled 和 terminal 状态契约不完整

**位置**：`src/services/openclawWizard.ts`、`src/hooks/useSetupFlow.ts`

`status: cancelled` 是合法终态，但 `applyWizardResult()` 会继续要求 next step；`start()` 也可能把 cancelled 当成缺少 session id。`status: done` 与 `done: true` 没有统一判定。

**影响**：外部取消或协议合法终态会产生第二个“没有返回下一步”假错误，重试状态不确定。

**修复**：建立单一 terminal 判定；cancelled 清理 session 后显示明确、可重试的取消状态。

## 已验证无新增缺陷的边界

- Windows Gateway 启动使用 operation gate 串行化，并以选定配置 token 验证 endpoint。
- Wizard 完成后的服务交接验证 state/config/runtime 身份；失败时只恢复被本次操作替换的 desktop child。
- Native Gateway 配置使用 `loopback`，未写入 Windows IP 字面量。
- Wizard session 在 Gateway 服务端持有，跨 WebSocket 请求使用 sessionId 恢复，连接本身不是会话所有者。
