# 通知单一呈现与身份收敛

日期：2026-08-06

## 依据

- OpenClaw Gateway 的 `session.message` 通过消息持久化元数据暴露 `idempotencyKey`；其服务端源码将该值放入 `message.__openclaw`。
- OpenClaw 官方源码中，Gateway 运行产生的助手记录使用 `<runId>:assistant`，CLI 运行使用 `cli-assistant:<runId>`。
- JunQi 的通知服务在前台呈现应用内 Toast，在后台呈现系统通知；灵动岛是独立的本地状态窗口。

## 当前行为

同一条 Toast 曾同时被根 Toast 容器与灵动岛运行时读取。灵动岛可见时，用户会在两个窗口看到相同标题和正文。

流结束事件使用 `runId`，持久转录事件使用未经归一的助手 `idempotencyKey`。两者是同一运行时会生成不同通知键；旧 Rust 侧再按正文和时间窗口猜测二者相同，既不能覆盖文本转换差异，也可能合并独立消息。

## 目标行为

1. 每条通知只有一个呈现面：前台为 Toast，后台为系统通知。灵动岛只投影任务、会话、语音、专注和资源拖放状态，不读取或展示 Toast。
2. 同一 OpenClaw 助手运行的流式与持久化投影必须使用同一个 `runId`。仅归一官方源码明确的 `<runId>:assistant` 与 `cli-assistant:<runId>` 格式；媒体附属消息等其他键保持原样。
3. 通知仓库只按精确 `dedupeKey` 去重。删除正文、会话、角色和时间窗口推测，以及历史记录迁移。

## 验证

- 定向 TypeScript 测试：73 项通过，覆盖用户、Gateway 助手与 CLI 助手的运行身份归一、媒体附属消息不归一，以及转换后持久转录仍与流式运行对应。
- 完整前端测试：通过。
- Rust 通知定向测试：15 项通过；Rust library 全量测试：713 项通过，2 项既有忽略。
- `pnpm lint`、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib`、`git diff --check` 与完整改动文件 Emoji 扫描通过。
- 未执行 macOS、Windows、CentOS、Ubuntu 的前台、最小化、系统权限和多窗口真实呈现验证。
