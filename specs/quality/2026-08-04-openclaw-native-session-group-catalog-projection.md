# OpenClaw 原生会话组目录投影规格

## 当前行为

JunQi 可确认单个 session 的 `category`，但分类菜单仅从已加载 session 去重。因此 Gateway
已登记、没有当前成员或尚未包含在本次 `sessions.list` 页的 group 不会显示。

## 目标

在 Gateway 支持时读取并投影官方 `sessions.groups.list` catalog，同时保持 category membership
只由 `sessions.patch.category` 和 `sessions.list` 的确认结果决定。

## 约束

- 不使用 localStorage、renderer store 或静态常量充当 group catalog。
- 不因 Gateway hello 的 methods 列表缺项而假定不支持；实际 RPC 的明确 unsupported 响应才是不可用证据。
- 不把 transport、认证、权限或 response 解析失败误判为不支持。
- 不新增 group 写入、跨 session mutation 或自定义 Jarvis session key。
- 会话菜单不能直接依赖 gateway service；只能通过 chat store 的投影读取和触发刷新。

## 验收条件

- [x] client 只接受官方完整 `groups` 响应，并按 `position` 返回 group name。
- [x] `METHOD_NOT_FOUND`、`UNKNOWN_METHOD`、`UNKNOWN_COMMAND` 显式映射为 catalog unavailable；其他失败原样保留。
- [x] 成功读取后的菜单按 native catalog 显示，同时保留已确认的当前 session category。
- [x] catalog 不可用时不产生本地 catalog，既有 session snapshot category 仍可被选择。
- [x] Jarvis category 写入保持一个已确认的 `sessions.patch.category` 请求，不追加 catalog 写操作。
- [x] 回归、类型、边界、构建、文档链接、无遗留引用和 Emoji 扫描通过。
