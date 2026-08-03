# Collaboration Bootstrap Package 子域拆分计划

日期：2026-08-03

1. [x] 清点归档解析、manifest、SHA-256 和 bundled metadata 的调用点。
2. [x] 将 package verification 迁移到 `commands/collaboration_bootstrap/package.rs`。
3. [x] 保持 staging、安装、journal 和 recovery 在父模块。
4. [x] 运行协作启动定向测试、Rust 格式检查和库编译。
5. [ ] 拆分 journal/plugin 和 recovery，并在每个切片后重新核对命令契约。
