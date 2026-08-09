# 默认智能体与主会话审计

日期：2026-08-09

## 发现

原实现同时使用 `agents.list.defaultId`、`agents.list.mainKey`、字面量 `main` 与 `agent:*:main` 正则表达式。`defaultId` 是默认智能体，`mainKey` 是主会话后缀，完整默认主会话由 OpenClaw 的 `agent:<defaultId>:<mainKey>` 路由规则确定；它们不能互换。

Dashboard、智能体中心和会话页签中存在将 `agent:main:main` 视为唯一主会话的展示逻辑；会话菜单又将所有 `agent:*:main` 视为不可删除主会话。两个规则互相矛盾，也不能支持 Gateway 返回非传统 `defaultId` 或 `mainKey`。

## 调整

- 依据 OpenClaw 官方路由规则从 `defaultId`、`mainKey` 与 `scope` 解析完整默认主会话 key；仅该完整 key 决定全局固定页签、关闭入口和删除入口。
- 默认智能体显示与新会话默认选择读取 `defaultId`。
- 其他智能体直聊会话保留其 OpenClaw 语义，但不投影为 JunQi 全局主会话。
- “打开主会话”只使用 Gateway 已返回的 key；不会再为其他智能体拼接可能尚不存在的 key。其他智能体仅在已返回会话的后缀与当前默认主会话一致时才识别为直聊主会话。没有已返回的直聊主会话时，界面保留官方新建会话入口并明确提示。
- 会话管理页的删除入口与标签也改为使用解析后的完整默认主会话 key，不再把所有 `:main` 会话误判为全局不可删除主会话。

## 依据差异

本机已安装的 OpenClaw 官方运行时代码在 `agents.list` schema 中将 `defaultId` 和 `mainKey` 声明为独立非空字段，并通过 `buildMainSessionKey(agentId, mainKey)` 构建每个智能体的完整会话 key。随包官方文档同时说明当前运行时固定使用 `main` 后缀，且忽略自定义 `session.mainKey`。JunQi 按运行时实际返回字段解析完整 key，并只把其他智能体已返回的同后缀会话视为可打开入口；因此不会依赖未返回的自定义值。尝试访问最新版官方线上文档在本轮返回服务不可用，尚未完成线上版本复核。

## 验证

待本轮最终验证后记录结果。尚未在真实 Tauri 桌面应用连接非传统默认智能体或自定义会话后缀的 Gateway 进行视觉验收。
