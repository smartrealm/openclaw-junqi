# 本地 main 对齐与客户端边界规格

## 问题

本地 `main` 与当前开发分支各自包含有效的质量收敛，但其中的第三方浏览器 Provider 不属于 OpenClaw 原生能力。直接合并会把独立 CLI 和固定平台状态呈现为 JunQi 功能，并可能覆盖当前分支已经验证的会话安全行为。

## 约束

- 只保留有明确客户端边界价值且不扩展 OpenClaw 语义的 `main` 改动。
- OpenClaw 工具可用性只能由 Gateway 的既有协议结果表示，不能由本机第三方 CLI 探测替代。
- 合并不得削弱协议版本校验、连接身份围栏、AbortSignal 请求取消、会话 Checkpoint 或本地队列交付原子性。
- 已证明无引用的页面、Tauri command、测试、本地化和文档必须同步删除。

## 验收条件

- [x] 当前分支包含本地 `main` 的 P0 IPC wrapper、传输类型和分包改进，且没有冲突标记。
- [x] Gateway 握手仍校验协议版本、广告方法和连接身份；取消请求不会在注册失败后继续发送。
- [x] 日历提醒仍经 `addCronAgentTurn` 使用已核对的 OpenClaw cron 契约。
- [x] 不存在 `ego-lite`、`probe_browser_providers` 或 Browser Provider 面板的生产入口、Tauri 注册、测试、本地化或活动文档链接。
- [x] Workbench Browser 标签不伪造浏览器页面或可用状态。
- [x] `AGENTS.md` 包含跨分支引入外部能力的审查要求。
- [x] TypeScript、Rust、边界、构建、OpenClaw 文档和协作插件验证通过。

## 未验证事项

- 各目标平台的打包产物与实际 Gateway 环境需要独立真机验收。
