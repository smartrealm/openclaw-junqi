# OpenClaw Cron 列表分页契约审查

## 审查目标

确认 JunQi 对 `cron.list` 的读取是否完整遵守最新版 OpenClaw Gateway 的分页响应，而不是只显示第一页任务。

## 官方依据

- OpenClaw `src/cron/service/ops-read.ts` 的列表读取返回 `jobs`、`snapshotRevision`、`total`、`offset`、`limit`、`hasMore` 和 `nextOffset`。
- Gateway 的 `cron.list` handler 将该分页结果直接作为 RPC 响应；客户端不能把分页对象简化为任务数组。

## 当前实现

- JunQi 每次请求使用官方 `cron.list`，传递 `includeDisabled: true`、`limit: 200` 和当前 `offset`。
- 每页严格校验元数据、任务数量、分页边界和前进关系，并要求所有页面使用同一个 `snapshotRevision`。
- `hasMore` 为真时按官方 `nextOffset`继续读取；遇到非法或不前进的响应立即失败关闭，不拼接伪数据。
- 只有全部页面成功后才提交 Cron 列表投影；状态读取仍独立处理。

## 验证结果

- `src/stores/gatewayDataStore.test.ts` 覆盖单页、双页拼接、非法分页元数据和旧数组响应拒绝。
- 定向数据层测试通过；完整测试、lint、构建和官方文档链接检查需在本阶段收尾时重跑。

## 未验证边界

- 尚未在真实 Tauri 窗口和超过一页任务的 Gateway 上做端到端视觉验收。
- 真实 Gateway 的任务顺序由 OpenClaw 返回，JunQi 不在本地重排或补造创建时间。
