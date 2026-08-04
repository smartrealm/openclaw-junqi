# 原生新建会话列表竞态修复验证

日期：2026-08-03

## 依据

已核对当前安装的 `openclaw@2026.7.1-2`：Gateway protocol 将 `sessions.create` 定义为创建新会话条目、`sessions.list` 定义为当前会话索引；同版本 TUI 在创建响应返回 key 后调用当前会话切换。Gateway 的 `createGatewaySession` 在未指定 key 时生成 dashboard key，并在返回前创建会话条目。

## 根因

JunQi 的 `createNativeSession` 在 Gateway 确认后正确调用 `chatStore.addNativeSession`，该方法也正确激活新标签。但完整的会话列表快照没有携带其请求开始时的 store 状态。创建前开始的 `loadSessions` 即使晚到，也会用旧快照调用 `chatStore.setSessions`；该快照不包含新 key，store 因而调用 `removeSession`，活动标签按既有回退规则选择最后一个历史标签。

这不是创建请求返回了历史会话，也不是新会话 key 被本地伪造，而是跨异步边界的旧快照覆盖了已确认的本地投影。仅靠 `App` 的 request gate 处理该情形不完整，因为会话的成员、identity、标签和选中状态由 `chatStore` 所有。

## 修复

- `chatStore` 新增 `sessionProjectionRevision`，在本地会话创建、选中、关闭、删除和 identity 轮换时推进版本。
- `App.tsx` 在开始 `sessions.list` 前捕获该版本，并将其随完整快照传回 `chatStore`。
- `chatStore` 仅在请求版本仍等于当前版本时删除完整快照中缺失的会话；版本不一致的旧快照仍合并已返回的 Gateway 元数据，但不会删除当前会话或触发标签回退。
- `sessionLifecycle` 仍提供仅进程内的确认创建订阅，用于立即废弃 `App` 的旧请求并开始下一次权威读取；它不承担删除正确性，也不保存会话数据。
- `sessionCreate` 和 checkpoint branch 在完成 Gateway 身份确认及本地提交后使用同一通知。

## 验证

- `src/utils/sessionCreate.test.ts`：创建确认后才提交，并在提交后发送一次通知，通过。
- `src/stores/chatStore.test.ts`：旧完整快照保留已确认的新活动会话，不能将已轮换的 identity 回退；创建后的完整快照仍可删除已缺失会话，通过。
- `src/utils/sessionLifecycle.regression.test.ts`：确认创建使旧列表 request gate 失效，并固定 App 的失效、刷新和版本传递接线，通过。
- `pnpm lint`：模块边界、版本一致性与 TypeScript 检查通过。
- `pnpm test`：完整测试通过。测试输出含既有 Radix 服务端渲染 `useLayoutEffect` 警告，未影响结果。
- `pnpm build`：Provider Catalog 检查、协作插件打包、TypeScript 与 Vite 生产构建通过。
- `git diff --check` 和本次修改文件的 Emoji 扫描：通过。

## 未验证边界

- 尚未对真实 Gateway 注入延迟并在 macOS、Windows、Linux 桌面制品中重复点击验收。
