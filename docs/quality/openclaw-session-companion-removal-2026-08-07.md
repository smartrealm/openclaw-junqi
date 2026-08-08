# 会话旁问入口移除记录

日期：2026-08-07

## 结论

JunQi 已移除会话旁问的桌面入口、`/btw`/`/side` 本地拦截、Gateway RPC 客户端、临时侧栏、Hook、测试和国际化文案。普通聊天发送链路恢复为直接把输入交给 Gateway，不再因为旁问功能改变发送语义。

这不是把 OpenClaw 的官方能力改写成 JunQi 本地能力。OpenClaw 最新官方文档仍定义了 Control UI 的 Companion：它是针对当前会话和工作区的只读旁问线程，结果保存在 Gateway 内存中，不进入主会话历史。官方参考见 [BTW side questions](https://docs.openclaw.ai/tools/btw) 和 [Control UI](https://docs.openclaw.ai/web/control-ui)。

## 触发原因

- 本机实际运行的 OpenClaw 为 `2026.7.1-2 (0790d9f)`。
- 该 Gateway 对 `sessions.companion.state` 返回 `INVALID_REQUEST: unknown method`，因此 `sessions.companion.ask` 和 `sessions.companion.reset` 也没有可用的完整链路。
- 当前客户端即使把错误分类做得更准确，也只能显示“未提供”，不能让用户真正完成旁问；继续保留工具栏按钮会产生一个稳定失败的入口。

## 边界

- 不用 `chat.send`、本地模型、会话历史或本机文件伪造旁问结果。
- 不把当前安装版本当成 OpenClaw 永久版本门禁；未来 Gateway 提供并通过真实 RPC 验证后，可按新的正式契约重新评估是否恢复。
- 当前版本不再展示会话旁问按钮，也不再把 `/btw` 或 `/side` 识别为 JunQi 专属命令；用户需要把问题直接发送到主会话。

## 验证

已删除专属实现和消费者，并全局核对 `SessionCompanionPanel`、`useOpenClawSessionCompanion`、`OpenClawSessionCompanionClient`、`sessionCompanionUi` 及 `chat.sessionCompanion` 的运行时引用。`pnpm exec tsc --noEmit`、定向回归、`pnpm lint`、完整 `pnpm test`（前端 2819 项、脚本 243 项）和 `pnpm build` 均通过；测试仅保留既有 Radix SSR `useLayoutEffect` 警告与 Node 弃用提示。
