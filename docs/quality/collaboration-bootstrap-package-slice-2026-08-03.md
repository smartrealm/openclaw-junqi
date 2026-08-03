# Collaboration Bootstrap Package 子域拆分

日期：2026-08-03

## 依据

- JunQi 已固定的协作插件包名、插件 ID、bundled metadata 和 SHA-256 约束。
- OpenClaw 插件 manifest 必须声明匹配的 package、version、plugin id 和 `./dist/index.js` entry。
- FCA-14 要求归档校验与安装写入边界分离，且不改变现有恢复证据。

## 本次实现

- 新增 `src-tauri/src/commands/collaboration_bootstrap/package.rs`。
- 将归档绝对路径、大小和扩展名校验，tar/gzip entry 和展开大小边界，manifest 解析，包版本一致性，SHA-256 比对以及 bundled metadata 对账迁移到该模块。
- `collaboration_bootstrap.rs` 继续负责 staging、安装、journal 和恢复；校验结果结构与既有错误码保持不变。
- 不接受外部包字段覆盖 renderer 传入的 pinned package identity，不扩大资源路径或秘密边界。

## 验证

- `cargo fmt -- --check`：通过。
- `cargo check --lib`：通过。
- `cargo test --lib commands::collaboration_bootstrap`：52 项通过。

## 未验证边界

- 未在真实 Gateway 或发布安装器中执行插件安装。
- 未在 Windows/Linux 目标验证压缩包文件权限、资源解析和 CLI 路径行为。
- staging、journal/plugin 和 recovery 仍在父模块，FCA-14 继续进行。
