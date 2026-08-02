# 定时任务 OpenClaw Agent 路由规格

日期：2026-08-02

## 当前行为

- JunQi 的任务创建表单和快速模板不能选择承接 Agent。
- 已有任务无法在定时任务页修改 Agent。
- `cron.add` 调用使用非官方 `{ job: ... }` 外层，并缺少必需的 `wakeMode`。

## 目标行为

1. agent-turn 定时任务可以固定到 `agents.list` 返回的任一 Agent。
2. 不固定 Agent 时省略 `agentId`，由 OpenClaw 使用配置的默认 Agent。
3. 清除已有任务的固定 Agent 时，`cron.update` patch 必须发送 `agentId: null`。
4. 非默认 Agent 任务使用 `sessionTarget: "isolated"`。
5. `cron.add` 参数直接符合当前 OpenClaw `CronAddParamsSchema`，不使用 `{ job: ... }` 外层。
6. 创建参数显式包含 `wakeMode: "now"`。
7. 模板和日历提醒也使用同一顶层 wire contract。
8. 页面显示任务的 Agent 归属，不能把未固定的任务伪装成某个明确存储的 Agent。
9. Agent 选择器必须复用当前共享 `Select`、Aegis 主题 token 和既有桌面工作台交互密度；保存期间保留用户当前选择，失败时回退到服务端值并内联报错。
10. 后续 UI 的主题、组件复用、交互状态、可访问性、响应式和验收约束写入根级 `AGENTS.md`。

## 验收条件

- [x] 创建任务时可选择默认 Agent 或一个已注册 Agent。
- [x] 选择具体 Agent 后，`cron.add` 顶层包含对应 `agentId`。
- [x] 选择默认 Agent 后，`cron.add` 不包含 `agentId`。
- [x] 修改已有任务时可设置具体 Agent，也可发送 `agentId: null` 清除固定值。
- [x] 模板和日历提醒不再发送 `{ job: ... }`。
- [x] 所有 agent-turn 创建参数包含 `sessionTarget: "isolated"` 和 `wakeMode: "now"`。
- [x] 回归测试能在旧实现的 `{ job: ... }` 外层和缺少 Agent 选择时失败。
- [x] 三种语言的 Agent 字段、默认值和更新失败文案完整。
- [x] Agent 控件复用现有主题化共享组件并覆盖 focus、disabled、loading、empty 和 error 状态。
- [x] Agent 更新后的读回失败不得静默回退到旧快照。
- [x] 已删除或未知 Agent 必须在选择器中保留可解释的当前值。
- [x] 两个弹窗复用 Radix Dialog，具备焦点进入、焦点约束、Escape、焦点归还和窄窗口布局。
- [x] 新增回归测试断言协议构建、读回确认和 Agent 选项状态，不依赖 Cron 页面源码变量名或调用文本。
- [x] 修改后的三个 locale 完整文件通过禁用符号码段扫描。
- [x] 根级 `AGENTS.md` 已记录后续 UI 一致性规则。
- [x] `pnpm lint`、协议定向测试和 `git diff --check` 通过；完整测试与真实 UI 验收边界见 validation。

## 未纳入本阶段

- command cron、condition trigger 和 `on-exit`；
- 完整 delivery、failure alert、model/fallbacks/thinking/tools 表单；
- `cron.status` 与 runId 精确轮询；
- 真实 Gateway 创建和执行验收。
