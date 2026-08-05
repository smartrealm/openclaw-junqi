# OpenClaw 原生会话消息截断对齐规格

## 范围

本规格约束 JunQi 对 OpenClaw `sessions.rewind` 与 `sessions.fork` 的客户端投影。JunQi 只把
Gateway 已持久化的用户消息 `entryId` 作为目标，不创建、推断或修改 transcript DAG。

## 目标行为

1. 仅对具备 Gateway `nativeMessageId` 的历史用户消息显示重绕与分叉操作；本地待发送、失败或无
   持久化身份的消息不得成为操作目标。
2. 重绕使用一次性 `operator.admin` 授权通道，分叉使用日常 `operator.write` 通道；二者都必须与
   同一会话的发送和其他 mutation 串行。
3. 当前会话有活动 Run、正在加载 history 或会话 mutation gate 已关闭时，操作必须不可用；Gateway
   的最终拒绝仍须原样向用户呈现。
4. 重绕成功后必须失效旧 history 读取、清空本地旧投影、恢复 Gateway 返回的编辑器文本与有效图片，
   再强制读取同一会话的权威 history。
5. 分叉成功后只在发起会话仍是当前活动会话时切换至 Gateway 返回的新 `sessionKey`；新会话的
   identity、history 和 active leaf 必须继续由 history 读取确认，不能由客户端生成。
6. 恢复附件仅接受官方返回的大小受限、格式正确的内联图片。官方 attachment schema 的可选
   `fileName` 缺失时，JunQi 不得合成名称，也不得在后续发送中加入伪造的文件名。

## 验收条件

- Gateway client 严格校验官方响应，且测试覆盖权限通道、会话串行和畸形响应拒绝。
- 恢复附件测试覆盖有效图片、非法 base64、非图片和大小越界输入。
- 消息 UI 只向可验证的历史用户消息暴露操作，并在成功后使用 history loader 取得 Gateway 投影。
- TypeScript、相关回归、边界检查、构建和官方文档链接验证通过。

## 非目标

- 不绕过 Gateway 对活动 Run、外部 harness 会话或不在活动路径的 entry 的拒绝。
- 不持久化 base64 恢复附件、不伪造文件名、不自动重新发送编辑器内容。
- 不以方法广告、版本号、客户端缓存或本机环境声明此能力可用。
