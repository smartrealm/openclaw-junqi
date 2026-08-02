# 定时任务 OpenClaw Agent 路由实施计划

日期：2026-08-02

## 实施顺序

1. 从当前安装的 OpenClaw `2026.7.1` schema 和 npm latest `2026.7.1-2` 文档确认 `agentId`、`sessionTarget`、`wakeMode` 与 `cron.add` 外层。
2. 建立 JunQi 当前 agent-turn cron 创建参数的最小类型和纯构建函数。
3. 先添加旧实现会失败的 wire-contract 和 Agent 路由回归测试。
4. 修复定时任务表单、快速模板和日历提醒的 `cron.add` 参数。
5. 在创建表单增加 Agent 选择，并在任务列表及详情显示 Agent 归属。
6. 在详情增加 Agent 更新控件；默认选项通过 `agentId: null` 清除固定值。
7. Agent 控件复用现有 Radix `Select` 和 Aegis 主题 token，补齐焦点、禁用、加载、错误和窄窗口滚动边界。
8. 将后续 UI 主题与交互一致性约束写入根级 `AGENTS.md`。
9. 补齐简体中文、繁体中文和英文文案。
10. 运行定向测试、完整 TypeScript 与模块边界检查、前端测试和补丁卫生检查。

## 文件范围

- `AGENTS.md`
- `src/services/gateway/cronContract.ts`
- `src/services/gateway/cronContract.test.ts`
- `src/pages/CronMonitor.tsx`
- `src/pages/maintenancePages.design.test.ts`
- `src/stores/calendarStore.ts`
- `src/stores/gatewayDataStore.ts`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `src/locales/en.json`
- `docs/quality/cron-openclaw-agent-routing-audit-2026-08-02.md`
- `specs/quality/2026-08-02-cron-openclaw-agent-routing.md`
- `plans/quality/2026-08-02-cron-openclaw-agent-routing.md`

## 验证

```bash
node --import ./test-setup.ts --import tsx --test \
  src/services/gateway/cronContract.test.ts \
  src/pages/maintenancePages.design.test.ts
pnpm lint
pnpm test
git diff --check
```

真实 Gateway 的创建、修改、手动运行和指定 Agent 执行仍需在开发版 Tauri 中人工验证。

## AGENTS.md 复审整改阶段

1. 区分 Agent 加载中、加载失败和真实空列表，并为失败提供就地重试。
2. 收紧 `cron.update` 后的读回确认，避免刷新失败时静默显示旧 Agent。
3. 为已删除或未知 Agent 保留可解释的当前选择项。
4. 将快速模板和创建任务弹窗收敛到共享对话框契约，补齐焦点管理、Escape、焦点归还和窄窗口布局。
5. 用可执行行为测试替换源码文本守护，覆盖创建、模板、更新、清除、失败回退和可访问状态。
6. 清理三个已修改 locale 完整文件中的禁用符号码段。
7. 重新执行定向测试、`pnpm lint`、完整 `pnpm test`、完整文件符号扫描和 `git diff --check`。
8. 在亮色、暗色、键盘和窄窗口中人工验收后，才可关闭 UI 验收项。
