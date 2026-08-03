# OpenClaw 会话 category 权威性对齐

日期：2026-08-04

## 结论

JunQi 曾把不存在的 `sessions.groups.list`、`sessions.groups.put`、
`sessions.groups.rename` 和 `sessions.groups.delete` 当作 OpenClaw 原生 RPC，并据此提供创建、
改名和删除全局分组的 UI。这是客户端捏造能力，必须删除。

OpenClaw 当前提供的是 `sessions.patch.category`：category 是单个 session 的用户定义组织 bucket，
不是独立的 group catalog。JunQi 只允许在 Gateway 确认该 patch 后投影 category；侧栏与菜单中的
分类列表由已读取的 `sessions.list` session category 去重得到。Jarvis 唤醒词派生的 category 也通过
同一个官方 patch 写入当前 session。

## 权威依据

- 当前安装 OpenClaw 的 `dist/server-methods-NpEcZnvp.js` sessions registry 列出
  `sessions.patch`，不包含任何 `sessions.groups.*`。
- `dist/schema-BuOFpc7K.js` 的 `SessionsPatchParamsSchema` 把 `category` 定义为可选的
  `SessionLabelString | null`，并注明它是 user-defined organization bucket。
- `dist/sessions-UcKjjh_n.js` 的 `sessions.patch` handler 应用 patch 后返回确认的 session entry，
  并发出 `sessions.changed`。
- `dist/session-create-service-14oZxrT5.js` 在 category 非空时写入 entry，在 null 时移除字段；没有
  全局 category registry。
- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)

安装包用于本机可复现证据；字段和方法以官方 schema、handler 和 method registry 为契约。

## 当前与目标行为

- 修复前：JunQi 读取和写入虚构的 group catalog，改名/删除还会把客户端预测成员关系显示为成功。
- 修复后：不存在独立 group catalog、全局改名或删除操作。用户可以将单个 session 设为某个 category，
  或清空其 category；分类列表仅呈现当前 session snapshot 中已确认的 category。
- Jarvis 唤醒成功后把 `Jarvis: <trigger>` 写入当前 session 的 `category`。Gateway 确认返回的 entry
  必须匹配该 category，之后才更新本地投影。
- 不新增 RPC、批量 mutation、本地 category 持久化或重试语义；跨客户端变化只由 Gateway
  `sessions.changed` 和后续 `sessions.list` 收敛。

## 验证结果

- `node --import ./test-setup.ts --import tsx --test src/services/gateway/OpenClawSessionOrganizationClient.test.ts src/services/voice/JarvisSessionCategory.test.ts src/stores/chatStore.test.ts`：36 项通过。
- `pnpm lint`：通过，包含模块边界、版本一致性和 TypeScript 检查。
- `pnpm test`：通过。
- `pnpm build`：通过，包含 collaboration bundle、TypeScript 和 Vite 生产构建。
- `pnpm verify:openclaw-docs`：通过，官方 OpenClaw 协议文档链接可验证。
- `pnpm collab:test && pnpm collab:validate`：通过。
- `pnpm test:rust`：705 项通过，3 项按现有条件忽略。
- `rg` 审查：生产 `src/` 不再包含 `sessions.groups.*`、group catalog 或其 UI/store 调用。

## 未验证边界

- 尚未连接真实 Gateway 验证 category patch 与 `sessions.changed` 到达顺序。
- macOS、Windows、CentOS、Ubuntu 的桌面真机唤醒和分类投影仍需分别验证。
