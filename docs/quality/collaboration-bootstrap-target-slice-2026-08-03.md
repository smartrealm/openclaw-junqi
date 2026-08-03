# Collaboration Bootstrap Target 子域拆分

日期：2026-08-03

## 依据

- `AGENTS.md` 对 Tauri command、运行时身份、Native/Docker 所有权和失败关闭的约束。
- 当前 `src-tauri/src/commands/collaboration_bootstrap.rs` 的 target 相关调用链。
- 本机 OpenClaw `2026.7.1-2 (0790d9f)` 的 Gateway 运行时选择边界；本次只调整 JunQi 内部模块边界，不新增 OpenClaw RPC。

## 当前问题

协作启动模块把目标分类、连接身份校验、运行时路径绑定、可持久化目标门禁和 CLI target 构造混在一个大文件中。它们共同决定是否允许安装或重启插件，继续在 command 文件中复制会增加 Native、System Service、Docker 和外部目标之间的漂移风险。

## 本次实现

- 新增 `src-tauri/src/commands/collaboration_bootstrap/target.rs`，集中维护：
  - `RuntimeIdentity` 到 `BootstrapTargetClass` 的分类；
  - target fingerprint、connection id 和完整 probe identity 校验；
  - JunQi 所有权、持久化能力、安装目标和 Desktop continuity 门禁；
  - Native/Docker CLI target 的验证构造；
  - 当前身份读取和运行时变更检测。
- `collaboration_bootstrap.rs` 继续公开原有 command、参数、响应和私有调用语义，仅通过 `use target` 使用上述实现。
- 没有改变 Tauri command 名称、注册路径、serde 字段大小写、错误码、Gateway 重启方式、插件路径或秘密数据边界。

## 验证

- `cargo fmt -- --check`：通过。
- `cargo check --lib`：通过。
- `cargo test --lib commands::collaboration_bootstrap`：52 项通过。
- `git diff --check`：待本轮全部文档和代码变更完成后执行。

## 未验证边界

- 当前主机是 macOS，未在 Windows、Linux 目标上执行交叉编译或真实 Tauri 安装流程。
- journal/plugin、recovery 子域仍未迁移；agent policy 和 package verification 已在独立切片中完成，FCA-14 仍是进行中。
- 未连接真实 Gateway 做插件安装、重启或外部目标切换；本次只证明本地调用链和既有测试行为保持一致。
