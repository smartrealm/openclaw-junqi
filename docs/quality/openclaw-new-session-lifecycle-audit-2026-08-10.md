# OpenClaw 新建会话全流程审计

## 审计范围

本次审计覆盖桌面端新建会话的两个入口：会话页签中的新建选择器，以及带有 `agent` 和 `new=1` 的路由入口。检查范围包括智能体选择、Gateway 请求、回执校验、本地会话投影、活动页签、历史加载、首条消息发送和失败重试。

## 官方依据

- OpenClaw `sessions.create` 是新建会话的唯一远端入口，回执必须提供 `ok`、`key`、`sessionId` 和一致的 `entry.sessionId`。
- Gateway 生成的会话 key 携带智能体身份；JunQi 只接受回执中的身份，并核对其与请求的智能体一致。
- OpenClaw 的新会话可选参数由协议决定。JunQi 当前产品入口只确认智能体作用域和空白桌面会话，不自行扩展模型、思考级别或工作区语义。

## 当前链路

1. 新建选择器根据当前会话 key、已确认的智能体列表和默认智能体解析目标智能体，不通过数组顺序猜测目标。
2. `createNativeSession` 只调用官方 `sessions.create`，请求仅发送已确认的 `agentId` 和用户明确提供的字段。
3. Gateway 回执经 `OpenClawSessionLifecycleClient` 严格校验。缺少身份、`ok` 非真值或 key 的智能体与请求不一致时，操作失败关闭。
4. 回执通过后，`chatStore.addNativeSession` 和 `gatewayDataStore.setSessions` 才提交会话投影，并将该会话设为活动页签。
5. 普通非 fork 会话以 `activeLeafEntryId: null` 表示 Gateway 已确认的空 transcript。历史加载守卫和首发预热守卫均跳过该会话，因此新建会话不会显示旧历史加载状态，也不会阻塞输入框。
6. 发送仍使用当前会话的 `sessionId`，由 OpenClaw 原生 `chat.send` 链路处理。创建失败时不消费路由意图，选择器保持打开并提供重试。
7. 会话列表的迟到快照由创建提交通知和 projection revision 围栏处理，不能删除或替换刚确认的新会话身份。

## 验证结果

- `src/utils/sessionCreate.test.ts` 覆盖空 transcript、Gateway 回执确认、智能体绑定、重复创建、fork 参数和失败不提交。
- `src/utils/confirmedEmptyTranscript.test.ts` 覆盖新会话不加载历史以及首发不预热。
- `src/components/Chat/newSessionEntryContracts.test.ts` 覆盖选择器确认前不关闭、路由创建期间不挂载旧 ChatView 和显式重试。
- 当前完整测试、lint、生产构建、官方文档链接校验和 `git diff --check` 均通过；真实 Tauri 窗口、断线重连和多智能体 Gateway 尚未在本轮实机验证。

## 未覆盖边界

OpenClaw 官方协议还支持模型、思考级别、可见性、工作区等可选的新会话参数。JunQi 当前入口没有这些产品需求或对应桌面交互，因此保持不暴露，不创建本地替代语义。若后续需要开放，必须先按最新版官方 schema 和 Control UI 行为单独设计、实现和验收。
