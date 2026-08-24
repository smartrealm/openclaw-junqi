# OpenClaw 工作台投影规格

## 验收条件

1. 例行工作总览只消费当前 Cron 列表、`cron.status` 与 `cron.runs` 已确认数据；加载、未支持和错误状态互斥。
2. 运行控制台对每条记录保留 Gateway 提供的 session、run、任务或审计引用；缺失引用不由本地补造。
3. 能力清单只显示当前会话 `tools.effective` 返回的分组、来源、拒绝状态和通知；读取失败不得显示为零工具。
4. 任务流按 `queued`、`running`、`completed`、`failed`、`cancelled`、`timed_out` 原样投影，不提供拖放或本地调度操作。
5. Git 工作区和变更操作只能沿用已核验的 Tauri command。每次 Git command 必须重新规范化路径并拒绝未在当前桌面会话确认的工作区；嵌套目录只允许同时信任由 Git 校验得到的仓库根目录；保存的路径不得跨会话自动获得 Git 权限。
6. 所有新增界面覆盖加载、空数据、失败、禁用和键盘焦点状态，并使用现有 Aegis 主题 token。
