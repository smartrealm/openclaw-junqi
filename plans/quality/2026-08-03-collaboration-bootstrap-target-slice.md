# Collaboration Bootstrap Target 子域拆分计划

日期：2026-08-03

1. [x] 核对现有 target 分类、身份校验、持久化门禁和 CLI 构造的调用点。
2. [x] 将 target 实现迁移到 `commands/collaboration_bootstrap/target.rs`，保留父模块调用入口和私有可见性。
3. [x] 运行协作启动 Rust 定向测试、格式检查和库编译。
4. [ ] 复核并拆分 agent policy 子域，先补独立契约测试。
5. [ ] 复核 package/storage、journal/plugin、recovery 子域，逐片迁移并更新 FCA-14 总体记录。

## 停止条件

任何子域迁移导致 command 注册、serde 字段、错误码、Gateway 所有权或秘密边界变化时，停止该切片并恢复为仅记录未验证，不做猜测性兼容。
