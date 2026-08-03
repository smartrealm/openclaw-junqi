# 新建会话生命周期加固计划

## Phase A · 修复协议语义

| Bug | 文件 | 修改 |
| --- | --- | --- |
| BUG-NS-01 | `src/services/gateway/OpenClawSessionLifecycleClient.ts` | 为 create input 增加 `fork`，校验 fork 必须带父 key并透传官方字段。 |
| BUG-NS-01 | `src/utils/sessionCreate.ts` | 在 renderer coordinator 中保留显式 fork intent。 |
| BUG-NS-01 | `src/components/Chat/session-actions/SessionActionsMenu.tsx` | 会话菜单分叉提交 `fork: true`。 |
| BUG-NS-01 | 对应测试 | 增加会在旧实现失败的 wire-contract 与行为测试。 |

## Phase B · 统一创建意图

| Bug | 文件 | 修改 |
| --- | --- | --- |
| BUG-NS-02 | `src/components/Layout/NavSidebar.tsx` | 使用当前 session 与 Gateway Agent 列表解析目标 Agent。 |
| BUG-NS-03 | `src/utils/sessionCreate.ts` | 用完整规范化 intent 生成飞行去重键。 |
| BUG-NS-06 | `ChatTabs.tsx`、`NavSidebar.tsx`、`useAgentScopedSession.ts` | 普通创建统一使用 `chat.newSessionLabel`。 |
| BUG-NS-02/03/06 | 对应测试 | 覆盖跨入口 Agent、不同 label、fork intent 和 locale label。 |

## Phase C · 收敛创建与列表时序

| Bug | 文件 | 修改 |
| --- | --- | --- |
| BUG-NS-04 | 新建共享 session mutation/list gate helper | 建立 mutation revision，区分 mutation 前后开始的快照。 |
| BUG-NS-04 | `src/App.tsx` | `loadSessions` 提交前检查创建 mutation revision。 |
| BUG-NS-04 | `src/utils/sessionCreate.ts` | 创建确认后、Store commit 前推进共享 mutation revision。 |
| BUG-NS-04 | `src/stores/chatStore.ts` | 保持 complete snapshot 删除语义，不用永久本地保留掩盖竞态。 |
| BUG-NS-04 | 对应测试 | 复现旧快照删除新 session，并验证 mutation 后快照仍可删除。 |

## Phase D · 路由失败恢复

| Bug | 文件 | 修改 |
| --- | --- | --- |
| BUG-NS-05 | `src/hooks/useAgentScopedSession.ts` | 将 route intent 消费与成功终态绑定，暴露显式 retry state。 |
| BUG-NS-05 | Chat page 或共享 retry surface | 复用 Aegis Alert/按钮，不使用 `window.alert()`。 |
| BUG-NS-05 | 对应测试 | 覆盖失败、手动重试、成功清理和不自动循环。 |

## Phase E · 组件行为测试与文档

- 为 NewSessionPicker、NavSidebar 主操作、SessionActionsMenu 和 route hook 增加组件测试。
- 更新 `docs/quality/new-session-lifecycle-audit-2026-08-03.md` 的修复与验证状态。
- 更新 `docs/quality/openclaw-native-session-experience-alignment-2026-08-02.md` 中错误的 fork 表述。
- 若用户可见流程发生变化，同步相关产品文档；首次安装流程不受影响，无需改 `junqi-first-run-flow.html`。

## 验证顺序

1. `OpenClawSessionLifecycleClient` 与 `sessionCreate` 定向测试。
2. Chat picker、NavSidebar、route hook、SessionActionsMenu 组件测试。
3. chatStore session lifecycle 与 Gateway data store 测试。
4. `pnpm lint`。
5. `pnpm test`。
6. `pnpm test:rust`，确认前端改动未破坏桌面基线。
7. `pnpm build`。
8. locale JSON、禁用 Unicode 符号扫描与 `git diff --check`。
9. 真实 Gateway 验证普通创建、非 main Agent 创建、活动父会话 fork 拒绝、成功 transcript fork 和失败重试。

## 实施状态

- Phase A：已完成。
- Phase B：已完成。
- Phase C：已完成。
- Phase D：已完成，使用 Chat 页内可访问重试条。
- Phase E：自动化契约已完成；真实 Tauri 与 Gateway 人工验收未执行。
