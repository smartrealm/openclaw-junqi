# OpenClaw 原生会话组写入对齐规格

## 依据

官方 OpenClaw 源码提交 `1e3880352e614116549c0a30c67a59a2d40ba259`：

- `packages/gateway-protocol/src/schema/sessions.ts` 定义 `sessions.groups.put`、
  `sessions.groups.rename` 与 `sessions.groups.delete`，组目录由有序名称集合构成。
- `src/gateway/server-methods/sessions-groups.ts` 表明 rename 和 delete 由 Gateway 原子更新成员
  session 的 `category`，并向其他客户端广播 `sessions.changed`。
- `ui/src/lib/sessions/session-group-catalog.ts` 用 `sessions.groups.put` 保存自定义组目录，不能在
  客户端伪造组目录或逐个模拟 rename/delete 的成员更新。

## 当前行为

JunQi 仅通过 `sessions.patch({ category })` 将会话归类。它能表达成员归属，却不会将新名称写入
Gateway 组目录。Jarvis 唤醒词触发后因此只有单会话 category，没有可跨客户端共享和排序的原生 group。

## 目标行为

1. 对可用的原生 group API，创建或选用分类前先由 Gateway 确认目录包含该名称，再写入会话
   `category`。
2. Jarvis 唤醒词派生的分类沿用现有名称规则，但只有目录和会话归属都已确认时才开始该次语音交互。
3. `sessions.groups.put` 只能基于刚读取的 Gateway 目录追加去重名称；返回必须严格确认完整目录。
4. 不在客户端伪造组、伪造 rename/delete 成功，或以本地存储替代 Gateway 目录。
5. 明确不支持 group 目录的旧 Gateway 不把缺失功能伪装为成功；既有 `sessions.patch.category`
   能力保持其独立的原生错误语义。

## 验收条件

- Gateway client 回归覆盖目录读取、去重追加、畸形响应、未知方法和连接切换。
- Jarvis 唤醒回归覆盖先确认原生目录、再确认会话归属、任一失败均不开始语音交互。
- 既有手动会话分类入口复用同一编排链路。
- TypeScript、相关回归、模块边界、生产构建与官方文档链接验证通过。
