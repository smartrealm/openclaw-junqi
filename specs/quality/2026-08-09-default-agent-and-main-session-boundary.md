# 默认智能体与主会话边界

日期：2026-08-09

## 上游契约

- `agents.list.defaultId` 是 OpenClaw 返回的新会话默认智能体标识。
- `agents.list.mainKey` 是 OpenClaw 返回的主会话后缀；完整默认主会话由 `scope` 决定：`per-sender` 使用 `agent:<defaultId>:<mainKey>`，`global` 使用 `global`。
- 对每个智能体，OpenClaw 使用该主会话后缀构建其直聊主会话 key；它不等于 JunQi 全局固定的主会话，除非该 key 与解析后的完整默认主会话完全相同。

## JunQi 投影规则

- 只将精确匹配解析后的完整默认主会话 key 的会话固定在页签最左侧，并隐藏关闭和删除入口。
- 新建会话只调用官方 `sessions.create`，默认选择当前活动会话所属智能体；没有当前智能体时使用 `defaultId`。创建成功前不加入本地会话列表，成功后保留确认的空 transcript leaf。
- 其他智能体已返回、且后缀与默认主会话一致的直聊主会话可以作为入口打开，但不显示为全局主会话，也不因该 key 形态获得全局固定身份。
- 默认主会话可由官方 `agents.list` 路由字段解析；其他智能体直聊主会话仅能从当前 Gateway 会话列表确认后打开，缺少该证据时不得拼接 session key。
- Dashboard、智能体中心和会话上下文必须使用 Gateway 投影，不得写死 `agent:main:main` 或假定默认智能体 id 为 `main`。

## 验收

- 当 `defaultId` 和传统 `main` 不同时，新建会话使用当前活动智能体或 `defaultId`，不回退到字面量 `main`。
- 当主会话后缀为非传统值时，只有按 `defaultId` 与该后缀解析出的完整默认主会话位于页签最左侧并受保护。
- 创建普通新会话后，输入区立即可用，历史读取不覆盖已确认的空会话身份。
- 未返回某智能体直聊主会话时，选择“打开主会话”不会产生本地空页签；用户仍可创建官方新会话。
- 当 `mainKey` 使用自定义后缀时，只识别同后缀且已由 Gateway 返回的其他智能体直聊主会话。
