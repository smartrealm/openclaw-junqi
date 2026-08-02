# OpenClaw 原生会话检索对齐

日期：2026-08-03

## 结论

JunQi 会话管理器现在把会话元数据筛选与 OpenClaw Gateway 的只读转录检索分开呈现。
用户输入查询后，JunQi 通过官方 `sessions.search` RPC 展示 Gateway 返回的真实命中；
不会从本地缓存、`sessions.preview` 或工作区文件合成全文命中。

## 权威依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw session schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw sessions.read handlers](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-read.ts)
- [OpenClaw method scopes](https://github.com/openclaw/openclaw/blob/main/src/gateway/method-scopes.ts)

当前官方 schema 将 `sessions.search` 请求限制为非空 `query`，可选 `agentId`、最多
200 个 `sessionKeys` 和 1 到 25 的 `limit`。命中必须包含 `sessionKey`、`sessionId`、
`messageId`、`role`、`timestamp`、`snippet` 和 `score`；响应还可以包含布尔型
`indexing` 与 `truncated`。官方 handler 负责选择会话存储、执行索引检索和排序，方法
权限为 `operator.read`。

`sessions.resolve` 已单独核对，但其官方结果只返回规范化 `key`，不返回 JunQi 当前
会话恢复链路需要的 `sessionId`。现有调用方已经持有 canonical session key，继续加入
一次没有用户价值的解析 RPC，因此本次不接入该方法。

## 当前行为

1. 会话管理器的筛选栏继续在本地按真实 `sessions.list` 元数据筛选，并保留运行状态、
   Agent、模型、类型和 Jarvis 分类过滤。
2. 查询非空时，data store 只在 Gateway 广告 `sessions.search` 后发送原生 RPC。页面
   展示官方返回的片段、会话 key、消息 id、角色、时间和分数。
3. `indexing` 与 `truncated` 原样显示为 Gateway 状态；空结果只表示 Gateway 返回了
   空命中，不代表 JunQi 进行了本地全文扫描。
4. 未连接、未广告能力、非法响应、连接替换和迟到响应都有明确状态；最新查询栅栏只
   允许当前连接和当前查询提交结果。
5. 点击命中卡片只按官方 `sessionKey` 打开现有 Chat tab，不创建新的会话身份，也不
   修改 Gateway 会话内容。

## 验证

- `OpenClawSessionSearchClient.test.ts` 覆盖官方请求边界、字段校验、可选布尔状态、
  空片段和未来附加字段。
- `gatewayDataStore.test.ts` 覆盖能力广告、未支持方法不发 RPC、最新查询提交、
  Gateway 状态保留和断线清理。
- TypeScript 检查、模块边界、版本一致性、定向 Gateway 测试、完整测试、生产构建、
  官方链接校验和 `git diff --check` 均已通过。

## 未验证边界

- 尚未连接真实 Gateway 验证全文索引建立中、截断、无结果和权限拒绝的现场组合。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验收长时间输入、断线重连和大结果集合下
  的页面布局。
- 本次不接入写操作、工具调用、浏览器 API、客户端自建 transcript 索引或自定义搜索协议。
