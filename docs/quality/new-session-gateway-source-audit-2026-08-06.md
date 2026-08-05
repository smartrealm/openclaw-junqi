# 新建会话 Gateway 单一来源审计

日期：2026-08-06

## 审计范围

本次审计覆盖桌面启动时的 `loadSessions`、所有新建会话入口、`sessions.create` 确认提交、列表刷新、历史读取和首条消息发送。

## 权威依据

- OpenClaw 官方协议源码 `packages/gateway-protocol/src/schema/sessions-create.ts` 定义 `sessions.create` 的 `agentId`、`parentSessionKey` 和 `fork`。
- OpenClaw 官方服务源码 `src/gateway/session-create-service.ts` 为未提供 key 的创建生成 dashboard session key，并且仅在 `fork: true` 时复制父 transcript。
- Gateway 的 `sessions.list` 是当前会话投影，`chat.history` 和 `chat.send.expectedLeafEntryId` 分别提供 transcript 读取和并发控制。

## 发现与处理

`loadSessions` 在请求 `sessions.list` 前仍执行 JunQi 旧版本地会话标签迁移。该迁移读取和修改历史本地文件，并额外请求 Gateway；它不属于当前 OpenClaw 会话协议，且会延长或失败于工作区和新建会话后的权威列表读取。

已删除前端迁移器、对应 Tauri command 和注册项。JunQi 现在直接读取 OpenClaw Gateway 会话列表；会话标签仅由 Gateway 的 `sessions.create` 与 `sessions.patch` 持久化。遗留本地文件不再被 JunQi 读取、写入或删除。

## 已核对的创建链路

1. 侧栏、Chat 标签栏、Dashboard 路由、技能入口和分叉菜单均收敛到 `createNativeSession`。
2. 创建器仅在 Gateway 返回确认的 `key`、`sessionId` 和 entry 后提交到桌面状态。
3. 普通新会话绑定当前可用 Agent；分叉明确发送 `parentSessionKey` 和 `fork: true`。
4. 非分叉、无初始 turn 的确认会话保留 `activeLeafEntryId: null`，跳过历史预热，并以该值进行首条 `chat.send` 并发断言。
5. 创建期间的旧 `sessions.list` 响应由请求栅栏和投影版本丢弃；同一身份的稀疏列表行不会抹除已确认的空 transcript 标记。

## 验证边界

自动化验证覆盖 TypeScript、Rust、会话创建和列表竞态回归。真实 Gateway 的桌面端创建、首发和分叉仍需在 macOS、Windows、Ubuntu 与 CentOS 分别验收。
