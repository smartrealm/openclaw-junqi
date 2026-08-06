# JunQi 隐私锁能力移除记录

## 依据

- JunQi 是 OpenClaw Gateway 的桌面客户端。OpenClaw 官方协议、Gateway 方法与会话语义不包含 JunQi 本地 PIN、系统认证解锁、全局锁定快捷键或应用恢复锁定。
- 用户明确要求移除 JunQi 的系统锁。该能力是客户端附加门禁，不是 macOS、Windows 或 Linux 的操作系统登录锁。

## 当前行为

1. 启动、系统恢复和所有 Tauri command 不再经过 JunQi 隐私锁门禁。
2. 设置页、托盘菜单、全局锁定快捷键、PIN 与系统认证界面、隐私锁 IPC command 和持久化字段均已删除。
3. 文件预览、截图、OAuth、终端、Quick Chat、录音和通知不再因 JunQi 本地锁状态中断或隐去内容。
4. 系统登录、屏幕锁定与操作系统凭据库仍由各平台自行管理；本变更不修改系统安全策略。

## 验证

- 全局引用审查确认没有剩余隐私锁模块、设置项、Tauri command、事件或国际化键。
- 后续自动化验证覆盖 TypeScript、Rust、构建与打包链路。
- 尚未在 macOS、Windows 和 Linux 真机分别检查删除后首次启动；该项不能由编译结果替代。
