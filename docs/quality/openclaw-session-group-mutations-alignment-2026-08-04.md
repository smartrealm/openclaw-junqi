# OpenClaw 原生会话组写入对齐

日期：2026-08-05

## 审计结论

OpenClaw 官方 Gateway 提供 `sessions.groups.list`、`sessions.groups.put`、`sessions.groups.rename` 和 `sessions.groups.delete`，并使用单个 session 的 `category` 表达成员归属。JunQi 可以忠实呈现这些通用会话整理能力，但不得把 Voice Wake 路由或 Jarvis Talk 自动映射为某个 group。

## 权威来源

本次直接核对官方工作树提交 `1e3880352e614116549c0a30c67a59a2d40ba259` 的：

- `packages/gateway-protocol/src/schema/sessions.ts`
- `src/gateway/server-methods/sessions-groups.ts`
- `ui/src/lib/sessions/session-group-catalog.ts`

该提交用于复现审计结论，不作为客户端版本锁。JunQi 仍以已连接 Gateway 的方法广告、响应和连接身份为运行时边界。

## 实施边界

- 组目录和成员 category 都由 Gateway 确认；JunQi 不在本地伪造目录或成功状态。
- `sessions.groups.put` 是整体替换协议，只能基于当前连接刚读取的目录追加去重名称。
- rename 和 delete 的成员批量更新必须由 Gateway 原生方法完成，不能由客户端遍历 session 模拟。
- `sessions.patch.category` 只修改一个 session。Voice Wake 的 current、agent、session 路由不隐含任何 category 写入。
- Gateway 不广告相关方法、连接切换或响应畸形时失败关闭，并保留已确认的最后快照。

## 验证边界

自动化覆盖方法广告、目录读取、追加、改名、删除、category 投影和连接围栏。真实 Gateway 多客户端并发顺序将在实际执行后单独记录；它与桌面语音设备兼容性无关。
