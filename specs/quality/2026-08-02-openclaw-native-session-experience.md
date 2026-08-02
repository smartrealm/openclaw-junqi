# OpenClaw 原生会话体验对齐规格

## 依据

- 本地 OpenClaw 源码版本 `2026.6.10`，提交 `2031362f51e`。
- `src/gateway/methods/core-descriptors.ts`：会话方法与权限。
- `packages/gateway-protocol/src/schema/sessions.ts`：`sessions.create` 与 `sessions.patch` 参数契约。
- OpenClaw Web UI 会话菜单：置顶、标记未读、重命名、分叉、移动分组、归档、删除。

## 当前行为

此前 JunQi 在标签页、侧栏和 `chatStore` 分别维护会话操作；新建会话曾在 Gateway 确认前创建本地占位记录。置顶、归档和推导标题以可复用的 session key 为键保存，未读没有持久的显式标记，用户分组不存在。

## 目标行为

1. 新建和分叉必须调用 `sessions.create`，仅在返回 `{ ok: true, key, sessionId, entry }` 后向界面提交会话。
2. 重命名必须调用 `sessions.patch`；重置、删除必须调用其对应管理员权限方法。失败不得修改本地生命周期状态。
3. 普通分叉使用 `sessions.create({ parentSessionKey })`；压缩检查点分叉仅在已选择 checkpoint 后调用 `sessions.compaction.branch`，两种语义不得混用。
4. 置顶、显式未读、归档、推导标题和用户分组为桌面组织元数据，按 `session key + sessionId` 绑定；Gateway 当前协议未提供对应字段时，界面不得宣称其已写入 Gateway。
5. 侧栏行和标签页右键必须复用同一会话操作菜单与能力判断。
6. 侧栏顺序为置顶会话、命名分组、未分组时间桶、归档会话；删除分组只能解除归属，不得删除会话。
7. 主会话不可删除或关闭标签，但可使用不破坏生命周期的组织操作、重命名、分叉与重置。

## 验收条件

- 没有 `localOnly`、本地伪造 session key 或未物化会话分支。
- 组织状态不会泄漏到同 key 的新 `sessionId`。
- 遗留的 pin/archive/topic 偏好在首次获得 session identity 时迁移。
- 所有菜单文案覆盖 zh、zh-TW 和 en。
- 协议响应、组织仓库与新建会话均有回归测试。
- TypeScript、边界检查、定向测试和生产构建通过。

## 未验证边界

- OpenClaw 当前安装版本的 Gateway schema 未声明 pin、unread、archive、groupId 写字段；未来上游增加这些字段后，需要通过版本门控迁移到远端持久化。
- 官方 Web UI 截图的精确前端实现不在当前本地源码检出中；本规格以截图所示产品能力及当前安装协议共同约束实现。
