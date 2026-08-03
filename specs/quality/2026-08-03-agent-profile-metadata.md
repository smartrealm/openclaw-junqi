# Agent Profile 本地元数据规格

日期：2026-08-03

## 目标

为 AgentHub 增加与 CodexLoom Identity/Domain/Scope 思路一致的业务画像入口，同时保持
OpenClaw 运行时配置为唯一的 Agent 行为权威。

## 约束

1. `agentId` 必须精确绑定当前 OpenClaw Agent；不复制、改写或猜测上游 Agent 身份。
2. 只保存 `domain` 和 `scope` 两个 JunQi 本地非敏感字段，不把它们写入
   `agents.list[]`、`config.patch` 或分享包。
3. 持久化只能经过 Tauri app settings；不得使用浏览器 localStorage 保存画像。
4. domain 最多 160 个 Unicode 字符，scope 最多 1000 个 Unicode 字符，agentId 最多 128
   个 Unicode 字符；首尾空白会被去除，Agent id 控制字符和字段 NUL 必须拒绝。
5. domain 与 scope 同时为空时删除该 Agent 的本地画像；删除不存在的画像仍返回成功。
6. Gateway 不可用不应阻止读取或保存本地画像；本地 IPC 失败必须显示可重试错误。
7. 删除 Agent 的 OpenClaw 运行时记录成功后，JunQi 尝试清理画像；清理失败必须显式告警，
   不得把失败描述为完成。

## 验收条件

- AgentHub 设置抽屉能加载当前 Agent 画像，编辑业务域和职责范围，并独立保存。
- 保存画像不会产生 `agents.update` 或 `config.patch` 调用。
- 切换 Agent 不会把上一个 Agent 的画像带到当前 Agent。
- 关闭抽屉前能识别未保存的画像改动。
- 旧版 `settings.json` 没有 `agent_profiles` 时仍能正常加载并保存其他设置。
- 前端 IPC command 名、参数外层和 Rust 签名完全一致。
