# JunQi 隐私锁能力移除规格

## 目标

删除 JunQi 客户端独有的隐私锁能力，确保它不再要求 PIN、系统认证或锁定快捷键，也不再阻塞桌面操作。

## 约束

- 不修改 macOS、Windows 或 Linux 的操作系统登录和锁屏能力。
- 不把本地锁状态映射为 OpenClaw Gateway、会话、任务或工具状态。
- 删除过时的代码、测试、配置、文案和文档入口，不保留兼容层或本地 fallback。
- 系统凭据库仍可由现有 Provider 与 Gateway 凭据存储使用，不能因本功能移除而误删。

## 验收条件

1. 主窗口启动与恢复没有 JunQi 本地解锁门禁。
2. Tauri command 注册表和 Rust command 模块没有隐私锁 command 或 guard。
3. 设置页、托盘、快捷键、国际化与通知不再暴露隐私锁语义。
4. 文件预览、截图、OAuth、终端、Quick Chat、录音和通知不再读取 JunQi 锁状态。
5. TypeScript、Rust 静态检查、测试和生产构建通过。
