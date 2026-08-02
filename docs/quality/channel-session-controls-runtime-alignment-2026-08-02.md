# 渠道与会话控制运行时对齐（2026-08-02）

## 依据

- 当前工作区相邻官方源码 `../openclaw/src/gateway/methods/core-descriptors.ts` 将 `channels.start`、`channels.stop`、`channels.logout`、`sessions.patch`、`sessions.reset` 与 `sessions.delete` 定义为 `operator.admin`。
- `../openclaw/packages/gateway-protocol/src/schema/channels.ts` 的 `channels.status` 返回 `channelMeta` 与 `channelSystemImages`；元数据只提供语义化 `systemImage`，不提供品牌图标文件。
- `../openclaw/packages/gateway-protocol/src/schema/sessions.ts` 定义会话标签、重置、删除、压缩及基于压缩检查点的分支；没有置顶、未读或用户分组字段。

## 当前行为与修复

- 渠道的启动、停止、登出改为复用 `gateway.callPrivileged` 的单次管理员连接。未获管理员授权时沿用已有配对和授权错误处理，不再从日常读写连接直接请求。
- 渠道中心从 Gateway `channelSystemImages` 读取图标语义，并由统一的 JunQi 图标组件渲染；未知语义使用通用消息图标，不维护渠道 ID 或厂商品牌的静态映射。
- “添加通道”目录会标出当前配置或运行时已发现的渠道。已写入当前配置的条目定位到配置卡，不重复触发添加流程。
- 会话重命名同样改走管理员连接，匹配当前方法级权限。
- 置顶、标记未读和归档被定义为 JunQi 本机视图偏好。归档可在左侧“本机归档”展开并恢复；它们不会被发送到 OpenClaw，也不会承诺跨客户端同步。

## 未实现边界

- “分叉”只在存在 OpenClaw 压缩检查点时可通过 `sessions.compaction.branch` 创建，不能从任意对话快照伪造分支。
- 用户自定义会话分组没有当前 OpenClaw 协议字段。引入该能力需要独立的 JunQi 本机组织模型、迁移和跨窗口一致性设计，不能借用 Gateway 标签或会话 key。
- 未使用真实渠道账号或管理员授权设备进行端到端验证；自动化验证仅覆盖请求路由、类型和静态边界。
