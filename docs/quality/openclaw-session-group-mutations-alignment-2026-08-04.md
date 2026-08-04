# OpenClaw 原生会话组写入对齐

日期：2026-08-04

## 审计结论

当前官方 OpenClaw 提供 Gateway 拥有的会话组目录和成员归属变更。JunQi 已读取目录且使用原生
`sessions.patch.category` 表达成员归属，但创建新分类时未保存目录名称。这会使 Jarvis 唤醒词会话
只能形成孤立 category，不能保证在其他 OpenClaw 客户端中作为统一 group 出现。

## 权威来源

本机官方工作树提交 `1e3880352e614116549c0a30c67a59a2d40ba259` 的：

- `packages/gateway-protocol/src/schema/sessions.ts`
- `src/gateway/server-methods/sessions-groups.ts`
- `ui/src/lib/sessions/session-group-catalog.ts`

## 实施边界

- 组目录和成员归属均由 Gateway 确认；JunQi 不持久化或猜测目录。
- `sessions.groups.put` 是整体替换协议，客户端只可由最新读取结果追加一个去重名称，不能覆盖未知
  的本地缓存。
- rename/delete 的成员批量更新只能调用 Gateway 原生方法，不能由 JunQi 遍历 `sessions.patch`
  模拟。

## 验证

- `pnpm lint`：通过，包含模块边界、发布版本一致性与 TypeScript 检查。
- `pnpm test`：通过；既有 Radix SSR `useLayoutEffect` 告警不构成失败。
- `pnpm build`：通过，包含协作插件契约、TypeScript 与 Vite 构建。
- `pnpm verify:openclaw-docs` 与 `git diff --check`：通过。

## 未验证边界

- 尚未在真实 Gateway、多个客户端和并发目录写入下验证服务端最终顺序。
- macOS、Windows、CentOS、Ubuntu 的 Jarvis 真机唤醒与组目录持久化仍需分别验收。
