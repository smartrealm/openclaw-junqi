# 通知单一呈现与身份收敛

日期：2026-08-06

## 依据

- OpenClaw Gateway 的 `chat` 流式终态携带原生 `runId`。
- OpenClaw Gateway 的 `session.message` 广播携带消息、消息 ID、消息序号与会话快照，但不携带 `runId`。
- JunQi 的通知服务在前台呈现应用内 Toast，在后台呈现系统通知；灵动岛是独立的本地状态窗口。

## 当前行为

同一条 Toast 曾同时被根 Toast 容器与灵动岛运行时读取。灵动岛可见时，用户会在两个窗口看到相同标题和正文。

流结束事件使用 `runId`，持久转录事件没有可与其等价的原生运行身份。若让两条路径都发布通知，JunQi 只能自行推断二者关系，产生重复或误合并风险。

## 目标行为

1. 每条通知只有一个呈现面：前台为 Toast，后台为系统通知。灵动岛只投影任务、会话、语音、专注和资源拖放状态，不读取或展示 Toast。
2. 只有 `chat` 流式终态使用原生 `runId` 发布聊天通知；`session.message` 保持为转录、会话和未读投影，不发布通知。
3. 通知仓库只按精确 `dedupeKey` 去重，不按消息正文、消息 ID 或时间窗口推断重复。

## 验证

- 定向 TypeScript 测试：73 项通过，覆盖用户、Gateway 助手与 CLI 助手的运行身份归一、媒体附属消息不归一，以及转换后持久转录仍与流式运行对应。
- 完整前端测试：通过。
- Rust 通知定向测试：15 项通过，覆盖精确身份去重与无身份事件保留；`cargo check --lib` 通过。
- `pnpm lint`、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib`、`git diff --check` 与完整改动文件 Emoji 扫描通过。
- 未执行 macOS、Windows、CentOS、Ubuntu 的前台、最小化、系统权限和多窗口真实呈现验证。
