# 语音唤醒监听配置围栏计划

日期：2026-08-04

## 执行顺序

1. 记录原生 worker 配置重用和 IPC 回执不一致的证据。
2. 将 worker 的模式与 PCM 流配置作为同一采集配置，并仅对该配置保持幂等。
3. 在前端启动路径校验原生回执，不接受未监听或模式漂移。
4. 添加 Rust 与 TypeScript 回归测试。
5. 执行格式、定向测试、完整 TypeScript/Rust/前端、构建、官方文档和 diff 验证。

## 文件范围

- `src-tauri/src/commands/voice_wake.rs`
- `src/api/tauri-commands.ts`
- 对应 Rust 和 TypeScript 测试
- 本记录、规格、计划及三个索引

## 约束

- 保留 OpenClaw Gateway 作为唯一触发词、路由、Talk 和会话权威。
- 不伪造跨平台成功状态；目标系统真机验证单独记录。
