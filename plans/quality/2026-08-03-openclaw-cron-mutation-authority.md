# OpenClaw Cron 写操作授权与日历一致性实施计划

日期：2026-08-03

## 执行顺序

1. 新建严格 Cron management client，封装 add、窄 update 和 remove 的 canonical 参数、响应和 unsupported 语义。
2. 将 client 接入现有 `requestPrivileged` 管理员 transient connection，并从 Gateway facade 导出有限 mutation API。
3. 将 CronMonitor 的创建、模板、启停、Agent 路由和确认删除写操作迁移到 facade；补充启停与删除读回失败的可见错误。
4. 将 Calendar reminder 的创建与删除迁移到 facade；重排更新和删除流程，使远端删除确认先于本地关联丢弃。
5. 为 management client 与 Calendar reminder 状态机添加行为回归测试。
6. 更新文档索引、验证记录和完成状态，运行定向测试、lint、官方链接核验及差异检查后中文提交。

## 文件范围

- `src/services/gateway/OpenClawCronManagementClient.ts`
- `src/services/gateway/OpenClawCronManagementClient.test.ts`
- `src/services/gateway/index.ts`
- `src/pages/CronMonitor.tsx`
- `src/stores/calendarStore.ts`
- `src/stores/calendarStore.test.ts`
- 本轮 audit、spec、plan、validation 与目录索引

## 完成判据

- [x] Cron 写操作使用最小的临时管理员连接，不扩大日常连接的权限。
- [x] client 不接受或解码未受支持的泛型 Cron payload 字段。
- [x] Calendar 不会因未确认的远端删除而丢失本地追踪信息。
- [x] 回归测试、lint、官方链接和差异检查有可复现结果。

## 2026-08-08 复审补充

1. 在任务安全投影中保留官方可选 `configRevision`，并拒绝空值。
2. 扩展窄 `cron.update` 客户端，使调用方只能传入 Gateway 返回的可选修订令牌。
3. 在 CronMonitor 的启停和 Agent 路由调用点传递当前列表快照的令牌。
4. 覆盖解析、请求 envelope 和空令牌拒绝回归测试。
