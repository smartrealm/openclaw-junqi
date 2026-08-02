# OpenClaw 原生会话检索对齐规格

日期：2026-08-03

## 目标

让 JunQi 会话管理器使用 OpenClaw Gateway 官方 `sessions.search` 读取真实转录命中，
同时保留现有会话元数据筛选和 `sessions.preview` 最近消息预览。

## 约束

1. 只调用官方 descriptor、schema 和 handler 已确认的 `sessions.search`，权限保持
   `operator.read`。
2. 请求只能发送官方支持的 `query`、`agentId`、`sessionKeys` 和 `limit`，并执行官方
   上限校验；不得添加 group、wake word 或 JunQi 私有字段。
3. Gateway 是索引、排序、会话身份、消息身份、角色、片段和分数的唯一权威。JunQi
   不从本地 preview、聊天状态或文件内容合成转录命中。
4. 响应必须验证官方必需字段和布尔状态；已知字段类型错误不得进入 UI，未来附加字段
   可以忽略。
5. 结果状态必须绑定当前 Gateway 连接和最新查询；断线、未广告能力、查询替换和迟到
   响应不能覆盖当前结果。

## 验收条件

- 会话管理器搜索框继续筛选本地会话元数据，并在查询非空时显示 Gateway 转录命中。
- 未广告 `sessions.search`、未连接、非法响应或 RPC 失败时显示明确状态，不显示伪造
  的本地全文命中。
- `indexing` 和 `truncated` 的 Gateway 状态被保留并可见；空结果不被解释为索引完成。
- 点击命中按官方 `sessionKey` 打开既有 Chat tab，不生成新的 session key。
- TypeScript、定向回归、完整测试、构建、边界和文档链接校验通过，文档记录未验证平台。

## 非目标

- 不接入 `sessions.resolve`，因为其官方结果只提供 canonical key，当前调用方不缺少
  key 且需要的 session id 不由该接口返回。
- 不实现客户端全文索引、转录编辑、删除、重命名协议或自定义会话 group。
- 不绑定某个 OpenClaw 安装版本、操作系统、Gateway 地址或本机缓存路径。
