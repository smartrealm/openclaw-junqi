# OpenClaw 会话组织写入回执确认规格

## BUG-01：布尔组织字段必须由 Gateway 条目确认

### 当前行为

`sessions.patch` 返回任意对象形式的 `entry` 时，置顶、归档和未读操作就会更新 JunQi 本地投影，
即使对应字段未出现或没有等于请求值。

### 目标行为

客户端仅在原生 `SessionsPatchResult.entry` 明确返回与请求一致的布尔字段时更新本地投影。

### 验收条件

- [ ] `pinned=true/false` 均要求 `entry.pinned` 为同值。
- [ ] `archived=true/false` 均要求 `entry.archived` 为同值。
- [ ] `unread=true/false` 均要求 `entry.unread` 为同值。
- [ ] 缺失、不为布尔值或值不一致的回执被拒绝。
- [ ] 被拒绝的回执不触发 `chatStore` 的本地组织状态更新。
- [ ] 分类字段的既有确认语义不改变。
