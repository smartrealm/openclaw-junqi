# OpenClaw 原生会话组目录投影

日期：2026-08-04

## 结论

JunQi 已通过 `sessions.patch.category` 将 Jarvis 唤醒词归属写回 OpenClaw；但此前的
category 菜单只从当前已加载 session 快照去重，不能展示 Gateway 已登记而暂时没有成员的
原生 group catalog。最新版官方 OpenClaw schema、method descriptor 和 handler 已提供
`sessions.groups.list`，且 `sessions.patch.category` 会将非空 category 登记到该 catalog。

JunQi 应新增只读、严格解码的 catalog 投影。Gateway 不支持该方法、拒绝权限或返回无效
payload 时，客户端不得创建本地 group 或将当前 session 列表伪装为完整 catalog；现有已确认
session category 仍可作为该 session 的归属展示。

## 权威依据

- [OpenClaw session schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/sessions.ts)
- [OpenClaw session group handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-groups.ts)
- [OpenClaw session mutation handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/sessions-mutations.ts)
- [OpenClaw core method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

官方 schema 定义 `sessions.groups.list` 返回有序 `{ name, position }` 目录，权限为
`operator.read`。mutation handler 对非空 `category` 调用 `ensureSessionGroupRegistered`，
所以 Jarvis 不需要自行执行 list/put 的读改写来“创建”唤醒词分组。

## 审计范围

- `src/services/gateway/OpenClawSessionGroupsClient.ts`
- `src/services/gateway/index.ts`
- `src/stores/chatStore.ts`
- `src/components/Chat/session-actions/SessionActionsMenu.tsx`
- Jarvis 的既有 `sessions.patch.category` 调用链

## 目标行为

1. 组目录请求始终走已认证 Gateway 普通连接，并严格校验完整响应、非空名称和非负安全整数位置。
2. catalog 读取是可选的原生增强。方法不存在时明确标记不可用，不保存、不合成、不重试为本地 catalog。
3. 分类菜单在成功读取后使用 Gateway catalog 的顺序，并并入当前已确认 session category，避免尚未刷新的 catalog 隐藏已确认成员。
4. Gateway 目录不可用或读取失败时，菜单只保留已确认 session snapshot 中的 category，不宣称其为完整原生目录。
5. Jarvis 继续只提交已验证触发词派生的 `sessions.patch.category`；不新增本地 group、批量 patch 或目录写操作。

## 验证结果

- 定向回归覆盖 catalog 的 Gateway 顺序、缺失 method、不完整 payload、目录暂态清理和
  Jarvis category 确认：41 项通过。
- `pnpm lint` 通过，包含模块边界、版本一致性与 TypeScript 检查。
- `pnpm test` 通过；测试输出含现有 React SSR `useLayoutEffect` 警告，未导致失败。
- `pnpm build`、`pnpm verify:openclaw-docs` 与 `git diff --check` 通过。
- 本轮修改文件的 Emoji 扫描和 production `src/` 遗留 group catalog 引用审查通过。

## 未验证边界

- 尚未在真实 Gateway 上验证 `sessions.changed` 与 catalog 更新到达的精确顺序。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验收后台唤醒后目录刷新表现。
- 目录写入、改名和删除不属于本轮范围；后续必须单独核对 `put` 的全量替换和跨客户端并发语义。
