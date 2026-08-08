# OpenClaw 原生会话体验对齐记录

## 结论

OpenClaw Web UI 已提供置顶、未读、重命名、分叉、移动分组、归档和删除等会话体验。JunQi 对齐这些操作，但不把 UI 能力和 Gateway 持久化能力混为一谈。

官方当前 Gateway schema 已原生定义会话组织字段与分组目录。JunQi 不以
本地源码检出、npm 镜像或版本字符串推测当前 Gateway 能力，而是以实际 RPC
结果确认；只有方法或字段被明确识别为不支持时，才使用 identity-bound 的桌面
兼容仓库。

### `sessions.list` 协议校正

锁定依赖 `openclaw@2026.7.1-2` 的实际 schema 规定 `archived` 为可选布尔值：
省略或 `false` 返回活跃会话，`true` 返回归档会话。JunQi 因而分别请求活跃和
归档投影后按会话 key 合并，绝不发送非布尔的三态值。旧 Gateway 只有在明确拒绝
`archived` 字段时才降级为活跃列表；权限、连接或其他协议错误保持可见。

| 操作 | Gateway 方法 | 权限 | JunQi 行为 |
| --- | --- | --- | --- |
| 新建 | `sessions.create` | `operator.write` | 仅在确认返回身份后展示 |
| 父 transcript 分叉 | `sessions.create({ parentSessionKey, fork: true })` | `operator.write` | Gateway 复制父 transcript 并记录父关联 |
| 检查点分叉 | `sessions.compaction.branch` | `operator.write` | 仅在检查点界面可选时提供 |
| 重命名 | `sessions.patch({ label })` | `operator.write` | Gateway 确认后更新本地投影 |
| 重置 | `sessions.reset` | `operator.admin` | Gateway 确认后清理当前 transcript 投影 |
| 删除 | `sessions.delete` | `operator.admin` | Gateway 确认后删除本地缓存与组织状态 |
| 置顶、未读、归档 | `sessions.patch` 的 `pinned`、`unread`、`archived` | `operator.write` | 原生写入并在确认后更新界面 |
| 移动分组 | `sessions.patch({ category })` | `operator.write` | 原生写入并在确认后更新界面 |
| 分组目录 | `sessions.groups.list/put/rename/delete` | 读取为 `operator.read`，写入为 `operator.write` | 原生目录为主；旧 Gateway 明确不支持时本地降级 |

## 实现边界

`OpenClawSessionLifecycleClient` 负责验证 `sessions.create` 响应。`sessionCreate` 负责串联 Gateway 结果、chat store 和 Gateway 数据投影。`OpenClawSessionOrganizationClient` 封装原生 patch 和 group RPC，且只将明确的协议不兼容转换成兼容信号。`sessionOrganization` 保留为旧 Gateway 的 identity-bound 降级仓库及本地推导标题，防止旧会话状态附着到同 key 的新 transcript。旧的按裸 key 保存的 `aegis:session-topic-prefs` 已在首次取得 identity 时迁移并删除。

`SessionActionsMenu` 是标签页和侧栏行共用的操作表面。它不重复实现 Gateway 协议，也不向组件泄漏底层 RPC 细节。

### 2026-08-08 权限路由校正

官方 OpenClaw 主线提交 `c7b7fe4c328b597c69345b258b7f0357e6d3861d` 的
`src/shared/session-method-scopes.ts` 将仅含 `key`、`agentId`、`label`、`category`、
`boardFace`、`icon`、`pinned`、`archived`、`unread` 的 `sessions.patch` 归为
`operator.write`。虽然 `expectedSessionId` 是正式 schema 字段，但它不在该写权限字段集，
携带它会改为要求 `operator.admin`。

JunQi 因而不再为重命名、置顶、未读、归档或分组 patch 发送
`expectedSessionId`，并统一使用日常写连接。模型与运行参数仍保持管理员连接。由于写权限
协议不允许会话身份比较保护，客户端只能在 Gateway 成功响应后更新投影，不能自行补造 CAS。

## 验证

- `OpenClawSessionLifecycleClient.test.ts`：确认响应与 identity 不一致拒绝。
- `sessionCreate.test.ts`：确认前不提交界面会话、重复创建请求去重、失败不污染状态。
- `OpenClawSessionOrganizationClient.test.ts`：原生字段、分组完整目录写入和兼容错误分类。
- `OpenClawSessionListClient.test.ts`：只发送合法的布尔 `archived` 筛选，并确认旧协议降级不吞掉权限错误。
- `sessionOrganization.test.ts`：identity 隔离、遗留偏好迁移、旧 Gateway 分组生命周期。
- `chatStore.test.ts`：会话 identity 轮换不继承组织状态；打开或替换活动标签会同步清除持久未读标记。
- `SessionSettingsClient.test.ts` 与 `OpenClawSessionOrganizationClient.test.ts`：组织字段不得携带
  `expectedSessionId`，并必须走 `operator.write`；模型等运行参数仍走 `operator.admin`。
- 定向回归集（46 项）、`pnpm exec tsc --noEmit`、`pnpm check:boundaries` 与 `pnpm build` 已通过。
- 全量 `pnpm test` 已启动，但卡在既有的 `src/services/voice/TalkConversationCoordinator.test.ts` 且两小时无进展，已终止该验证链路；在修复该测试的退出行为前不将全量测试记录为通过。
