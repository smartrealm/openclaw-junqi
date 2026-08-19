# Windows 本地语音唤醒契约与验证记录

## 官方依据

- OpenClaw `docs/nodes/voicewake.md` 定义 Gateway 全局唤醒词、路由方法与变更事件，并明确识别运行在客户端本地。
- OpenClaw 平台文档当前列出 macOS、iOS 和 Android 的 Voice Wake 客户端实现，没有提供可供 JunQi 直接调用的 Windows Voice Wake 运行时。
- OpenClaw Windows Hub 当前提供本地 Speech-to-text 节点能力，但其公开功能和源码没有可供 JunQi 直接复用的 Windows Voice Wake 监听运行时。
- Microsoft 桌面 SAPI 提供共享识别器和动态短语 grammar，适用于未打包 Win32 桌面应用。`Windows.Media.SpeechRecognition` 要求 package identity，不能作为 Tauri NSIS 应用的唯一实现。
- 2026-08-19 官方主线提交 `e7d70758656a5552911a8daca78acdfcb06a48f9` 的 `agent` 请求会在携带 `voiceWakeTrigger` 且没有显式会话目标时由 Gateway 自动解析 Voice Wake 路由；Talk 会话创建协议没有该字段。`sessions.resolve` 的 `agentId` 只是过滤条件，不能单独选择会话，因此 JunQi 进入 Talk 前读取同一官方路由与 `agents.list`，按官方 `resolveExplicitAgentSessionKey` 规则从已核验 `mainKey` 派生显式 Agent 主会话键。

参考：

- <https://github.com/openclaw/openclaw/blob/main/docs/nodes/voicewake.md>
- <https://github.com/openclaw/openclaw/blob/main/docs/platforms/mac/voicewake.md>
- <https://github.com/openclaw/openclaw-windows-node/>
- <https://learn.microsoft.com/en-us/windows/apps/develop/input/speech-recognition>
- <https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee413285%28v%3Dvs.85%29>

## 当前行为

实现前，JunQi 只读取与保存 Gateway 唤醒词、只读展示路由并允许用户手动启动 Talk。没有 Windows 麦克风监听线程，也没有把本地检测事件交给现有 Talk 的运行时。

## 目标实现边界

- Windows 适配层使用 SAPI 共享识别器和由 Gateway 唤醒词动态生成的顶层 grammar。
- 音频不上传到 JunQi 或 Gateway；原生事件不携带自由文本识别结果。
- 检测到已配置短语后，桌面运行时先停止监听，再启动现有 OpenClaw Talk。
- 命中后按 Gateway 的规范化规则匹配路由。`agentId` 目标先根据同一连接的官方 `agents.list` 和上游显式 Agent 主会话规则解析，再与当前会话投影核对；目标缺失时失败关闭。
- 本地启用偏好、监听状态和错误是 JunQi 派生状态，不是 Gateway 或 transcript 事实。
- 不引入路由、会话、任务或工具调用的新协议，不在超时或断线时推断成功。
- 应用进程退出后不监听，不包装为 Windows 后台服务。

## 契约差异更正

仓库 2026-08-10 的历史记录曾认为 `voicewake.routing.set` 已从上游移除。最新版 OpenClaw 文档、主线源码和本机 2026.7.1-2 均提供该方法，因此旧结论已失效。本次 Windows 监听不需要修改路由，设置页继续只读展示，但不能再以“上游没有写方法”作为只读依据。

## 验证记录

- 定向 TypeScript 测试覆盖原生能力、命令与事件解码、监听策略、Gateway 路由匹配、Agent 主会话派生和 IPC 参数边界，均通过。
- `pnpm lint` 通过：模块边界扫描 928 个生产文件、四处版本一致、TypeScript 类型检查无错误。
- 完整 `pnpm test` 通过：源码测试 2877 项、脚本测试 238 项，均无失败。
- `cargo fmt -- --check`、`cargo check --lib` 与完整 `cargo test --lib` 通过；Rust 652 项通过、1 项既有测试按设计忽略。
- `pnpm build` 通过，Vite 转换 9307 个模块；`git diff --check` 通过。
- 当前 macOS 开发机没有 Windows Rust 标准库目标，也没有可用的目标管理器，因此未完成 Windows 跨目标编译。Windows x64 原生编译、真实 SAPI、麦克风、语言包与权限仍待目标机验证。
- 设置页复用 `SettingsSwitch` 以及 `aegis-border`、`aegis-surface`、`aegis-text`、`aegis-text-muted`、`aegis-danger` 主题 token；亮色、暗色、窄窗口、键盘焦点和连续状态变化尚未做 Windows 真机视觉验收。
