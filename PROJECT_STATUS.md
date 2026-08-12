# 项目交接状态

更新时间：2026-08-12

## 当前目标

本地历史安装介质已清理，macOS ARM64 安装验证包已重新构建；下一阶段是安装新包并执行真实桌面验收。

## 已完成内容

- `v3.1.0` 已从提交 `e17676dd5cf2b58207f5f720fdb3412d639a99f3` 发布，远端 CI 与三平台 Release 均成功。
- 已按共同祖先核对本地与远端开发分支；只有本地 `Blues-Code/Jarvis` 存在 main 之外的两个独有提交。
- Jarvis 独有提交删除了没有 OpenClaw 官方协议依据的本地 AgentRun、AI 工作台、任务简报、PTY、手工 worktree 调度和专属持久化链路。
- 会话、工具轨迹、审批、任务账本、计划和破坏性会话变更期间的消息交接继续使用 OpenClaw Gateway 的真实状态与派生投影。
- 向导与聊天交互继续复用现有 Aegis 主题 token、可访问状态和减少动态效果边界。
- 本地 `Blues-Code/Jarvis`、`Blues-Code/code`、`Blues-Code/dingtalk` 和 `daxia` 已快进到 main，不存在分支间代码差异。
- 本机未发现已安装的 JunQi Desktop 应用、运行进程、登录项、LaunchAgent 或安装收据，因此没有删除应用和用户数据。
- 已卸载两个遗留 JunQi DMG 挂载卷，并将 main 与 Jarvis 工作树中的历史安装制品移动到可恢复的废纸篓目录 `/Users/wei/.Trash/JunQi-cleanup-20260812.UUlQ46`。
- 已重新生成唯一保留的本地安装包 `src-tauri/target/release/bundle/dmg/JunQi Desktop_3.1.0_aarch64.dmg`。

## 关键技术决策

- JunQi 不以本地 PTY、外部 CLI、任务状态机或手工工作树模拟 OpenClaw Agent、Task、ACP 或会话语义。
- 普通会话只通过已认证 Gateway 创建；托管 worktree 与 ACP 能力只有在官方协议、权限和结构化响应均核验后才能增加入口。
- Gateway 未提供稳定的逐项消息队列读取契约。本地消息交接只表示尚未提交给 OpenClaw 的消息，不得显示为 Gateway 已接纳或执行成功。
- 工具、任务、审批、快捷决策和计划的终态只取自 OpenClaw 返回；JunQi 本地选择和请求中状态不能补足成功结论。
- 分支整合只处理已提交历史；脏工作树和无权威依据的独有实现不得因分支拉齐而被隐式合并。

## 核心文件

- `specs/openclaw-agent-run-alignment.md`
- `plans/openclaw-agent-run-alignment.md`
- `src/AppRouteTree.tsx`
- `src-tauri/src/lib.rs`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`
- `src/components/Chat/ExecutionPlanCard.tsx`
- `src/components/Chat/ToolCallBubble.tsx`
- `src/components/Chat/message-input/SessionMutationHandoffPanel.tsx`
- `src/services/chat/sendTransaction.ts`
- `src/pages/QuickChatPage.tsx`

## 测试与验证

- Jarvis 分支合并前的工作树状态、共同祖先、独有提交和删除范围已核对。
- `v3.1.0` 发布提交的 `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build` 与远端 CI 已通过。
- 本次合并后的 `pnpm lint` 通过，模块边界检查覆盖 895 个文件，版本一致性与 TypeScript 检查通过。
- 本次合并后的 `pnpm test` 通过，脚本测试 238 项通过；完整前端测试链路无失败。
- 本次合并后的 `pnpm test:rust` 通过，632 项通过、1 项忽略；`cargo fmt -- --check` 与 `cargo check --lib` 通过。
- 本次合并后的 `pnpm build` 通过，协作插件、钉钉业务插件、TypeScript 与 Vite 生产构建完成。
- `pnpm verify:openclaw-docs` 通过，当前官方 OpenClaw 命令文档链接可核验。
- 标准 `pnpm tauri build` 因本机没有 updater 私钥而在制品签名阶段退出，未被描述为成功；随后使用显式关闭 updater 制品的本地构建配置成功生成 DMG。
- 新 DMG 已通过 `hdiutil verify`；SHA-256 为 `b8cfd31a60e1a8bab1234c11e7ea070c17226e3061cde07e1f5f22d98c20a532`，镜像内版本为 3.1.0，Bundle ID 为 `com.junqi.junqidesktop`，可执行文件为 ARM64。

## 已知问题

- 合并后的大范围删除尚未完成 macOS、Windows 与 Linux 桌面真机验收。
- 托管 worktree 与 ACP 的当前 Gateway 权限和返回结构尚未完成真实运行验证，因此没有新增对应入口。
- OpenClaw 未提供稳定的 Gateway 队列逐项读取协议，JunQi 不能展示、编辑或清空 Gateway 内部队列。
- 本地 DMG 仅使用 ad-hoc 签名，未进行 Apple Developer ID 签名和公证，不是正式发布制品；Windows 与 Linux 本次未构建。

## 下一步顺序

1. 安装新生成的 macOS ARM64 DMG，验证首次启动、Gateway 连接和核心桌面交互。
2. 经用户明确授权后推送 main 与已拉齐的开发分支，并核对远端提交身份。
3. 在真实 Gateway 与目标桌面环境验证会话连续发送、停止、审批、任务账本和窗口交互。
