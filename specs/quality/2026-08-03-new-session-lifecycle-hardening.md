# 新建会话生命周期加固规格

日期：2026-08-03

## BUG-NS-01：Transcript 分叉协议

当前：会话菜单只传 `parentSessionKey`，OpenClaw 创建普通子会话而非复制 transcript。

目标：`fork: true` 必须和非空 `parentSessionKey` 一同传给 `sessions.create`；本地协议 client 与创建协调器都拒绝无父 key 的分叉。普通父关联不默认变成分叉。

验收：

- [ ] 分叉菜单向创建协调器传递 `fork: true`；
- [ ] Gateway 请求包含规范化 `parentSessionKey` 与 `fork: true`；
- [ ] `fork: true` 且无父 key 时不发出 RPC；
- [ ] 普通创建不发送 `fork` 字段。

## BUG-NS-02：完整创建意图与 Agent 一致性

当前：侧栏固定创建到 `main`，创建去重忽略 label 和分叉语义。

目标：所有普通新建入口按当前会话与 Gateway Agent roster 解析目标 Agent，且不传持久 `label`，由 OpenClaw 按首条用户消息生成标题。`chat.newSessionLabel` 仅是本地空标题显示兜底。飞行期仅合并完全相同的规范化创建意图。

验收：

- [ ] 非 main 当前会话从侧栏新建仍属于该 Agent；
- [ ] 不同 label 或不同 fork 语义的并发请求分别到达 Gateway；
- [ ] 完全相同的重复点击只发出一次 Gateway 请求；
- [ ] 普通创建请求不含 `label`；侧栏、标签栏与路由入口用同一本地化兜底文案展示空标题。

## BUG-NS-04：路由创建失败可恢复

当前：路由参数在 RPC 前被消费，失败后只剩 toast。

目标：创建成功后才清除 `agent` 与 `new` 参数。失败状态保留原意图并显示可操作的重试按钮；重试由用户触发，每一轮最多请求一次。

验收：

- [ ] 请求失败时 URL 仍保留 `agent` 与 `new=1`；
- [ ] 失败通知提供重试且不会自动重复请求；
- [ ] 请求成功后才以 replace 方式移除参数；
- [ ] 每个 location key 与 retry attempt 最多执行一次创建。

## BUG-NS-05：已确认创建不被旧列表删除

当前：已由 session projection revision 加固。

目标：保持现有因果栅栏。创建前开始的 complete snapshot 可以更新展示字段但不得移除或回滚已确认会话；创建后开始的权威 complete snapshot 可以清理已不存在的会话。

验收：

- [ ] 现有 `chatStore` 时序回归测试继续通过；
- [ ] 原生创建成功后仍发出 list refresh 通知；
- [ ] 不引入 optimistic 或本地伪会话。
