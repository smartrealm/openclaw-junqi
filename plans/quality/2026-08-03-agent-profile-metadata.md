# Agent Profile 本地元数据实施计划

## 实施项

- [x] 核对本机 OpenClaw `agents.*`、`agent.identity.get` 契约和 JunQi AgentHub 调用链。
- [x] 在 `AppSettings` 增加向后兼容的 `agent_profiles` 存储和长度/控制字符校验。
- [x] 注册 `load_agent_profiles`、`save_agent_profile`、`delete_agent_profile` Tauri command。
- [x] 增加 TypeScript service、IPC 契约测试和输入边界测试。
- [x] 在 AgentHub 设置抽屉增加 Domain/Scope 编辑入口，独立于 OpenClaw 运行时保存。
- [x] 在 Agent 删除流程清理本地画像，并对清理失败显式告警。
- [x] 同步中英文、繁体中文文案及 docs/specs/plans 索引。
- [ ] Windows、Linux 真机验证设置目录权限和首次迁移。
- [ ] 真实 Gateway 验收 Agent 删除后重建同一 id 的画像保留策略。

## 验证顺序

1. Rust `cargo fmt -- --check`、`cargo check --lib` 和 `app_settings` 单元测试。
2. Agent Profile 与 AgentHub 相关 TypeScript 测试、类型检查和模块边界检查。
3. `pnpm build`、完整 `pnpm test` 和 `git diff --check`。
4. 记录真机未验证边界，不把自动化结果描述为目标平台验收。
