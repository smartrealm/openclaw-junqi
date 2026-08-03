# 原生新建会话列表竞态修复

## 依据

- 当前安装的 `openclaw@2026.7.1-2` 官方 Gateway 协议将 `sessions.create` 定义为创建新会话条目的操作，`sessions.list` 返回当前会话索引。
- 同版本官方 TUI 在 `sessions.create` 返回 key 后立即切换到该 key。
- 本地 `src/utils/sessionCreate.ts` 仅在 Gateway 返回 key、sessionId 和 entry 的严格校验后调用 `addNativeSession`。

## 当前问题

`App.tsx` 的 `loadSessions` 用 request gate 防止两个会话列表请求乱序，但原生新建会话不参与该 gate。若创建前的完整 `sessions.list` 请求在创建确认后返回，`chatStore.setSessions` 会把刚创建但不在旧快照中的会话视为已删除，`removeSession` 随即将活动标签切回历史会话。

## 目标行为

1. Gateway 确认创建后，新会话立刻成为活动会话。
2. 在创建确认前开始的 `sessions.list` 响应不得覆盖该会话或改变当前标签。
3. 创建确认后立即发起新的权威列表读取；该读取仍可按 Gateway 返回结果投影会话，不保留本地伪状态。
4. 正常新建和 compaction checkpoint 分支均遵循同一栅栏。

## 验收条件

- 原生创建成功会通知会话列表所有者。
- 通知使创建前开始的列表请求失效，并触发新的 `loadSessions`。
- 新建会话回归测试覆盖确认后通知、旧请求失效与 App 接线。
- TypeScript、模块边界、定向测试、完整测试和生产构建按本次记录执行。

## 未验证边界

- 尚未在真实 Gateway 的高延迟网络条件下执行桌面端交互验证。
- Gateway 在 `sessions.create` 成功后返回的后续完整列表仍是唯一权威来源；本修复不对 Gateway 最终一致性增加客户端猜测或重试策略。
