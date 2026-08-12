# 项目交接状态

更新时间：2026-08-12

## 当前目标

用户提供的首次配置 GIF 已证明当前安装包会在 Wizard 最终提交导致 Gateway 重载、进程内会话丢失后重跑完整官方向导。源码已加固为只接受当前官方 `wizard.next` 的结构化完成响应；会话丢失时保留“终态未知”，不自动重放，也不再调用 OpenClaw 未定义的配置检测 RPC。下一阶段是重新构建安装包，并在包含上游会话保留修复的 OpenClaw Runtime 上复验同一路径。

渠道绑定加固已落地：首次配置继续使用完整官方 setup Wizard，渠道中心的新增与重新配置使用隔离的官方 `wizard.start { flow: "channels", channel }`。二维码只在官方终态返回真实账号且目标渠道是唯一 Web Login provider 时出现；旧 Runtime 明确拒绝新 flow 时只提供官方终端交接。下一阶段是在新版 OpenClaw Runtime 和真实钉钉账号上复验完整扫码与重绑流程。

首次设置页面已按完整 JunQi 链路统一，而非只处理官方 Wizard：欢迎、环境检测、数据位置、运行方式、依赖安装、Gateway 启动、OpenClaw 配置和完成页共用固定标题区、内部滚动主体与固定操作区。安装与 Wizard 继续使用各自真实状态机；页面只统一几何边界、状态反馈、键盘焦点和 140 至 180 毫秒的轻量过渡，不增加假步骤、假进度或伪完成。

环境检测的数据闪动已按真实异步链路修复：检测态与结果态复用同一个页面组件、视觉场景和三项能力卡
骨架，OpenClaw、Gateway 与 Docker 全部收敛后一次性发布结果；稳定滚动容器不再通过步骤 key 重建。

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
- Wizard 会话丢失后不再自动启动、恢复或重放官方流程。客户端先通过统一生命周期恢复所选 Gateway；服务重新可达只能证明 Gateway 健康，仍将旧 Wizard 结果标记为“终态未知”。只有用户通过可取消的二次确认理解可能重复写入的风险并显式操作后，才会创建新的官方 Wizard。
- 已删除 OpenClaw 官方协议和最新源码均未定义的 `openclaw.setup.detect`、`openclaw.setup.verify` 客户端及其业务引导调用，未知方法不再被映射成“仍需配置”或“模型已核验”。首次配置默认进入官方 Wizard，只有本次页面生命周期内取得的官方终态可以清除引导门禁。
- 已删除无消费者的 `restartAfterSessionLoss()` 和终态 `done` 内存缓存，避免后续调用方重新引入隐式重放或本地伪完成路径。
- 渠道中心新增与重新配置已统一接入官方 Channels Wizard；setup、channels 以及不同渠道的 sessionId 按 Runtime、Gateway 和渠道隔离，关闭对话框只暂停客户端等待，不伪造取消或完成。
- 已删除按任意选中渠道泛化全局 Web Login 的旧入口。后续内嵌二维码要求 Wizard 返回唯一真实账号，并核验当前安装目录中只有该渠道完整声明 `web.login.start` 与 `web.login.wait`。
- 渠道 capability 现保留全部账号行并支持精确选择；同渠道插件 schema 或 Gateway 方法冲突时失败关闭。就绪投影会优先处理 running、connected、lastError 和 probe 的显式失败，证据不足保持 unknown。
- 官方渠道表单会读取 `config.schema` 的 uiHints；联合 primitive 使用普通输入，敏感字段使用密码输入，SecretRef 仍保留结构化输入。无效或未应用的 JSON 草稿会阻止外层保存。
- 授权交互显示渠道和账号身份，终端字符输出默认折叠，复制与浏览器打开失败内联呈现；外部地址只允许 HTTP 或 HTTPS 协议。
- 全部首次设置页面默认使用稳定窗口自适应主体，`contentIdentity` 只重置内部滚动并触发内容级过渡，不再作为 `main` 的 React key 重建整页；系统减少动态效果时立即完成。
- 存储读取、恢复、应用和就绪状态已统一到共享状态面板。应用期间旧表单退出交互，真实迁移事件驱动进度；已就绪状态提供继续与显式更改位置。
- Git、Node.js 与 Gateway 前置页面使用运行时阶段标题，具体活动或错误只在主体出现一次；运行方式提交期间所有选项和重新检测操作均被同一单飞门禁锁定。
- 官方 Wizard 的标题与 message 去重，短提示、长列表和二维码在同一稳定内容区内切换；任意提交都会先替换旧交互为真实等待面板，`Done` note 仍等待后续 `done: true` 官方终态。
- 错误状态会替换旧 Wizard 控件和二维码；现有 session、runtime、reclaim 与 terminal-unknown 恢复围栏保持不变。
- 共享底部操作、日志开关、欢迎页语言主题按钮和运行方式选项已补充明确的键盘焦点反馈。
- 环境检测阶段只显示固定状态面板和三项能力卡 loading，不再逐项暴露中间数据。首次检测等待
  OpenClaw、Gateway 与 Docker 全部返回后再进入复核；Docker 探测失败仍投影真实不可用结果。
- `detecting` 与 `environment-review` 现在共享同一视觉场景和组件实例；主体滚动通过稳定引用在绘制前
  复位，不再以 React key 重建滚动容器及其异步子树。

## 关键技术决策

- JunQi 不以本地 PTY、外部 CLI、任务状态机或手工工作树模拟 OpenClaw Agent、Task、ACP 或会话语义。
- 普通会话只通过已认证 Gateway 创建；托管 worktree 与 ACP 能力只有在官方协议、权限和结构化响应均核验后才能增加入口。
- Gateway 未提供稳定的逐项消息队列读取契约。本地消息交接只表示尚未提交给 OpenClaw 的消息，不得显示为 Gateway 已接纳或执行成功。
- 工具、任务、审批、快捷决策和计划的终态只取自 OpenClaw 返回；JunQi 本地选择和请求中状态不能补足成功结论。
- 分支整合只处理已提交历史；脏工作树和无权威依据的独有实现不得因分支拉齐而被隐式合并。
- 渠道二维码是当前官方步骤或扫码方法返回值的派生展示，不是授权完成事实。完成状态只取自 OpenClaw 或插件的结构化终态。
- Wizard 授权页不具备独立扫码状态源。JunQi 只负责提交当前官方步骤并显示请求等待态，不跳过插件确认、不并行调用渠道接口，也不根据窗口焦点或时间推断授权结果。
- Gateway 进程和端口健康只表示服务可达；首次配置完成还必须取得属于本次交接的新 `hello-ok` 和已核验 Runtime Identity。
- Wizard `sessionId` 是 Gateway 进程内状态，不是持久完成凭据。会话丢失后，Gateway 可达、配置文件存在和客户端旧步骤都不能证明旧 Runner 已完成、失败或回滚；自动重跑有副作用的官方向导不属于恢复。
- 当前安装的 OpenClaw `2026.7.1-2` 尚未包含上游主线的 `retainGatewayWorkUntilSettled` 防护。JunQi 负责准确保留未知终态和阻止自动重放；最终根治仍要求 Runtime 在 Wizard 请求结束前阻止 Gateway 重载销毁进程内会话。

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
- `src/components/setup/SetupFlowPanels.tsx`
- `src/components/setup/StorageSetupGate.tsx`
- `src/motion/setupStepTransition.tsx`
- `docs/quality/junqi-first-run-presentation-audit-2026-08-12.md`
- `specs/2026-08-12-junqi-first-run-presentation-stability.md`
- `plans/2026-08-12-junqi-first-run-presentation-stability.md`
- `docs/quality/openclaw-wizard-terminal-handoff-audit-2026-08-11.md`
- `specs/2026-08-12-openclaw-wizard-terminal-unknown-hardening.md`
- `plans/2026-08-12-openclaw-wizard-terminal-unknown-hardening.md`

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
- 本次终态未知加固先以失败回归测试复现，修复后 Wizard、终态门禁、页面操作、二次确认和业务引导定向测试 78 项通过；`npm run lint`、使用任务专用 npm 缓存的 `npm run build` 均通过。全量脚本测试仍为 237 项直接通过，唯一受沙箱监听限制的测试在允许本地临时监听后 5 个子项全部通过。
- 已从提交 `585876e6e299` 重新生成 macOS ARM64 安装包。镜像通过 `hdiutil verify`，SHA-256 为 `6f69dff41222ab8c41a050d880e9f5e1bd28050334d7dca4f38db7a467a56837`，大小为 8,316,405 字节；镜像内应用版本为 3.1.0，Bundle ID 为 `com.junqi.junqidesktop`，可执行文件为 ARM64。
- 本次渠道绑定加固定向测试 58 项通过；`npm run lint`、完整 `npm test` 和使用任务专用 npm 缓存的 `npm run build` 通过。应用内浏览器因无法访问主机回环地址，未完成亮色、暗色和窄窗口真实视觉检查；未将该项描述为通过。
- 本次首次设置页面定向回归 34 项通过，覆盖稳定主体、内部滚动、内容过渡、存储加载、运行方式单飞、正文去重、通用提交等待、`Done` 终态等待、错误替换与恢复操作。
- `npm run lint` 通过，模块边界检查覆盖 895 个文件，版本一致性与 TypeScript 检查通过。
- 完整 `npm test` 的前端链路通过；脚本测试 238 项中 237 项在沙箱内直接通过，唯一回环监听测试在受控权限下 5 个子项全部通过。
- 使用任务专用 npm 缓存的 `npm run build` 通过，协作插件、钉钉业务插件、TypeScript 与 Vite 生产构建完成。
- 浏览器辅助验收覆盖 1497×820、720×680、亮色、暗色和键盘焦点。欢迎、环境复核、存储错误态在 GIF 尺寸下的标题、主体和底部操作区坐标一致；窄窗口只滚动主体，主要操作保持可见。
- macOS Tauri 开发版已真实启动并进入环境复核页，Native 可用、Docker 运行中，稳定骨架正常。当前宿主没有 macOS 辅助功能权限，因此未自动点击后续桌面步骤。
- 环境检测闪动修复先由三项失败回归复现，修复后环境状态、场景身份和稳定主体定向测试共 17 项通过；
  `npm run lint` 通过，模块边界检查覆盖 894 个文件，版本一致性与 TypeScript 检查通过。
- 修正旧导航契约测试后，完整 `npm test` 通过：前端 2676 项、脚本 238 项均无失败；`npm run build`
  通过，协作插件、钉钉业务插件、TypeScript 与 Vite 生产构建完成。
- macOS Tauri 开发版已通过当前进程可用的 CoreGraphics 事件从欢迎页进入环境检测，并以约 40 毫秒
  间隔连续抓取 160 帧。检测骨架到复核结果之间未出现空白帧、主体横移或 Docker 晚到后的二次布局变化。
- 桌面回退复验发现常驻欢迎组件保留了前进单飞锁；已将锁复位绑定到欢迎阶段重新进入，并增加
  “下一步、上一步、再下一步”状态转换回归，避免第二次前进无响应。

## 已知问题

- 合并后的大范围删除尚未完成 macOS、Windows 与 Linux 桌面真机验收。
- 托管 worktree 与 ACP 的当前 Gateway 权限和返回结构尚未完成真实运行验证，因此没有新增对应入口。
- OpenClaw 未提供稳定的 Gateway 队列逐项读取协议，JunQi 不能展示、编辑或清空 Gateway 内部队列。
- 本地 DMG 仅使用 ad-hoc 签名，未进行 Apple Developer ID 签名和公证，不是正式发布制品；Windows 与 Linux 本次未构建。
- Windows Scheduled Task 与 Linux systemd user service 的过期恢复快照场景尚未完成目标平台真机验证。
- Wizard 二维码和授权推进生命周期已通过静态渲染回归测试，尚未完成钉钉真实扫码后的整套步骤切换真机复验。
- 当前 macOS 安装包已包含“终态未知”、伪 RPC 删除和渠道绑定加固，但钉钉真实扫码后的授权轮询、终态交接和 Dashboard 进入仍待真机复验。
- 当前安装的 OpenClaw `2026.7.1-2` 未包含上游主线的 Wizard 请求期 Gateway 工作保留修复；其余正式发布版本是否已包含该修复尚未核验。
- 当前安装的 OpenClaw `2026.7.1-2` 会结构化拒绝 `flow: "channels"`，因此本机只能验证旧 Runtime 终端交接，不能验证新版桌面 Channels Wizard 的真实运行。
- 真实钉钉、WhatsApp 及其他 Web Login provider 的扫码、二维码轮换、授权过期和消息收发闭环仍待真机验收。
- 渠道 Wizard、账号表单和二维码对话框的暗色主题、窄窗口、键盘焦点以及 Windows、Linux 外部浏览器与剪贴板权限仍待目标平台视觉和交互验收。
- macOS 桌面开发版的完整后续点击路径仍待辅助功能权限；系统减少动态效果、Windows 与 Linux 首次设置全链路仍待目标平台真机验收。

## 下一步顺序

1. 在包含最新 Channels Wizard 的 OpenClaw Runtime 上验证渠道新增、重新配置、关闭后恢复和终态账号返回。
2. 使用真实钉钉账号完成插件扫码、授权轮询、连接探测和消息收发闭环，并复验 WhatsApp 唯一 Web Login provider 围栏。
3. 为当前 Codex 或 ChatGPT 宿主授予 macOS 辅助功能权限后，自动点击并录制 JunQi Desktop 的存储、安装、Gateway、官方 Wizard 与完成页全链路。
4. 完成系统减少动态效果以及 Windows、Linux 首次设置、外部浏览器和剪贴板权限验证。
5. 经用户确认后决定是否基于当前工作树重新构建 macOS ARM64 安装包；未经明确要求不提交、推送或发布。
