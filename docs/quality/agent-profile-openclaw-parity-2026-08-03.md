# Agent Profile 与 OpenClaw 边界对齐

日期：2026-08-03

## 依据

- 本机锁定的 OpenClaw `2026.7.1-2 (0790d9f)` 官方 Gateway 协议：
  `agents.list` 返回配置 Agent 及有效模型/运行时元数据；`agents.create/update/delete`
  管理 Agent 记录和工作区；`agent.identity.get` 返回运行时身份。
- OpenClaw `agents.list[]` 的官方配置字段覆盖 id、模型、工作区、技能、运行时策略和
  `identity` 等运行字段，没有 JunQi 业务 Domain/Scope 的独立契约。
- CodexLoom 对照记录要求区分稳定 Agent 身份与业务 Domain/Scope，不能把产品层元数据
  猜测写进上游运行时配置。

## 当前行为

- AgentHub 继续通过 OpenClaw RPC 管理 Agent id、显示名称、模型、回退链、工作区、技能和
  渠道绑定。
- JunQi 在本地应用 `settings.json` 增加 `agent_profiles`，按精确 OpenClaw `agentId`
  保存 `domain` 和 `scope` 两个非敏感字段。
- 本地画像使用独立的 `load_agent_profiles`、`save_agent_profile`、
  `delete_agent_profile` Tauri command；保存不会调用 `config.patch`，也不会进入 Agent
  分享包。
- 画像字段有明确上限：Agent id 128 字符、业务域 160 字符、职责范围 1000 字符；空域和
  空范围表示删除本地画像。输入会去除首尾空白并拒绝控制字符/NUL。
- AgentHub 抽屉把画像保存与 OpenClaw 运行时配置保存分开；切换 Agent 会重新加载画像，
  关闭抽屉前会提示未保存的画像改动。删除 Agent 成功后会清理画像；清理失败会显示告警，
  不会伪造清理成功。

## 验证

- `src/services/agentProfiles.test.ts` 覆盖 trim、空画像删除语义和长度/控制字符边界。
- `src/services/agentProfilesContract.test.ts` 覆盖 Rust command、Tauri 注册、前端参数
  和“不经 OpenClaw config.patch”的契约。
- Rust `app_settings` 单元测试覆盖旧 `settings.json` 缺少 `agent_profiles` 时的兼容性。
- AgentHub 交互测试继续覆盖设置抽屉的加载、切换和保存行为。

## 未验证边界

- 当前开发机未在 Windows、Linux 真机验证应用设置目录权限、用户迁移和多用户隔离。
- 未在真实 Gateway 上执行完整 Agent 删除后重建同一 id 的业务验收；本地画像按 id 保留，
  这是有意选择的可恢复行为，不等价于 OpenClaw 的运行时删除语义。
