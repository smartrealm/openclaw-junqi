# 项目交接状态

更新时间：2026-08-12

## 当前目标

用户提供的首次配置 GIF 已证明当前安装包在 Wizard 终态会话丢失后会重跑完整官方向导。源码已改为先核验当前 Gateway 与结构化配置结果，下一阶段是完成全量自动化并重新构建安装包复验同一路径。

## 已完成内容

- `v3.1.0` 已从提交 `e17676dd5cf2b58207f5f720fdb3412d639a99f3` 发布，远端 CI 与三平台 Release 均成功。
- 已按共同祖先核对本地与远端开发分支；只有本地 `Blues-Code/Jarvis` 存在 main 之外的两个独有提交。
- Jarvis 独有提交删除了没有 OpenClaw 官方协议依据的本地 AgentRun、AI 工作台、任务简报、PTY、手工 worktree 调度和专属持久化链路。
- 会话、工具轨迹、审批、任务账本、计划和破坏性会话变更期间的消息交接继续使用 OpenClaw Gateway 的真实状态与派生投影。
- 向导与聊天交互继续复用现有 Aegis 主题 token、可访问状态和减少动态效果边界。
- 本地 `Blues-Code/Jarvis`、`Blues-Code/code`、`Blues-Code/dingtalk` 和 `daxia` 已快进到 main，不存在分支间代码差异。
- 本机未发现已安装的 JunQi Desktop 应用、运行进程、登录项、LaunchAgent 或安装收据，因此没有删除应用和用户数据。
- 已卸载两个遗留 JunQi DMG 挂载卷，并将 main 与 Jarvis 工作树中的历史安装制品移动到可恢复的废纸篓目录 `/Users/wei/.Trash/JunQi-cleanup-20260812.UUlQ46`。
- 已从 main 提交 `ba5b8f3e` 重新生成本地安装包 `src-tauri/target/release/bundle/dmg/JunQi Desktop_3.1.0_aarch64.dmg`。
- 运行时恢复入口会从事务指定的 npm 前缀解析原 OpenClaw 运行时，重新核验官方服务归属和运行事实，并在停止服务前写回持久化事务；不再依赖事务创建时的过期布尔快照。
- 本机替换应用后，遗留的 `candidate_active` 事务已清除，旧布局已恢复；`ai.openclaw.gateway` 由官方 LaunchAgent 恢复运行，Gateway 配置与认证 RPC 均核验成功。
- Wizard 授权二维码只绑定当前官方步骤。结构化 `externalUrl` 直接呈现；旧插件 note 仅在返回唯一、带非空 `user_code` 的 HTTPS 一次性授权地址时投影二维码。提交等待、步骤切换、终态、取消和失败后不再显示上一二维码，普通说明链接也不会被误判为授权入口。
- Wizard 终态交接现在先核验系统服务交接结果，再等待已有 Gateway 生命周期收敛并发起独立重连；安装阶段的连接管理器会按需激活。终态后的“重新核验”不再重复系统服务交接、Gateway 重启或官方 Wizard。
- 已核对钉钉连接器 0.8.24 与主线源码：插件只在用户提交当前官方授权提示后继续确认，并在后续官方提示提交后启动授权结果轮询。JunQi 现在明确提示扫码或浏览器授权后继续，主要操作使用“我已完成授权，继续”；提交期间销毁二维码并等待插件返回，不从扫码表象推断成功。
- 已基于当前工作树重新生成 macOS ARM64 安装包 `src-tauri/target/release/bundle/dmg/JunQi Desktop_3.1.0_aarch64.dmg`，其中包含本次授权推进修复。
- 已逐帧核对 `/Users/wei/Desktop/流程.gif`：钉钉授权和官方步骤可完成，但提交 `Done` 后认证连接超时；用户重试会重新进入 `QuickStart` 及完整配置流程。根因是 Gateway 连接源变化后旧 Wizard `sessionId` 被回收，客户端把 `WIZARD_NOT_FOUND` 自动转换为新的 `wizard.start`。
- Wizard 会话丢失后不再自动启动、恢复或重放官方流程。客户端先通过统一生命周期恢复所选 Gateway，再复用结构化配置门禁核验结果；配置已完成时继续终态交接，Gateway 不可核验时只允许重新核验，检测仍要求配置时只提供用户显式确认的“重新开始官方向导”。
- 已删除无消费者的 `restartAfterSessionLoss()` 和终态 `done` 内存缓存，避免后续调用方重新引入隐式重放或本地伪完成路径。

## 关键技术决策

- JunQi 不以本地 PTY、外部 CLI、任务状态机或手工工作树模拟 OpenClaw Agent、Task、ACP 或会话语义。
- 普通会话只通过已认证 Gateway 创建；托管 worktree 与 ACP 能力只有在官方协议、权限和结构化响应均核验后才能增加入口。
- Gateway 未提供稳定的逐项消息队列读取契约。本地消息交接只表示尚未提交给 OpenClaw 的消息，不得显示为 Gateway 已接纳或执行成功。
- 工具、任务、审批、快捷决策和计划的终态只取自 OpenClaw 返回；JunQi 本地选择和请求中状态不能补足成功结论。
- 分支整合只处理已提交历史；脏工作树和无权威依据的独有实现不得因分支拉齐而被隐式合并。
- 渠道二维码是当前官方步骤或扫码方法返回值的派生展示，不是授权完成事实。完成状态只取自 OpenClaw 或插件的结构化终态。
- Wizard 授权页不具备独立扫码状态源。JunQi 只负责提交当前官方步骤并显示请求等待态，不跳过插件确认、不并行调用渠道接口，也不根据窗口焦点或时间推断授权结果。
- Gateway 进程和端口健康只表示服务可达；首次配置完成还必须取得属于本次交接的新 `hello-ok` 和已核验 Runtime Identity。
- Wizard `sessionId` 是 Gateway 进程内状态，不是持久完成凭据。会话丢失后的完成判断只能重新经过当前 Runtime 的 Gateway 与结构化配置门禁；自动重跑有副作用的官方向导不属于恢复。

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
- `src/hooks/useSetupFlow/useWizardSession.ts`
- `src/services/setup/setupCompletionGate.ts`
- `src/pages/SetupPage/WizardScreen.tsx`
- `docs/quality/openclaw-wizard-terminal-handoff-audit-2026-08-11.md`

## 测试与验证

- Jarvis 分支合并前的工作树状态、共同祖先、独有提交和删除范围已核对。
- `v3.1.0` 发布提交的 `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build` 与远端 CI 已通过。
- 本次合并后的 `pnpm lint` 通过，模块边界检查覆盖 895 个文件，版本一致性与 TypeScript 检查通过。
- 本次合并后的 `pnpm test` 通过，脚本测试 238 项通过；完整前端测试链路无失败。
- 本次合并后的 `pnpm test:rust` 通过，632 项通过、1 项忽略；`cargo fmt -- --check` 与 `cargo check --lib` 通过。
- 本次合并后的 `pnpm build` 通过，协作插件、钉钉业务插件、TypeScript 与 Vite 生产构建完成。
- `pnpm verify:openclaw-docs` 通过，当前官方 OpenClaw 命令文档链接可核验。
- 标准 `pnpm tauri build` 因本机没有 updater 私钥而在制品签名阶段退出，未被描述为成功；随后使用显式关闭 updater 制品的本地构建配置成功生成 DMG。
- 新 DMG 已通过 `hdiutil verify`；SHA-256 为 `bafaf7a36d96e9710043d55971689ab8974213cd160b59c03d031ff40c35e777`，大小为 8,311,751 字节，镜像内版本为 3.1.0，Bundle ID 为 `com.junqi.junqidesktop`，可执行文件为 ARM64。
- 运行时恢复 Rust 库测试共 634 项通过、1 项忽略；`cargo fmt -- --check` 与 `cargo check --lib` 通过。
- Wizard 与二维码定向测试 13 项通过，OpenClaw Wizard 服务定向测试 22 项通过；`pnpm lint` 通过。
- Wizard 终态、Gateway 连接管理器、统一生命周期和配置页面定向测试 95 项通过。
- 完整前端与脚本测试 238 项通过，当前生产构建通过；协作插件和钉钉业务插件制品契约均通过。
- 本次授权推进修复先以失败回归测试复现；修复后配置页面定向测试 13 项、完整 `pnpm test`、`pnpm lint`、`pnpm build` 和 `git diff --check` 均通过。
- 新安装包通过 `hdiutil verify`，SHA-256 为 `f4eaa0ac3482b9c0eece6569c2f194fdae6eb7dc11aac5e571ad12e2feec20fd`，大小为 8,311,874 字节；镜像内应用版本为 3.1.0，Bundle ID 为 `com.junqi.junqidesktop`，可执行文件为 ARM64。
- 会话丢失修复先以失败回归复现；修复后终态交接、会话核验、页面操作、取消围栏和 Wizard 服务定向测试 107 项通过。
- 本轮 `npm run lint` 通过，模块边界检查覆盖 895 个文件，版本一致性和 TypeScript 检查通过。项目锁定的 pnpm 启动器因 npm registry 签名校验失败而拒绝运行，因此本轮改用等价 npm 脚本和直接 Node 测试入口。
- 全量 `npm test` 中 238 项脚本测试有 237 项直接通过，唯一失败是沙箱禁止在 `127.0.0.1` 监听；该测试在允许本地临时监听后 5 个子项全部通过。使用任务专用 npm 缓存后，协作插件、钉钉业务插件、TypeScript 与 Vite 生产构建通过。

## 已知问题

- 合并后的大范围删除尚未完成 macOS、Windows 与 Linux 桌面真机验收。
- 托管 worktree 与 ACP 的当前 Gateway 权限和返回结构尚未完成真实运行验证，因此没有新增对应入口。
- OpenClaw 未提供稳定的 Gateway 队列逐项读取协议，JunQi 不能展示、编辑或清空 Gateway 内部队列。
- 本地 DMG 仅使用 ad-hoc 签名，未进行 Apple Developer ID 签名和公证，不是正式发布制品；Windows 与 Linux 本次未构建。
- Windows Scheduled Task 与 Linux systemd user service 的过期恢复快照场景尚未完成目标平台真机验证。
- Wizard 二维码和授权推进生命周期已通过静态渲染回归测试，尚未完成钉钉真实扫码后的整套步骤切换真机复验。
- 当前 macOS 安装包已经通过 GIF 复验确认仍包含 Wizard 会话丢失后重跑完整流程的问题；源码修复尚未重新打包和真机复验，不能把现有 DMG 视为已修复制品。

## 下一步顺序

1. 重新生成 macOS ARM64 本地安装包，按 GIF 同一路径完成钉钉授权、`Done` 终态、会话丢失恢复和 Dashboard 进入验收。
2. 在 Windows 与 Linux 真机验证运行时恢复服务的所有权核验和恢复结果。
3. 经用户明确授权后提交、推送或发布当前变更。
