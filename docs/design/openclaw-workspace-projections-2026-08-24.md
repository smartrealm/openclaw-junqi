# OpenClaw 工作台投影收敛

## 依据与边界

本轮只使用 Gateway 已有的 `cron.*`、`tasks.*`、`audit.activity.list` 与 `tools.effective` 协议，以及 JunQi 已有的 Tauri Git command。Gateway 是任务、运行、权限和副作用的唯一权威来源。

CtrlNode 的例行工作、任务图和工作区信任交互仅作为界面组织参考。JunQi 不接入 CtrlNode Bridge、云端控制面、外连 WebSocket、多 Provider 执行层或文本终态推断。

## 当前行为

- Cron 页面从现有 Store 投影任务数量和下一次运行；断线、加载或读取失败时显示未知，不发布零值。
- 活动中心按当前 Session 关联 Task Ledger、`audit.activity.list` 和 `tools.effective`；未知、失败和其他 Session 的错误不会被投影为当前 Session 事实。
- Task Ledger 按官方六种状态原样分栏，不创建本地状态或拖放调度语义。
- Git 页面只接受原生目录选择器返回的规范化路径；Rust 在当前进程内记录多个已确认工作区及 Git 校验出的仓库根目录。

## 目标行为

1. Cron 页面把官方调度器状态、任务状态、下次唤醒和最近运行聚合为例行工作总览；未知或失败保持未知或失败，不推断为正常。
2. 运行控制台只关联 Gateway 提供的任务、审计、会话和工具快照，并可跳转到既有详情；不创建本地 run、终态或工具权限。
3. 任务流仅按 Task Ledger 的状态分栏显示。它不是拖放看板，不定义依赖、优先级、重试或完成语义。
4. Git 页面通过原生目录选择与 Tauri 目录解析取得规范化工作区路径。Rust 只对当前桌面会话内已确认的路径及由 Git 校验得到的仓库根目录执行 Git command；同一会话中再次确认其他目录不会撤销既有确认，已保存路径在新会话中必须重新确认。该本地信任不授予 OpenClaw 工具权限。

## 验证边界

自动化覆盖六种原生任务状态投影、未知数据展示、Session 级工具错误、失败和过期响应，以及多工作区与嵌套仓库的会话信任边界。真实 Gateway 与 Tauri WebView 仍需验证亮暗主题、窄窗口、键盘操作、跨平台路径与 Git 写操作确认。
