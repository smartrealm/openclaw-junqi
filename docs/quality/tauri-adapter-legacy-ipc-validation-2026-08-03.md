# Tauri 适配器遗留 IPC 验证记录

日期：2026-08-03

## 自动化证据

已通过：

- `node --import ./test-setup.ts --import tsx --test src/api/tauriAdapterContracts.test.ts src/api/tauriCommandsContract.test.ts src/api/openclawConfigPersistence.contract.test.ts`，25 项通过。
- `pnpm lint`，包含模块边界、版本一致性和 `tsc --noEmit`。
- `cd src-tauri && cargo fmt -- --check && cargo check --lib && cargo test --lib platform_info_serialization_does_not_expose_local_paths`；目标 Rust 测试 1 项通过。

新增 DTO 测试验证平台回包只投影 `os`、`arch`，malformed 平台字段被拒绝，且只有同时具备
`stateDir`、`workspaceDir` 的存储回包才能进入 runtime-data bridge。系统指标事件必须具备完整的
非负数值与平台字段，否则不会覆盖最近一次已验证投影。Rust 序列化测试确保 `get_platform_info`
不再传递 home 或 desktop 路径。

适配器、Performance 与 ambient declaration 的 `any` 检索为零；`window.aegis.device` 和
`window.aegis.terminal` 的生产调用检索为零。

## 已知警告

`cargo check --lib` 仍报告 `src-tauri/src/commands/system.rs:1665` 的
`version_beyond_verified_range` 未使用变量。该变量属于既有 OpenClaw 版本范围逻辑，不是本轮
platform DTO 的副作用；其“版本不能作为能力开关”问题需要单独按官方能力广告与 handler 重新审计，
不能仅通过改名压制警告。

## 未验证边界

- 未在 Windows、macOS、CentOS 或 Ubuntu 真机验证 browser preview no-op、原生窗口控制、平台信息
  展示和系统指标 event。
- 未运行本轮 `pnpm build` 或 `pnpm tauri build`。正式打包仍需要各目标平台工具链、签名与发布凭据。
