# Collaboration Bootstrap Target 子域拆分规格

日期：2026-08-03

## 目标行为

协作启动 command 使用独立的 target 模块完成运行时身份分类和 mutation gate，同时保持现有前端 IPC 与 Gateway 生命周期行为不变。

## 验收条件

- `target.rs` 是 target 分类、身份比对、所有权门禁和 CLI target 构造的唯一实现位置。
- `collaboration_bootstrap.rs` 的 command 名称、参数外层、camelCase 字段、响应字段和错误码保持不变。
- Native managed、System Service、Docker、外部本地、外部远端和未知目标的分类结果保持不变。
- 未验证身份、非 JunQi 所有权、目标 fingerprint 变化、connection 变化和路径变化继续失败关闭。
- 现有协作启动定向测试通过，且 Rust 格式与编译门禁通过。

## 非目标

- 不新增或猜测 OpenClaw RPC、插件字段或运行时状态。
- 不修改插件安装、配置写入、journal、恢复和重启实现。
- 不把当前开发机平台或 Gateway 配置当成其他平台的默认条件。

## 未完成项

FCA-14 的其余 agent policy、package/storage、journal/plugin 和 recovery 子域需要独立切片，必须继续保持相同的 wire contract 与运行时所有权门禁。
