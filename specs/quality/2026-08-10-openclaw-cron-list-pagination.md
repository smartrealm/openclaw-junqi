# OpenClaw Cron 列表分页规格

## 上游契约

`cron.list` 返回分页对象：`jobs`、`snapshotRevision`、`total`、`offset`、`limit`、`hasMore`、`nextOffset`。数组不是当前官方响应契约。

## JunQi 行为

1. 从 `offset=0`、`limit=200` 开始请求，并保留 `includeDisabled=true`。
2. 校验每页字段类型和边界；`nextOffset` 必须等于当前偏移加本页任务数。
3. 要求所有页的 `snapshotRevision` 相同，防止跨页期间列表发生变化。
4. 仅在 `hasMore=false` 且已覆盖 `total` 后提交完整列表。
5. 非法响应或分页不前进时显示 Gateway 错误，禁止提交部分列表或制造空结果。

## 验收条件

- 单页响应完整提交。
- 两页响应按 Gateway 顺序合并。
- 缺少分页元数据、旧数组响应、错误 `nextOffset` 和不一致 `total` 均被拒绝。
