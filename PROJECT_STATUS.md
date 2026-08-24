# JunQi 项目状态

更新时间：2026-08-24

## 当前目标

已将本地 `main` 的运行时、协作、权限恢复与宠物窗口修复合并到 `Blues-Code/Jarvis`；当前目标是保持基于 OpenClaw 正式协议的桌面客户端边界，并在真实 Gateway 与目标平台完成未验证交互的验收。

## 已完成内容

- 本分支已完成 Cron 例行工作总览、按当前会话关联的运行控制台、只读 Task Ledger 状态流和目录选择式 Git 工作区；它们只投影现有 OpenClaw Cron、任务、审计和有效工具契约，不增加本地调度或伪任务状态。
- Git 工作区改为系统目录选择并在 Rust 侧按当前桌面会话保存规范化可信路径；所有 Git command 均重新核验路径。单文件差异、暂存与取消暂存均拒绝绝对路径和父目录逃逸，且已覆盖已确认仓库子目录的回归场景。
- `main` 已带入协作数据库 schema 14 到 15 的结构化恢复保护、协作插件 `0.5.4`、Gateway 生命周期串行化、管理员 scope 升级、设备凭据轮换和精确运行时身份核验。
- `main` 已带入钉钉业务审计互斥状态、外部链接统一由 Tauri Opener 处理、运行时模型目录可访问性修复，以及宠物窄窗口单行标题和窗口激活修复。
- 协作插件固定归档、前端 metadata、Tauri capability schema 与锁文件已随 `main` 同步更新。

## 关键技术决策

- OpenClaw 是聊天、任务、审计、工具、会话和运行时语义的唯一权威；JunQi 仅展示可追溯的派生投影。
- Gateway 写操作、权限升级和重启都绑定已核验的连接与运行时身份；超时、断线或失败不推断远端副作用终态。
- Git 目录信任只在当前桌面会话内有效，已保存路径必须重新经系统目录选择确认。
- 权限升级使用 OpenClaw 官方设备 scope 协议；普通连接保持最小权限，管理员权限不默认进入日常连接。

## 核心文件

- `src/pages/CronMonitor.tsx`
- `src/components/Activity/OpenClawRunConsole.tsx`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`
- `src/pages/GitPage.tsx`
- `src-tauri/src/commands/git_neu.rs`
- `src/services/gateway/GatewayLifecycleCoordinator.ts`
- `src/services/gateway/GatewayScopeUpgrade.ts`
- `packages/junqi-collab/src/database-schema-initializer.ts`

## 测试与验证

- 本分支合并前已通过 `pnpm lint`、TypeScript 静态检查、`cargo check --lib`、Git 门禁定向 Rust 测试和 `git diff --check`。
- Git 门禁定向测试 7 项通过，包括嵌套仓库目录、相对路径逃逸和会话确认校验。
- `main` 的 schema 数据库、Gateway scope、生命周期、业务审计与宠物窗口测试已随其提交合入；本次合并后仍需执行完整回归和构建。

## 已知问题与未验证边界

- 尚未在用户真实 Gateway 上完成 scope 申请、用户批准、凭据轮换、重连和原会话设置继续的完整序列。
- 尚未在真实 Tauri WebView 验证 Cron、运行控制台、任务流和 Git 目录选择在亮暗主题、窄窗口、键盘焦点及失败路径中的完整序列。
- 尚未在 Windows 和 Linux 真机验证目录选择、Gateway 重启、凭据库、钉钉协议和宠物窗口行为。
- 本地 DMG 未使用 Developer ID 签名且未公证，不能作为正式发布制品。
- `gui/` 为用户要求保留的 Codex 参考源码目录，未接入构建、未跟踪且不纳入提交。

## 失败方案

- 不将本地计时、缓存或 UI 行为伪装为 OpenClaw Cron、Task、Audit 或 Tool 的官方终态。
- 不因 Gateway 握手能力列表缺失而直接推断方法不可用，也不为未知协议提供本地成功 fallback。
- 不通过手工输入路径、持久化前端状态或目录前缀匹配扩大 Git 工作区权限。

## 下一步顺序

1. 执行合并后的完整静态检查、插件测试、Rust 测试和生产构建。
2. 在真实 Gateway 与 Tauri WebView 验证权限恢复、协作 schema 恢复、Cron、运行控制台、任务流和 Git 工作区的连续状态。
3. 在 macOS、Windows、Linux 目标环境验证运行时安装、目录选择、系统凭据、外链协议与宠物窗口交互。
