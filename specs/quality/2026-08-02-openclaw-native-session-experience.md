# OpenClaw 原生会话体验对齐规格

## 依据

- 本地 OpenClaw 源码检出版本 `2026.6.10`，提交 `2031362f51e`，仅作为旧协议兼容样本。
- 官方当前 `packages/gateway-protocol/src/schema/sessions.ts`：会话方法、`sessions.patch` 组织字段及 `sessions.groups.*` 契约。
- OpenClaw Web UI 会话菜单：置顶、标记未读、重命名、分叉、移动分组、归档、删除。

## 当前行为

此前 JunQi 在标签页、侧栏和 `chatStore` 分别维护会话操作；新建会话曾在 Gateway 确认前创建本地占位记录。置顶、归档和推导标题以可复用的 session key 为键保存，未读没有持久的显式标记，用户分组不存在。

## 目标行为

1. 新建和分叉必须调用 `sessions.create`，仅在返回 `{ ok: true, key, sessionId, entry }` 后向界面提交会话。
2. 重命名、置顶、未读、归档和分组必须只发送 OpenClaw 写权限允许的 `sessions.patch` 字段；不得附带
   `expectedSessionId` 等会提升为 `operator.admin` 的生命周期比较字段。重置、删除仍调用对应管理员权限方法。
   失败不得修改本地生命周期状态。
3. 普通 transcript 分叉使用 `sessions.create({ parentSessionKey, fork: true })`；仅传 `parentSessionKey` 的普通子会话不复制 transcript。压缩检查点分叉仅在已选择 checkpoint 后调用 `sessions.compaction.branch`，两种语义不得混用。
4. 置顶、显式未读、归档和用户分组优先写入 Gateway 原生字段；仅当 Gateway 明确返回未知方法或未知组织字段时，降级为按 `session key + sessionId` 绑定的桌面元数据。推导标题始终是桌面展示元数据。
5. 侧栏行和标签页右键必须复用同一会话操作菜单与能力判断。会话行承担打开会话，菜单按官方 `SessionMenu` 顺序提供置顶/取消置顶、标记已读/未读、重命名、分叉、移动分组、归档/还原和删除；不得混入关闭标签页或重置会话等非组织操作。
   分组必须使用侧向子菜单，现有分组、移出分组和新建分组分别可达；新建分组使用应用内对话框，不使用浏览器 prompt 或菜单内联表单。菜单必须渲染在文档级浮层中，按当前桌面视口避让边界；不得受侧栏、标签栏或滚动容器裁切。
6. 侧栏顺序为置顶会话、命名分组、未分组时间桶、归档会话；删除分组只能解除归属，不得删除会话。
7. 主会话不可删除或关闭标签，但可使用不破坏生命周期的组织操作、重命名、分叉与重置。
8. `sessions.list.archived` 只能省略或传布尔值。需要完整生命周期投影时，必须分别读取活跃和归档列表并按 key 合并；只允许对明确拒绝该字段的旧 Gateway 降级。

## 验收条件

- 没有 `localOnly`、本地伪造 session key 或未物化会话分支。
- 组织状态不会泄漏到同 key 的新 `sessionId`。
- 写权限组织变更只携带 `key` 与对应组织字段；不为保留 CAS 而请求 `operator.admin` 或伪造本地确认。
- 遗留的 pin/archive/topic 偏好在首次获得 session identity 时迁移。
- 所有菜单文案覆盖 zh、zh-TW 和 en。
- 协议响应、组织仓库与新建会话均有回归测试。
- TypeScript、边界检查、定向测试和生产构建通过。
- 在左侧边缘、底部边缘和标签栏末端打开菜单时，图标、文字和所有操作都必须完整可见。

## 未验证边界

- 已存在的旧 Gateway 可能不支持当前原生会话组织协议；兼容判断必须基于实际 RPC 响应，不能以版本门控替代。
- 官方 Web UI 的精确实现不在当前本地源码检出中；本规格以官方协议和产品能力共同约束实现。
