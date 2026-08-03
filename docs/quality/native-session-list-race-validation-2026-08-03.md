# 原生新建会话列表竞态修复验证

日期：2026-08-03

## 依据

已核对当前安装的 `openclaw@2026.7.1-2`：Gateway protocol 将 `sessions.create` 定义为创建新会话条目、`sessions.list` 定义为当前会话索引；同版本 TUI 在创建响应返回 key 后调用当前会话切换。Gateway 的 `createGatewaySession` 在未指定 key 时生成 dashboard key，并在返回前创建会话条目。

## 根因

JunQi 的 `createNativeSession` 在 Gateway 确认后正确调用 `chatStore.addNativeSession`，该方法也正确激活新标签。但 `App.tsx` 中在创建前开始的 `loadSessions` 请求没有被作废：它晚到时会用旧的完整快照调用 `chatStore.setSessions`。该快照不包含新 key，store 因而调用 `removeSession`，活动标签按既有回退规则选择最后一个历史标签。

这不是创建请求返回了历史会话，也不是新会话 key 被本地伪造，而是跨异步边界的旧快照覆盖了已确认的本地投影。

## 修复

- `sessionLifecycle` 提供仅进程内的确认创建订阅；它不保存会话数据，也不改变 Gateway 协议。
- `sessionCreate` 在完成 Gateway 身份确认和两个本地 store 提交后通知列表所有者。
- checkpoint branch 在提交 Gateway 返回的新身份后使用相同通知。
- `App.tsx` 订阅该通知，立即使 `sessionListRequestGateRef` 失效并调用新的 `loadSessions`。创建前请求在再次检查 gate 时返回 `superseded`，不能进入 `setSessions`；新请求继续采用 Gateway 的完整快照作为唯一权威状态。

## 验证

- `src/utils/sessionCreate.test.ts`：创建确认后才提交，并在提交后发送一次通知，通过。
- `src/utils/sessionLifecycle.regression.test.ts`：确认创建使旧列表 request gate 失效，并固定 App 的失效与刷新接线，通过。
- `pnpm lint`：模块边界、版本一致性与 TypeScript 检查通过。
- `pnpm test`：2,399 项通过、0 项失败。测试输出含既有 Radix 服务端渲染 `useLayoutEffect` 警告，未影响结果。
- `pnpm build`：Provider Catalog 检查、协作插件打包、TypeScript 与 Vite 生产构建通过。
- `git diff --check` 和本次修改文件的 Emoji 扫描：通过。

## 未验证边界

- 尚未对真实 Gateway 注入延迟并在 macOS、Windows、Linux 桌面制品中重复点击验收。
