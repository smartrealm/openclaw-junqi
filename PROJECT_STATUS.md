# JunQi 项目状态

更新时间：2026-08-24

## 当前目标

`Blues-Code/Jarvis` 已快进合并到 `main`。当前目标是保持 Jarvis 工作台投影与 OpenClaw 正式协议一致，并在真实 Gateway、Tauri WebView 和目标平台完成尚未执行的交互验收。

## 已完成内容

- `main` 已包含 Jarvis 的 Cron 例行工作总览、当前会话运行控制台、只读 Task Ledger 状态流和目录选择式 Git 工作区。
- 依据最新版 OpenClaw 官方主线 `b8d6e799a31` 的 Task Ledger schema，任务流按 `queued`、`running`、`completed`、`failed`、`cancelled`、`timed_out` 六种状态原样分栏，不再合并为客户端自定义状态。
- 运行控制台在任务账本、审计或有效工具快照未返回和读取失败时保留未知语义，不再把未知数据展示为零；有效工具错误绑定产生错误的精确 Session。
- Cron 例行工作总览在断线、加载和读取失败时保留未知语义，只在当前 Cron 列表已确认时发布数量和下一次运行。
- Git 工作区只通过系统目录选择器确认。Rust 在当前进程会话内保存多个规范化工作区，并仅额外信任 Git 校验出的仓库根目录；已保存路径不会跨桌面会话自动取得权限。
- Git 单文件差异、暂存、取消暂存和历史文件读取继续拒绝绝对路径与父目录逃逸。
- `main` 同时保留此前完成的协作 schema 14 到 15 恢复、协作插件 `0.5.4`、Gateway 生命周期串行化、管理员 scope 升级、设备凭据轮换、钉钉业务审计和宠物窗口修复。

## 关键技术决策

- OpenClaw 是任务、审计、工具、会话、Cron 和运行终态的唯一权威；JunQi 仅展示可追溯投影，不增加本地任务状态或成功推断。
- OpenClaw 能力核对以更新后的官方仓库主线为准；当前项目依赖和自动化环境仅用于复现与验证，不作为目标环境事实或版本门禁。
- Gateway 写操作、权限升级和重启绑定已核验连接与运行时身份；超时、断线或失败不推断远端副作用终态。
- Git 信任仅存在于当前桌面进程。嵌套目录的仓库根目录必须由该已确认目录内执行的 Git 命令返回，并通过包含关系校验。
- 普通 Gateway 连接保持最小权限，管理员权限只通过 OpenClaw 官方设备 scope 升级流程取得。

## 核心文件

- `src/components/Activity/OpenClawRunConsole.tsx`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`
- `src/pages/CronMonitor.tsx`
- `src/pages/cronPresentation.tsx`
- `src/pages/GitPage.tsx`
- `src/stores/gatewayDataStore.ts`
- `src-tauri/src/commands/git_neu.rs`
- `docs/design/openclaw-workspace-projections-2026-08-24.md`
- `specs/2026-08-24-openclaw-workspace-projections.md`

## 测试与验证

- 任务流、运行控制台和 Cron 未知状态定向回归通过，共 5 项。
- Git 工作区定向 Rust 测试 8 项通过，覆盖未确认目录、多工作区保留、嵌套仓库根目录和相对路径逃逸。
- 使用项目锁定的 `pnpm@9.15.9` 完成验证：前端测试 2931 项、脚本测试 238 项、协作插件测试 365 项全部通过。
- Rust 格式检查、`cargo check --lib` 和库测试通过；Rust 测试 658 项通过，1 项按既有条件忽略。
- `pnpm lint`、`pnpm build`、`pnpm collab:validate`、`pnpm verify:openclaw-docs` 和 `git diff --check` 通过。
- 生产构建重新生成并核对协作插件 `0.5.4`、schema 15 和固定归档 SHA-256 `458a2ca1c457db32e90e7cfcb4326bc26595dd33445b03bbb53e9772375f132c`，生成文件无新增差异。
- 本轮只完成自动化和构建验证，没有把当前机器的 Node.js、npm、Git、Gateway、配置、凭据或操作系统状态当作目标环境证据。

## 已知问题与未验证边界

- 尚未在真实 Gateway 完成运行控制台、Task Ledger、Cron、scope 申请、用户批准、凭据轮换、重连和原操作继续的完整序列。
- 尚未在真实 Tauri WebView 连续验证亮色、暗色、窄窗口、键盘焦点、加载、空数据和失败状态；当前没有真机截图或录屏证据。
- 尚未在 macOS、Windows 和 Linux 目标环境验证目录选择、嵌套仓库操作、系统凭据、Gateway 重启、钉钉协议和宠物窗口行为。
- 完整测试仍输出既有的 Node.js `module.register()` 弃用提示和 Radix Select 服务端渲染提示；Rust 检查仍报告既有未使用函数 `current_search_path`。这些提示未导致本轮验证失败，也未在本任务中扩散。
- 合并前生成的 DMG 不包含本轮 Jarvis 代码，当前尚未重新打包；既有包也未使用 Developer ID 签名或公证。
- 未跟踪的 `.pnpm-store/` 与 `outputs/` 是用户既有内容，本轮未修改、删除或纳入提交。

## 失败方案

- 未保留 Jarvis 将三个原生任务终态合并为 `attention` 的实现，因为它改变了 OpenClaw Task Ledger 的状态语义。
- 未保留单个全局 Git 工作区信任槽位，因为确认第二个目录会错误撤销第一个目录，并阻断嵌套工作区派生的仓库根目录操作。
- 未把未加载任务、审计、工具和 Cron 数据显示为零，因为零代表已确认空集合，而不是未知状态。
- 不通过手工路径输入、持久化前端标记、目录前缀匹配或目标机器环境猜测扩大 Git 权限。

## 下一步顺序

1. 在真实 Gateway 与 Tauri WebView 验证活动中心和 Cron 从加载到结果的连续状态、Session 切换和失败恢复。
2. 在目标平台验证 Git 目录选择、多工作区、嵌套仓库及写操作确认，并记录平台差异。
3. 如需安装包，基于当前 `main` 重新执行 Tauri 平台打包，并明确区分未签名测试包与正式签名、公证制品。
