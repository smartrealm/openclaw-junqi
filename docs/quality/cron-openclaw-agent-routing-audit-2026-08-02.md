# 定时任务与 OpenClaw Agent 路由审计

日期：2026-08-02

## 依据

- JunQi 当前锁定 `openclaw@2026.7.1`。
- npm `latest` 在审计时为 `2026.7.1-2`；其 `docs/automation/cron-jobs.md` 与 `docs/cli/cron.md` 已核对。
- 当前安装包的 Gateway Protocol schema 位于 `dist/schema-*.js`，`CronAddParamsSchema`、`CronUpdateParamsSchema` 和 `CronJobSchema` 是 RPC 契约。
- 官方文档明确支持 `openclaw cron create ... --agent ops`、`openclaw cron edit <job-id> --agent ops` 和 `--clear-agent`。

## 结论

OpenClaw cron 可以通过任务顶层 `agentId` 指定承接 Agent。未设置 `agentId` 时，Gateway 使用配置的默认 Agent。非默认 Agent 的模型任务应使用 `sessionTarget: "isolated"`；`main` 只适用于默认 Agent。

JunQi 当前定时任务页没有创建时的 Agent 选择，也不能查看或修改已有任务的 Agent。更严重的是，三个创建入口把官方 `cron.add` 参数错误包在 `{ job: ... }` 中，而当前官方 schema 要求 `name`、`schedule`、`sessionTarget`、`wakeMode` 和 `payload` 直接位于 RPC 参数顶层。该错误可能让创建动作被 Gateway 参数校验拒绝。

## 问题分级

### BUG-CRON-01 严重：cron.add 参数外层与官方 schema 不一致

位置：

- `src/pages/CronMonitor.tsx`
- `src/stores/calendarStore.ts`

当前行为：调用 `cron.add` 时传入 `{ job: definition }`，并且任务定义缺少当前 schema 要求的 `wakeMode`。

目标行为：所有 JunQi 创建入口直接传递官方 CronAddParams，并显式设置 `wakeMode: "now"`。不得通过兼容包装或静默重试掩盖协议漂移。

### BUG-CRON-02 高：无法指定或修改任务承接 Agent

位置：`src/pages/CronMonitor.tsx`

当前行为：创建表单、快速模板和任务详情都没有 Agent 控件，任务列表也不显示已固定的 `agentId`。

目标行为：

- 创建普通任务和模板时可以选择已注册 Agent；
- 保留“默认 Agent”选项，选择它时不写入 `agentId`；
- 已有任务可以通过 `cron.update` 设置 Agent，或用 `agentId: null` 清除固定值；
- 任务列表和详情显示实际存储的 Agent，未固定时明确显示默认 Agent。

### BUG-CRON-03 中：页面用宽泛 any 表达 cron 核心契约

位置：`src/pages/CronMonitor.tsx`、`src/stores/gatewayDataStore.ts`

当前行为：schedule、payload 和 run entries 大量使用 `any`，创建参数无法由 TypeScript 检查。

目标行为：本阶段先建立 JunQi 使用到的 agent-turn 创建联合类型和纯构建函数，并让所有创建入口消费它。完整 cron list、runs、delivery、trigger 和 command 联合类型后续按官方协议分阶段收敛。

## 与官方完整能力的剩余差距

本次只修复 Agent 路由和创建 wire contract。以下能力仍未完整接入：

- `at`、`every`、`cron`、`on-exit` 四种创建表单；
- `main`、`isolated`、`current`、自定义 session；
- model、fallbacks、thinking、light context、tools 和 timeout；
- announce、webhook、none、失败通知与投递目标预览；
- command payload 和 condition trigger；
- `cron.status`、服务开关、分页筛选；
- 手动运行返回 `runId` 后按该 run 精确轮询；
- run history 的 typed decoder、skipped 状态和诊断信息。

这些能力不能根据字段名称猜测实现，后续必须继续以当前安装版本 schema 和官方文档为契约。

## 实现后 AGENTS.md 合规复审

复审日期：2026-08-02

本节针对当前未提交实现，按根级 `AGENTS.md` 的工程边界、测试、主题、交互、文档和完整文件符号扫描规则重新检查。协议构建器和 OpenClaw schema 对齐成立，但实现尚不满足完成标准。

### BUG-CRON-04 高：Agent 数据失败被呈现为只有默认 Agent

位置：`src/pages/CronMonitor.tsx:216-262`、`src/pages/CronMonitor.tsx:777-798`

当前页面读取 `agents`，但没有读取 `loading.agents` 或 `errors.agents`。`ensureGroupFresh('agents')` 内部会把请求失败写入 Store 后正常返回，因此页面在请求失败、尚未加载和真实空列表三种情况下都会只显示“默认智能体”。

影响：

- 用户无法判断没有其他选项是因为尚未配置 Agent，还是因为 Gateway 请求失败；
- Agent 路由功能可能看似可用，实际丢失了可选 Agent；
- 不符合 `AGENTS.md` 对 loading、empty、error 和禁止静默失败的要求。

修复建议：消费 Agent loading/error 状态；加载时禁用选择器并显示加载反馈，失败时在选择器附近显示可重试错误，真实空列表时显示明确空状态。

### BUG-CRON-05 高：Agent 更新的读回失败会静默回退

位置：`src/pages/CronMonitor.tsx:476-490`、`src/stores/gatewayDataStore.ts:763-780`

`updateJobAgent()` 在 `cron.update` 后等待 `refreshGroup('cron')`，但 `fetchCron()` 会捕获读回错误并只写入 Store，不会向调用方抛出。随后页面清除 `pendingAgentId`，选择器回到旧快照，且没有展示 `errors.cron`。

影响：

- 更新可能已经成功，但页面静默显示旧 Agent；
- 用户无法判断是保存失败还是读回失败；
- 违反异步状态不得与服务端状态不一致、不得静默失败的规则。

修复建议：让刷新边界返回可判定结果，或在更新后检查当前请求对应的 cron error；只有读回成功并确认任务快照后才清除 pending 状态。

### BUG-CRON-06 高：两个弹窗未满足共享对话框与可访问性契约

位置：`src/pages/CronMonitor.tsx:942-1012`、`src/pages/CronMonitor.tsx:1014-1155`

快速模板弹窗仍是普通 `div`：没有 dialog 语义、焦点进入、焦点约束、Escape 处理和焦点归还，并使用固定 `w-[560px]` 与固定两列网格。创建弹窗虽然添加了 `role="dialog"` 和 Escape 分支，但仍没有焦点进入、焦点约束和关闭后的焦点归还，也没有复用现有对话框组件。

影响：

- 键盘和辅助技术用户可能把焦点留在遮罩后的页面；
- 快速模板在窄于 560px 的窗口可能横向溢出；
- 不符合 `AGENTS.md` 的共享组件、可访问性、窄窗口和完整交互状态要求。

修复建议：复用当前 Radix Dialog 或已经验证的共享对话框模式，并将模板容器改为弹性最大宽度、可滚动高度和窄窗口单列布局。

### BUG-CRON-07 中：已删除或未知 Agent 会让 Select 触发器缺少可选项

位置：`src/pages/CronMonitor.tsx:779-797`

任务可以保存一个不再出现在 `agents.list` 中的 `agentId`。详情标题会回退显示该 ID，但 Radix Select 的 items 只来自当前 `agents`，因此当前 value 没有对应 item。

影响：

- 选择器可能显示空值，无法解释任务仍固定到哪个 Agent；
- 用户可能误以为任务使用默认 Agent。

修复建议：当任务的已存储 `agentId` 不在列表中时，增加只用于当前值的“不可用 Agent”选项，并保留切换到默认或其他有效 Agent 的能力。

### BUG-CRON-08 高：新增回归测试违反测试契约

位置：`src/services/gateway/cronContract.test.ts:51-59`、`src/pages/maintenancePages.design.test.ts:7-22`

测试通过读取源码并断言函数名、变量名、组件标签和调用文本来守护实现。这与根级 `AGENTS.md` 中“守护测试断言契约，不断言实现的书写形式”的规则冲突。抽取函数、重命名变量或等价改写都会让测试失败，而不代表行为回归。

修复建议：保留纯协议构建器的行为测试；将 UI 路由和更新改为可注入 Gateway 的行为测试，断言用户选择后发出的 RPC 参数、加载状态、失败回退和可访问语义。不得把源码正则作为主要验收证据。

### BUG-CRON-09 高：修改后的 locale 完整文件不满足符号扫描规则

位置：`src/locales/en.json`、`src/locales/zh.json`、`src/locales/zh-TW.json`

按完整文件扫描，三个已修改 locale 仍包含 Unicode 箭头和键盘符号。此前只比较了相对 HEAD 新增的符号，因此“无新增匹配”不等于满足 `AGENTS.md` 的“修改后的完整文件”扫描要求。

影响：

- 当前工作树不满足根级强制规则；
- 先前的合规结论和扫描口径不准确。

修复建议：在提交本任务前，把三个修改文件中的现有符号转换为纯文本表达，并重新扫描完整文件。该清理只处理规则明确禁止的字符，不扩展到无关业务重构。

### BUG-CRON-10 中：规格和验证记录提前宣告 UI 验收完成

位置：`specs/quality/2026-08-02-cron-openclaw-agent-routing.md`、`docs/quality/cron-openclaw-agent-routing-validation-2026-08-02.md`

规格把主题化交互和完成门禁标为已完成，但尚未执行亮色、暗色、键盘焦点、窄窗口、Agent 加载失败和 cron 读回失败验收；验证文档也没有列出这些 UI 边界。

修复建议：把未满足的验收项恢复为未完成，并在 validation 中明确记录本次复审发现和未验证边界，整改及真实验证后再勾选。

## 整改结果

BUG-CRON-04 至 BUG-CRON-10 已完成代码整改：

- 页面明确区分 Agent 加载中、加载失败、真实空列表和正常数据；失败状态提供就地重试。
- Agent 更新后要求 `cron.list` 读回成功且目标任务的 `agentId` 与用户选择一致，否则保留明确错误。
- 已删除或未知 Agent 作为“不可用”当前选项保留，不再让 Select 触发器显示空值。
- 快速模板和创建任务均复用 `src/components/ui/dialog.tsx` 的 Radix Dialog；焦点进入、焦点约束、Escape 和焦点归还由共享组件提供，窄窗口使用弹性宽度、滚动边界和模板单列布局。
- 删除 cron 页面源码正则守护，新增纯函数行为测试覆盖 Agent 状态、未知选项和读回确认。
- 三个修改后的 locale 完整文件已清理禁用符号，完整文件扫描结果为零匹配。
- spec 和 validation 已同步整改后的完成状态及仍需真实 Tauri 验证的边界。

## 复审结论

协议和自动化合规整改已完成。真实 Gateway 执行、亮暗主题视觉、键盘和窄窗口人工验收仍属于明确记录的未验证边界，不能由自动化结果替代。
