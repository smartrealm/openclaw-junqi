# OpenClaw 智能体作用域会话侧栏实施计划

日期：2026-08-09

## 执行顺序

### 阶段一：纯领域投影

| 问题 | 文件 | 调整 |
| --- | --- | --- |
| BUG-SS-01 | `src/components/Layout/sidebarUtils.ts` | 增加智能体作用域过滤与选择解析 |
| BUG-SS-02 | `src/components/Layout/sidebarUtils.ts` | 使用已确认主会话 key 构造固定首行 |
| BUG-SS-03 | `src/components/Layout/sidebarUtils.ts` | 删除日期分桶，按 `category` 单一归属分组 |
| BUG-SS-04 | `src/components/Layout/sidebarUtils.ts` | 增加创建时间和最近更新排序 |
| BUG-SS-07 | `src/components/Layout/sidebarUtils.ts` | 只按 Gateway `createdAt` 排序；缺失时间时保留 Gateway 返回顺序，不维护本地伪创建顺序 |
| BUG-SS-10 | `src/utils/sessionCreate.ts` | 新建会话只投影创建回执的 `createdAt`，不以 `updatedAt` 或客户端时钟补值 |
| BUG-SS-11 | `src/utils/sessionPresentation.ts`、`src/components/Chat/ChatTabs.tsx`、`src/utils/activitySessions.ts` | 复用严格创建时间解析；详情和活动投影不再混用更新时间 |

### 阶段二：侧栏交互

| 问题 | 文件 | 调整 |
| --- | --- | --- |
| BUG-SS-01 | `src/components/Layout/NavSidebar.tsx` | 增加智能体选择并绑定新建会话 |
| BUG-SS-02 | `src/components/Layout/NavSidebar.tsx` | 主会话固定第一 |
| BUG-SS-04 | `src/components/Layout/SessionScopeControls.tsx` | 增加分组与排序菜单 |
| BUG-SS-05 | `src/components/Layout/NavSidebar.tsx` | 增加 `/sessions` 入口 |
| BUG-SS-06 | `src/components/Layout/SessionScopeControls.tsx` | 将纯选择器恢复为包含智能体切换、新建和设置的完整菜单 |
| BUG-SS-07、BUG-SS-08 | `src/components/Layout/NavSidebar.tsx` | 统一排序和行尾时间字段；无可核验创建时间时切换到真实可用的最近更新状态 |
| BUG-SS-08 | `src/components/Layout/SessionScopeControls.tsx` | 显示创建时间字段不可用或部分缺失的原因，不暗示本地顺序是官方创建顺序 |
| BUG-SS-12 | `src/hooks/useAgentScopedSession.ts`、`src/pages/ChatPage.tsx` | 路由创建未确认前隔离旧会话视图，失败时保留意图并提供原地重试 |

### 阶段三：清理与文案

- 删除日期分桶类型、工具函数、本地存储和专属测试。
- 删除工作台侧栏中被新会话作用域头部取代的重复入口。
- 更新简体中文、繁体中文和英文文案。

### 阶段四：全局会话作用域收敛

| 问题 | 文件 | 调整 |
| --- | --- | --- |
| BUG-SS-09 | `src/services/gateway/OpenClawSessionListClient.ts` | 以 `agents.list` 确认的智能体列表读取活动与归档会话，保留每个 `global` 行的官方所有者证据 |
| BUG-SS-09 | `src/services/gateway/OpenClawSessionProjection.ts`、`src/utils/openClawSessionProjection.ts` | 定义并验证官方全局会话作用域别名与出站 RPC 目标转换；没有所有者时保持待核验 |
| BUG-SS-09 | `src/services/gateway/index.ts`、会话客户端 | 让历史、发送、Stop、设置、组织、生命周期、检查点、产物和分支请求共用作用域目标，避免裸 `global` 回落 |
| BUG-SS-09 | `src/services/gateway/ChatHandler.ts`、`src/services/gateway/SessionRunFence.ts`、`src/services/chat/sessionCommandCoordinator.ts` | 将流、运行围栏和 mutation 串行键收敛为作用域身份，并从全局事件的 `agentId` 路由 |
| BUG-SS-09 | `src/stores/chatStore.ts`、`src/stores/gatewayDataStore.ts`、`src/utils/sessionLifecycle.ts` | 会话合并、删除、队列、草稿、运行状态和缓存按作用域身份隔离，删除裸 key 合并 |
| BUG-SS-09 | `src/App.tsx`、`src/components/Chat/`、`src/pages/`、`src/hooks/`、`src/services/collaboration/` | 审计并迁移所有会话读写调用方，不保留未作用域的旧入口 |

### 阶段五：验证

- 运行侧栏纯函数和交互契约测试。
- 增加真实 `createdAt` 覆盖最近活动顺序、缺失时间、Gateway 顺序保留、排序显示字段一致性和创建排序
  不可用状态的回归测试。
- 增加新建回执缺少 `createdAt` 时不投影本地替代值的回归测试。
- 增加路由新建会话在确认前不挂载旧会话历史和输入区域的回归测试。
- 增加会话详情与活动历史在 `createdAt` 缺失时保持未知的回归测试。
- 运行 TypeScript、模块边界、完整前端测试和生产构建。
- 执行 `git diff --check` 和 Emoji 扫描。
- 回写根目录 `PROJECT_STATUS.md`。
- 增加多智能体 `global` 会话的列表、投影、发送、历史、Stop、事件路由、删除隔离和队列隔离回归；
  必须证明普通 `agent:<id>:...` 会话仍保持原有路由。
- 增加首次 Gateway 连接回归，证明 `agents.list` 有效快照在按智能体范围的活动和归档 `sessions.list` 前
  完成，且等待范围时不会写入会话加载错误。

## 执行结果

- 阶段一至阶段四的代码范围已经实施；旧的本地创建顺序提升和日期分桶实现已删除。
- 创建时间使用官方 `SessionRowSchema.createdAt`，侧栏展示与排序共用该字段选择；主会话和置顶区
  维持布局固定，普通会话在各自区域内排序。
- 会话列表、发送、停止、历史、订阅、设置、组织、压缩、检查点、产物和事件投影已收敛到同一
  全局会话作用域目标。真实多智能体 Gateway 端到端验收留在审计文档的未验证边界中。
