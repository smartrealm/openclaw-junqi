# 无引用代码与终端类型收敛规格

日期：2026-07-29

## 当前行为

- `src/junqi/shortcuts.ts` 同时保留已废弃的提示词发送快捷键和仍在使用的终端换行快捷键。
- `src/junqi/platform.ts` 只服务于上述废弃快捷键；Terminal 已有完整的平台实现。
- `src/junqi/types.ts` 与 `src/components/Terminal/terminalTypes.ts` 高度重复，且默认字体栈已经漂移。
- `src/theme/index.ts` 没有生产或测试消费者。
- Rust 保留两个零引用 helper，并在两个仍被读取的 `AgentSpec` 字段上残留错误的 dead-code 豁免。

## 目标行为

- shortcuts 只导出实际运行中的终端换行契约。
- Terminal 页面、树视图和终端组件统一使用 `terminalTypes.ts`。
- 删除无引用的平台、主题 barrel 和 Rust helper。
- 保留 Workbench provider claim IPC；`AgentSpec.label` 与 `resume_flag` 继续分别服务能力探测和会话恢复。

## 验收条件

- 被删除文件和符号在生产源码中没有引用。
- 终端换行、字体类型、provider 能力探测和会话恢复契约由回归测试覆盖。
- TypeScript、模块边界、Rust library、全量测试和生产构建通过。
