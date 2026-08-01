# 发布 CI 与安装包构建收敛

## 当前问题

常规 CI 在 `main` 上执行 Windows x86/x64 原生编译与测试。标签发布在等待该 CI 成功后，再为同一两个 Windows 目标重新编译并生成 NSIS 安装包。两阶段串行导致发布开始时间被重复工作拉长。

## 目标

- 常规 CI 仅验证跨平台共享代码：Linux Rust、前端检查、测试和 Vite 构建。
- 标签发布完成来源校验后立即启动五目标安装包构建。
- 每个 Windows 发布目标在安装包构建前执行其对应目标的 Rust 库测试。
- GitHub Release 只在五目标构建和同提交 `main` CI 均成功后创建。

## 非目标

- 不删除 macOS ARM64、macOS x64、Windows x86、Windows x64 或 Windows ARM64 的正式发布目标。
- 不在 CI 或发布中使用未锁定的 Cargo 解析。

## 验收

- 标签工作流的安装包构建不依赖等待外部 CI 的 `verify` 步骤。
- `publish` 在创建 GitHub Release 前验证同提交 `main` CI 成功。
- Windows 发布构建在 `tauri-action` 前执行目标匹配的 `cargo test --locked --lib`。
- CI summary 不再依赖重复的 Windows job。
