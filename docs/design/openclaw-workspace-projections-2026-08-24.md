# OpenClaw 工作台投影收敛

## 依据与边界

本轮只使用 Gateway 已有的 `cron.*`、`tasks.*`、`audit.activity.list` 与 `tools.effective` 协议，以及 JunQi 已有的 Tauri Git command。Gateway 是任务、运行、权限和副作用的唯一权威来源。

CtrlNode 的例行工作、任务图和工作区信任交互仅作为界面组织参考。JunQi 不接入 CtrlNode Bridge、云端控制面、外连 WebSocket、多 Provider 执行层或文本终态推断。

## 当前行为

- Cron 页面已读取官方任务、调度器状态和运行记录，并在手动运行后等待官方运行记录终态。
- 活动中心已分别呈现官方任务账本、审批和审计记录，但这些信息未形成统一的只读运行视图。
- 当前会话的 `tools.effective` 已由 Gateway 返回，不能由 JunQi 静态工具目录替代。
- Git 页面已有本地 Tauri Git command，但工作区选择与写操作边界尚需单独收敛。

## 目标行为

1. Cron 页面把官方调度器状态、任务状态、下次唤醒和最近运行聚合为例行工作总览；未知或失败保持未知或失败，不推断为正常。
2. 运行控制台只关联 Gateway 提供的任务、审计、会话和工具快照，并可跳转到既有详情；不创建本地 run、终态或工具权限。
3. 任务流仅按 Task Ledger 的状态分栏显示。它不是拖放看板，不定义依赖、优先级、重试或完成语义。
4. Git 页面通过原生目录选择与 Tauri 目录解析取得规范化工作区路径。Rust 只对当前桌面会话内已确认的精确路径执行 Git command；已保存路径在新会话中必须重新确认。该本地信任不授予 OpenClaw 工具权限。

## 验证边界

自动化覆盖状态投影、失败和过期响应。真实 Gateway 与 Tauri WebView 仍需验证亮暗主题、窄窗口、键盘操作、跨平台路径与 Git 写操作确认。
