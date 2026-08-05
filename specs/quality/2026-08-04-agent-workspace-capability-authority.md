# Agent Workspace 能力权威性收敛规格

日期：2026-08-04

## 范围

清理 Agent Workspace 中未实现且无 OpenClaw 或本地 Adapter 契约的产品入口，并安全迁移历史持久化状态。

## 验收条件

- 右侧栏状态类型和 UI 仅包含 `files`、`search`、`source`。
- Workbench 标签类型和 UI 仅包含 `terminal`、`editor`、`diff`。
- schema 版本升级；旧快照中的无支持标签被移除，group tab 列表、active tab 和右侧面板均保持引用完整。
- 不合法或无法完整迁移的快照继续 fail closed，不能通过默认值掩盖结构损坏。
- 页面和 schema 回归测试覆盖能力收敛及旧快照迁移。
- 不新增 OpenClaw RPC、配置字段或本地伪造数据。

## 非目标

- 不实现 Gateway `agents.workspace.list/get`。
- 不实现嵌入式浏览器、Hosted Review、端口发现或 AI Vault。
- 不改变现有本机文件、Git 或 PTY 的权限和运行时边界。
