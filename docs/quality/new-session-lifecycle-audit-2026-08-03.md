# 新建会话生命周期审计

日期：2026-08-03

## 范围与依据

审计覆盖 Chat 标签栏、Dashboard、主导航侧栏、Agent 路由、会话操作菜单，以及它们到
`createNativeSession`、Gateway `sessions.create`、本地会话投影和 `sessions.list` 的完整链路。

依据为仓库锁定且当前安装的 `openclaw@2026.7.1-2`：

- `docs/gateway/protocol.md` 将 `sessions.create` 定义为创建会话条目；
- `dist/schema-BuOFpc7K.js` 将 `fork` 定义为需要 `parentSessionKey` 的 transcript 分叉；
- `dist/session-create-service-14oZxrT5.js` 仅在 `fork === true` 时复制父 transcript，并拒绝缺少父 key 的分叉请求；
- `src/App.tsx` 和 `src/stores/chatStore.ts` 的 revision 栅栏负责阻止创建前开始的完整列表快照删除已确认的新会话。

## 已确认问题

### BUG-NS-01：分叉操作创建了空白子会话

`SessionActionsMenu` 只传递 `parentSessionKey`。按照当前 OpenClaw 服务实现，这只建立父关联，不会复制父 transcript；只有 `fork: true` 才进入官方分叉流程，并执行父会话活动状态与 transcript size policy 的检查。

目标是将 `fork` 作为显式创建意图，协议 client 与协调器共同拒绝无父 key 的无效分叉，并由会话菜单提交 `fork: true`。

### BUG-NS-02：侧栏新建会话忽略当前 Agent

Chat 标签栏和 Dashboard 已按当前会话解析 Agent，主导航侧栏却固定使用 `main`。这会让同一“新建会话”动作因入口不同而切换到另一个 Agent。

目标是复用 `resolveNewSessionAgentId(activeSessionKey, agents)`，所有普通创建入口写入相同的持久会话 label。

### BUG-NS-03：飞行中的创建请求去重过宽

原去重键只包含 Agent 与父 key。不同 label 的普通创建，以及普通子会话与 transcript 分叉，都可能被静默合并为同一次 Gateway 调用。

目标是以规范化的 `agentId`、`label`、`parentSessionKey` 与 `fork` 组成完整创建意图；只有完全相同的重复点击才复用 Promise。

### BUG-NS-04：路由创建失败后丢失可重试意图

`?agent=<id>&new=1` 在 Gateway 返回前就从 URL 中移除。失败只显示短暂 toast，用户无法在原入口重试，也无法刷新恢复该意图。

目标是仅在 Gateway 确认后消费参数；失败时保留 URL，提供显式重试控制，并用每次尝试的门禁阻止 effect 自动无限重试。

### BUG-NS-05：创建后的列表竞态需持续受保护

此前已修复的 snapshot revision 栅栏仍是本次所有入口的共同前提。创建只能在 Gateway 返回 key、sessionId 与 entry 后提交；创建前开始的 complete snapshot 不得删除该已确认会话，创建后开始的完整快照仍可作为删除的权威依据。

## 未验证边界

- 未对真实 Gateway 执行 transcript 分叉，因此父会话运行中和超大 transcript 的服务端拒绝文案尚未真机录制；
- 未在 macOS、Windows、Ubuntu 和 CentOS 桌面制品上进行交互验收；
- 本次不改变 Gateway、运行时选择或会话持久化协议，只修正 JunQi 对已安装协议的传参和本地协调。

## 本次验证

- 定向回归：`OpenClawSessionLifecycleClient`、`sessionCreate`、`newSessionAgent` 与 session lifecycle regression 共 29 项通过；
- `pnpm lint` 通过：模块边界、四处版本一致性和 TypeScript 检查均通过；
- `git diff --check` 与本次修改文件 Emoji 扫描通过；
- `pnpm test` 启动后，Node 多文件测试主进程在没有子测试进程且无 CPU 工作时未退出，已停止，不能声明全量测试通过；
- `pnpm build` 的 TypeScript 子进程完成但外层 pnpm 未退出；单独的 Vite build 只报告到转换阶段后退出，未取得可判定终态，不能声明生产构建通过。
