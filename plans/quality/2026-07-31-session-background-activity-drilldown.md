# 会话分组与后台活动下钻实施计划

## 阶段 0：确认协议事实

1. 从当前安装的 OpenClaw 2026.7.1 官方 Protocol 与源码读取 `sessions.list`、`sessions.describe`、`cron.runs` 的请求和响应 schema。
2. 在隔离的真实 Gateway 环境采集普通会话、隔离 cron、共享 cron、子智能体、hook/heartbeat 和已清理运行的脱敏响应 fixture。
3. 记录 session key、sessionId、jobId、runId 的可确认关联。没有实际字段证据的关联不进入实现。
4. 将协议依据、fixture 来源、版本和未覆盖类型写入 validation 文档。

## 阶段 1：建立独立领域契约

1. 在 `src/domain/background-activity/` 或现有等价领域目录新增纯类型、分类投影和 `BackgroundActivityReference` 编解码器。
2. 将 `src/utils/sessionPresentation.ts` 收敛为该领域的兼容出口或迁移消费者，删除依赖标题/prompt 的梦境正则。
3. 在协议适配层集中解析官方 session key 与 `origin`，避免组件、活动中心和 Chat 各自判断。
4. 添加分类、未知来源保留、引用 round-trip、无效引用失败关闭和 session instance 一致性测试。

## 阶段 2：实现数据读取与精确解析

1. 在 Gateway service 层增加类型化的 `sessions.describe` 与按 `jobId`、`runId` 查询 `cron.runs` 的最小 wrapper；严格校验响应，禁止 `any` 和静默默认值。
2. 新增背景活动解析器，以当前快照和已验证 Gateway 响应构建行摘要与详情状态。
3. 对 Cron 关联使用两段式结果：任务匹配与运行精确匹配分别表示；缺失关联时不伪造 run 选择。
4. 将缓存、取消和 Gateway identity 切换放在 service/store 边界；页面只消费投影。

## 阶段 3：接入侧栏与目标页面

1. 修改 `src/components/Layout/NavSidebar.tsx`，只渲染领域投影的对话分组与后台摘要，不在组件内解析 session key 或构造 URL。
2. 修改 `src/pages/CronMonitor.tsx`，消费标准引用，选择任务并在已确认时选中单次运行；支持刷新后的 URL 恢复。
3. 修改 `src/pages/ActivityCenter.tsx`，消费标准引用并显示精确会话详情。缺失或失配时保留不可用状态。
4. 修改 Chat 会话打开边界，使子智能体会话的 `sessionId` 校验失败时不回退到同 key 或当前会话。
5. 增加三语文案和无障碍标签；技术身份只放在按需展开详情。

## 阶段 4：验证与文档

1. 补充单元测试：官方 fixture 分类、Cron run 精确/不精确关联、session reset/reuse、已清理记录、无效深链。
2. 补充组件或路由测试：侧栏点击后 Cron、活动中心和 Chat 分别消费相同引用；刷新 URL 后恢复；无效 URL 不改变选择。
3. 运行定向测试、`pnpm lint`、`pnpm test`、`pnpm build` 和 `git diff --check`。
4. 在 macOS、Windows、Linux 分别进行 Gateway 在线、断线恢复、保留期清理后的桌面点击验收，写入 validation 文档并明确未覆盖项目。

## 预计文件范围

- `src/utils/sessionPresentation.ts` 或迁移后的背景活动领域模块。
- `src/utils/backgroundActivityNavigation.ts` 或迁移后的引用路由模块。
- `src/services/gateway/` 下的类型化读取适配器与测试。
- `src/components/Layout/NavSidebar.tsx`。
- `src/pages/CronMonitor.tsx`。
- `src/pages/ActivityCenter.tsx`。
- Chat 会话打开的现有协调器及其测试。
- `src/locales/en.json`、`src/locales/zh.json`、`src/locales/zh-TW.json`。
- 对应 `docs/quality/` validation、`specs/quality/` 与 `plans/quality/` 文档。
