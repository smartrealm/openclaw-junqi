# 新建会话生命周期加固规格

## 依据

- OpenClaw `2026.7.1-2` 的 `SessionsCreateParamsSchema`。
- 官方安装版本的 session create、operator fork 与 sessions.changed 实现。
- `docs/quality/new-session-lifecycle-audit-2026-08-03.md`。

## BUG-NS-01 · 恢复真正的 transcript fork

**Current**：会话菜单只传 `parentSessionKey`，创建空白父关联子会话。

**Target**：会话菜单传 `parentSessionKey` 和 `fork: true`；普通新会话不传 fork。

**Acceptance**：

- [ ] fork wire payload 明确包含 `fork: true`。
- [ ] `fork: true` 缺少父 key 在发 RPC 前失败。
- [ ] Gateway 的 active-parent 和 size policy 错误保持可见。
- [ ] 成功响应仍要求 key、sessionId 与 entry identity 一致。

## BUG-NS-02 · 统一所有普通新建入口的 Agent 归属

**Current**：Chat picker 与 Dashboard 跟随当前 session Agent，NavSidebar 固定 main。

**Target**：所有普通新建入口都使用 `resolveNewSessionAgentId(activeSessionKey, availableAgentIds)`；Agent Hub 的显式 agent route 继续使用用户明确选择的 Agent。

**Acceptance**：

- [ ] 非 main 会话中点击侧栏新建会创建到同一 Agent。
- [ ] stale Agent 不会被复用。
- [ ] Agent 列表尚未加载时使用当前 session key 中可验证的 Agent。
- [ ] 无法解析时回退 main。

## BUG-NS-03 · 仅去重完全相同的创建意图

**Current**：去重键只有 agentId 与 parentSessionKey。

**Target**：规范化后的 agentId、label、parentSessionKey 和 fork 共同构成 intent identity。

**Acceptance**：

- [ ] 完全相同的重复点击只发一个 RPC。
- [ ] 不同 label 不会合并。
- [ ] 普通 parent child 与 transcript fork 不会合并。
- [ ] 请求终态后去重记录释放。

## BUG-NS-04 · 创建 mutation 与 session list 快照建立因果门禁

**Current**：创建确认后，较早开始的 complete sessions.list 仍可删除刚提交的新 session。

**Target**：创建开始或确认时使早于该 mutation 的 list snapshot 失效；只有 mutation 后开始的完整权威快照或明确 delete event 可以删除新 session。

**Acceptance**：

- [ ] 旧 complete snapshot 不会移除新确认的 session。
- [ ] 创建后的 complete snapshot可以正常删除已不存在的 session。
- [ ] 明确 delete event 仍立即生效。
- [ ] 不永久保留 Gateway 已删除的本地 session。

## BUG-NS-05 · 路由创建失败可重试

**Current**：URL intent 在 RPC 结果前被消费，失败后只能重新从原入口导航。

**Target**：成功只执行一次；失败保留明确的用户重试入口，同时禁止 effect 无限自动重试。

**Acceptance**：

- [ ] 同一 location render 不会重复创建。
- [ ] 成功后清理 route intent。
- [ ] 失败后用户可以显式重试。
- [ ] 重试成功后不会再次自动创建。

## BUG-NS-06 · 统一普通新会话持久 label

**Current**：三个入口使用三个不同动作或占位字符串。

**Target**：普通 session creation 使用统一的 `chat.newSessionLabel`；按钮动作文案不变。

**Acceptance**：

- [ ] Chat picker、Dashboard route 和 NavSidebar 创建相同默认 label。
- [ ] zh、zh-TW、en 均有持久 label。
- [ ] fork 继续使用独立 label。

## BUG-NS-07 · 组件行为回归

**Current**：关键入口主要由源码字符串断言覆盖。

**Target**：以组件行为测试覆盖 picker、侧栏、route hook 和 fork menu。

**Acceptance**：

- [ ] 测试在 BUG-NS-01 修复前会因缺少 `fork: true` 失败。
- [ ] 测试在 BUG-NS-02 修复前会因侧栏提交 main 失败。
- [ ] 覆盖 loading、失败、重试、成功关闭和 active session。
- [ ] persona 只写入确认创建的 session draft。

## 禁止项

- 不创建本地伪 session key。
- 不在 Gateway 确认前展示成功 session。
- 不把 `parentSessionKey` 等同于 transcript fork。
- 不吞掉 Gateway 连接、权限、active run 或 size policy 错误。
- 不静默切换 Native 与 Docker runtime。
- 不把 session key 当成永不变化的 transcript identity。
