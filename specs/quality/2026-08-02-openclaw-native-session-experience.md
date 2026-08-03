# OpenClaw 原生会话体验对齐规格

## 依据

- 本地 OpenClaw 源码检出版本 `2026.6.10`，提交 `2031362f51e`，仅作为旧协议兼容样本。
- 官方当前 `packages/gateway-protocol/src/schema/sessions.ts`：会话方法、`sessions.patch` 组织字段及 `sessions.groups.*` 契约。
- OpenClaw Web UI 会话菜单：置顶、标记未读、重命名、分叉、移动分组、归档、删除。

## 当前行为

此前 JunQi 在标签页、侧栏和 `chatStore` 分别维护会话操作；新建会话曾在 Gateway 确认前创建本地占位记录。置顶、归档和推导标题以可复用的 session key 为键保存，未读没有持久的显式标记，用户分组不存在。

## 目标行为

1. 新建和分叉必须调用 `sessions.create`，仅在返回 `{ ok: true, key, sessionId, entry }` 后向界面提交会话。
2. 重命名必须调用 `sessions.patch`；重置、删除必须调用其对应管理员权限方法。失败不得修改本地生命周期状态。
3. Transcript 分叉使用 `sessions.create({ parentSessionKey, fork: true })`；只传 `parentSessionKey` 仅建立父关联，不复制 transcript。压缩检查点分叉仅在已选择 checkpoint 后调用 `sessions.compaction.branch`，三种语义不得混用。
4. 置顶、显式未读、归档和用户分组优先写入 Gateway 原生字段；仅当 Gateway 明确返回未知方法或未知组织字段时，降级为按 `session key + sessionId` 绑定的桌面元数据。推导标题始终是桌面展示元数据。
5. 侧栏行和标签页右键必须复用同一会话操作菜单与能力判断。
6. 侧栏顺序为置顶会话、命名分组、未分组时间桶、归档会话；删除分组只能解除归属，不得删除会话。
7. 主会话不可删除或关闭标签，但可使用不破坏生命周期的组织操作、重命名、分叉与重置。
8. `sessions.list.archived` 只能省略或传布尔值。需要完整生命周期投影时，必须分别读取活跃和归档列表并按 key 合并；只允许对明确拒绝该字段的旧 Gateway 降级。

## 验收条件

- 没有 `localOnly`、本地伪造 session key 或未物化会话分支。
- 组织状态不会泄漏到同 key 的新 `sessionId`。
- 遗留的 pin/archive/topic 偏好在首次获得 session identity 时迁移。
- 所有菜单文案覆盖 zh、zh-TW 和 en。
- 协议响应、组织仓库与新建会话均有回归测试。
- TypeScript、边界检查、定向测试和生产构建通过。

## 未验证边界

- 已存在的旧 Gateway 可能不支持当前原生会话组织协议；兼容判断必须基于实际 RPC 响应，不能以版本门控替代。
- 官方 Web UI 的精确实现不在当前本地源码检出中；本规格以官方协议和产品能力共同约束实现。
