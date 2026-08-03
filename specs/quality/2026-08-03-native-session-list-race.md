# 原生新建会话列表竞态修复

## 依据

- 当前安装的 `openclaw@2026.7.1-2` 官方 Gateway 协议将 `sessions.create` 定义为创建新会话条目的操作，`sessions.list` 返回当前会话索引。
- 同版本官方 TUI 在 `sessions.create` 返回 key 后立即切换到该 key。
- 本地 `src/utils/sessionCreate.ts` 仅在 Gateway 返回 key、sessionId 和 entry 的严格校验后调用 `addNativeSession`。

## 当前问题

`App.tsx` 的 `loadSessions` 原本只用 request gate 防止两个会话列表请求乱序，`chatStore.setSessions` 本身没有快照版本契约。若创建前的完整 `sessions.list` 请求在创建确认后返回，它会把刚创建但不在旧快照中的会话视为已删除，`removeSession` 随即将活动标签切回历史会话。相同风险也存在于用户切换标签或会话 identity 轮换之后。

## 目标行为

1. Gateway 确认创建后，新会话立刻成为活动会话。
2. 每个会话列表请求携带开始时的 store 投影版本；期间发生本地会话创建、选中、关闭、删除或 identity 轮换时，旧快照只能合并已返回行，不能删除缺失行或改变当前标签。
3. 创建确认后立即发起新的权威列表读取；版本一致的完整读取仍可按 Gateway 返回结果投影和删除会话，不保留本地伪状态。
4. 正常新建和 compaction checkpoint 分支均遵循同一栅栏。

## 验收条件

- 原生创建成功会通知会话列表所有者。
- 通知使创建前开始的列表请求失效，并触发新的 `loadSessions`。
- `chatStore` 为完整快照实施 source projection revision 栅栏，不依赖调用方是否正确废弃请求。
- 新建会话回归测试覆盖确认后通知、旧请求失效、旧快照保留新会话，以及新快照真实删除会话。
- TypeScript、模块边界、定向测试、完整测试和生产构建按本次记录执行。

## 未验证边界

- 尚未在真实 Gateway 的高延迟网络条件下执行桌面端交互验证。
- Gateway 在 `sessions.create` 成功后返回的后续完整列表仍是唯一权威来源；本修复不对 Gateway 最终一致性增加客户端猜测或重试策略。
