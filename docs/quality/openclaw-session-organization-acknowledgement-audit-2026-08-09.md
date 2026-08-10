# OpenClaw 会话组织写入回执审计

## 依据

- 最新 OpenClaw `SessionsPatchParamsSchema` 将 `pinned`、`archived`、`unread` 与 `category` 定义为
  `sessions.patch` 的原生会话字段。
- 最新 OpenClaw `sessions-mutations.ts` 在写入完成后以 `SessionsPatchResult.entry` 返回实际持久化条目。
- JunQi `OpenClawSessionOrganizationClient` 是侧栏和会话操作菜单的唯一组织字段写入边界。

## 发现

### BUG-01 高风险：布尔组织字段未核验写入后的条目

`OpenClawSessionOrganizationClient` 原先只核验回执的 `ok`、`key` 和 `entry` 对象存在。随后
`chatStore` 会把请求中的 `pinned`、`archived` 或 `unread` 直接投影到本地。

若 Gateway 返回结构合法但 `entry` 中的实际字段与请求不一致，客户端会错误显示写入成功。这违反
JunQi 只能消费 Gateway 已确认状态的边界。

## 目标

- `pinned`、`archived`、`unread` 与既有 `category` 一样，必须逐字段核验 `entry` 的实际值。
- 字段缺失、类型不符或值不一致时抛出 `SessionOrganizationResponseError`，不得更新本地会话投影。
- 不增加本地重试、兼容分支或影子状态。

## 验证边界

自动化覆盖合法回执、字段缺失和字段值不一致。真实 Gateway 写入与多智能体全局会话真机验收仍在
`PROJECT_STATUS.md` 的后续项中保留。
