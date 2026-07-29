# 无引用代码与终端类型收敛计划

日期：2026-07-29

## 执行顺序

- [x] 用生产引用和跨边界调用点复核外部审计报告。
- [x] 增加修复前失败的清理回归测试。
- [x] 删除废弃发送快捷键，保留终端换行行为。
- [x] 将终端类型消费者迁移到 `terminalTypes.ts` 并删除重复来源。
- [x] 删除无引用主题 barrel、平台模块和 Rust helper。
- [x] 移除活字段上的错误 dead-code 豁免，保留字段及 provider claim IPC。
- [x] 完成 TypeScript、Rust、全量测试、生产构建和差异检查。

## 文件边界

- `src/junqi/shortcuts.ts`
- `src/components/Terminal/terminalTypes.ts` 及其消费者
- `src-tauri/src/{paths.rs,commands/ensure.rs,commands/agent_task_pty.rs}`
- 清理回归测试与验证记录

## 回滚边界

本轮不修改快捷键语义、provider claim IPC、PTY 恢复参数或用户持久化数据。
