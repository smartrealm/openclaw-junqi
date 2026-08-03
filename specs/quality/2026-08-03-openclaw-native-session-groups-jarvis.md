# OpenClaw 原生会话分组与 Jarvis 对齐规格

日期：2026-08-03

## 目标

让 JunQi 的会话分组和 Jarvis 唤醒词归属成为 OpenClaw group catalog 与 session
category 的忠实桌面投影，不存在客户端私有的伪分组或伪成员关系。

## 约束

1. group catalog 仅经 `sessions.groups.*` 读写，membership 仅经
   `sessions.patch.category` 读写。
2. `sessions.groups.list` 使用 `operator.read`；catalog mutation 与 category patch
   使用 `operator.write`。不得为此使用 admin fallback。
3. Gateway 报告 protocol 不支持、返回字段无效、连接轮换或请求失败时，UI 不得保留
   或创建 localStorage group/membership。
4. Jarvis category 只能由已确认的 Gateway wake trigger 派生；只通过
   `sessions.patch.category` 写入。当前官方 handler 会登记非空 category，JunQi 不得先用
   `sessions.groups.put` 做额外的读-改-写目录操作。
5. catalog 或 member mutation 成功后，UI 仅投影 Gateway 返回或后续官方 session list，
   不把请求输入当作成功状态。
6. 不修改 OpenClaw transcript、工具状态、会话创建语义或用户未选择的 runtime。
7. `pinned`、`unread`、`archived` 遵循相同规则：renderer 只能投影官方 session record
   或已确认的 `sessions.patch`，不能使用本地 legacy fallback。
8. 同一 renderer 的 catalog mutation 必须串行化，避免 `sessions.groups.put` 的全量
   names 请求覆盖并发创建；不能把该串行队列用作跨客户端锁或本地状态来源。

## 验收条件

- 不支持 native group protocol 时，分组 UI 不显示本地 fallback group，组操作报告
  Gateway 的能力错误。
- group client 只走已认证普通连接，且拒绝不完整 group 响应。
- 一个 wake word 触发后，Gateway 确认当前 session 的 category；当前官方 handler 负责把
  非空 category 登记到官方 catalog。该 mutation 失败时不接受唤醒。
- rename/delete 后，只按 Gateway 更新后的 catalog 和 session category 呈现成员。
- native organization protocol 不可用时，UI 不得把本地 pin、unread、archive、group 或
  membership 呈现为成功。
- 同一 renderer 并发创建两个 group 后，第二次 `put` 的 names 必须包含第一次已确认的
  catalog entry。
- 相关回归、类型、边界、构建和官方链接检查通过；真实 Gateway/目标平台边界被记录。
