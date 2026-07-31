# Agent 分步执行计划与折叠进度设计

日期：2026-07-30

状态：Chat 结构化计划投影进入实现，AgentRun 与 Dynamic Island 尚未实现

## 1. 背景

用户提供的两张界面截图展示了同一个分步进度组件的展开态和折叠态。根据本机只读 OCR 与布局分析，展开态包含五个连续步骤：

1. 加载 V1 必读治理文档；
2. 定位钩子文件与引用；
3. 确认重复或废弃钩子；
4. 执行最小化清理；
5. 验证剩余钩子行为。

底部文字应为“第 1/5 步”；OCR 将斜杠误识别为数字。折叠态仅保留“第 1/5 步”摘要。这说明截图表达的不是普通静态清单，而是一个可展开、可折叠、能够呈现当前执行位置的任务进度组件。

本设计只提取公开可观察的通用交互模式，不复制截图来源项目的源码、DOM、CSS、尺寸、字体、图标、颜色、阴影、动画曲线、文案或视觉资产。最终实现必须使用 JunQi 自有领域模型、Aegis 设计系统和现有任务状态 authority。

## 2. 产品问题

当前 Agent 长任务可能经历文档阅读、代码定位、方案确认、文件修改和验证等多个阶段。用户虽然能够看到终端输出、Tool Call、Thinking 和最终结果，但仍难以快速回答：

- Agent 当前处于哪个业务阶段；
- 已完成哪些阶段；
- 后续还要做什么；
- 当前是运行、等待输入、失败还是被跳过；
- 原计划是否发生过调整；
- 折叠大量过程信息后，如何继续观察核心进度。

单一 spinner 只能表示“仍在运行”，Tool Call 列表则过于接近实现细节。需要在两者之间提供一个用户可理解的任务阶段层。

## 3. 使用场景

### 3.1 Chat 中的 Agent 长任务

这是第一优先级场景。Agent 发出可信的结构化计划后，最新未完成计划作为会话级面板显示在输入框正上方，与输入框及发送按钮共用同一条水平居中的内容列；它不占用 assistant avatar/message 列，也不作为普通消息行随 Virtuoso 滚动。点击整块面板可展开或折叠。计划完成后从输入框上方撤下，并作为折叠后的执行记录保留在原消息时间线位置。

展开态示例：

```text
PASS 阅读安装流程文档
● 定位前后端安装入口
○ 复现安装失败
○ 实施最小修复
○ 运行回归验证

第 2/5 步
```

折叠态示例：

```text
执行计划 · 第 2/5 步 · 定位前后端安装入口
```

适合代码审查、Bug 修复、重构、多文件修改、系统配置和深度研究等至少包含三个阶段的任务。

### 3.2 AgentRun 任务运行页

AgentRun 在任务标题、任务级状态和终端输出之外显示当前计划摘要。用户可以展开完整步骤，查看失败原因、等待输入和计划修订记录。

Chat 与 AgentRun 必须消费同一份任务计划数据，不能分别推测或维护两套进度。

### 3.3 Dynamic Island 摘要

Dynamic Island 空间有限，只投影：

- 任务标题；
- 当前步骤标题；
- 当前步骤序号与总数；
- running、waiting、failed 等关键状态。

示例：

```text
修复安装流程 · 3/5
运行回归验证
```

Dynamic Island 不展开完整步骤树。点击摘要应恢复主窗口并进入对应 Agent Task。

### 3.4 安装、恢复与构建流程

安装和恢复已有真实步骤时，可以复用展示组件及状态语义，例如：

```text
PASS 检查系统依赖
PASS 安装 OpenClaw
● 写入当前 Runtime 配置
○ 验证 Gateway 身份
○ 探测默认模型
```

但安装流程继续由安装领域自己的 Store、Tauri command 和事件负责，不能改由 Agent 任务计划 Store 接管。

构建和发布任务同样适合展示 provider catalog、collaboration bundle、TypeScript、Vite、Rust、DMG 校验等可验证阶段。

### 3.5 多 Agent 协作

协作运行可以展示阶段级计划，例如任务创建、子 Agent 调研、汇总、冲突审查和最终交付。首期不实现无限嵌套 DAG；并行子任务可作为某个阶段的简短明细。

## 4. 不适用场景

以下情况默认不显示计划卡：

- 普通短问答、翻译或单步解释；
- 没有结构化计划事件的自由文本回复；
- 只有一至两个瞬时 Tool Call 的任务；
- 心跳、轮询、Token 刷新和内部重试；
- 仅凭“我先检查，然后修改”一类模型口述推断的伪进度。

不能把每个 `read`、`rg`、`git status` 或 Tauri `invoke` 直接提升为用户可见步骤。Tool Call 是阶段内部的执行细节，计划步骤是用户可理解的任务阶段。

## 5. 当前代码现状

本文最初基于本地 `main` 提交 `35bd5c4987bf2fbc42dcaed0027455c82b4f0d43` 复核，并于 2026-07-30 按锁定的 OpenClaw `2026.7.1` 安装包再次核对协议。

### 5.1 已有能力

- `src/components/Chat/ExecutionProcessGroup.tsx` 已按运行、完成和错误聚合 Thinking 与 Tool Call；
- `src/components/Chat/ToolCallBubble.tsx` 和 `ThinkingBubble.tsx` 已展示过程级事件；
- `src/pages/AgentRunView.tsx` 已维护 Agent Task 生命周期、终端输出、Tool Call 历史、等待输入和恢复状态；
- `src/stores/agentWorkspaceStore.ts` 已是 Agent Workspace Task 的持久化 authority，支持 `running`、`input_required`、`awaiting_review`、`interrupted`、`done` 和 `failed` 等状态；
- `src/dynamic-island/model.ts` 已从 Agent Workspace Task 投影任务级摘要；
- `src/components/setup/SetupFlowPanels.tsx` 已有安装领域的步骤状态、当前步骤、百分比和时间线展示。

### 5.2 已验证的新依据

- OpenClaw `2026.7.1` 内置 `update_plan` 工具，输入是结构化有序步骤快照；
- 每个步骤包含 `step` 和 `status`，状态限定为 `pending`、`in_progress`、`completed`；
- Gateway 工具流提供 `sessionKey`、`runId`、`seq`、`toolCallId`、工具参数和生命周期阶段；
- JunQi 已保存实时工具参数和历史 transcript 中的结构化工具内容。

这使 Chat 首期可以忠实投影 `update_plan`，不需要解析自然语言。详细证据和适配限制见 `docs/quality/chat-execution-plan-protocol-audit-2026-07-30.md`。

### 5.3 仍然缺失的能力

- Agent Task 没有结构化的任务计划及稳定 Step ID；
- 没有 plan revision、步骤新增、重排或跳过的协议；
- Chat、AgentRun 和 Dynamic Island 无法消费同一份当前步骤；
- Tool Call 事件无法可靠地推导业务阶段；
- 当前 `planMode` 只调整 Prompt，不等于真实执行计划 authority；
- `update_plan` 是快照协议，不提供原生 planId、revision 或稳定 Step ID；
- waiting、failed 和 skipped 不属于当前 OpenClaw 工具状态，不能在 Chat 首期自行推断。

因此不能只新增一个截图外观组件。必须先建立可信的计划事件和状态边界，再进行 UI 投影。

## 6. 领域模型

建议最小状态集合为：

```ts
export type ExecutionPlanStepState =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'skipped';
```

步骤模型：

```ts
export interface ExecutionPlanStep {
  id: string;
  title: string;
  state: ExecutionPlanStepState;
  order: number;
  detail?: string;
  failureReason?: string;
  startedAt?: number;
  completedAt?: number;
}
```

计划模型：

```ts
export interface AgentExecutionPlan {
  id: string;
  taskId: string;
  revision: number;
  steps: ExecutionPlanStep[];
  createdAt: number;
  updatedAt: number;
}
```

折叠偏好属于视图状态，不属于执行事实。`第 2/5 步` 应从步骤集合推导，不能作为独立业务字段写入。

## 7. Authority 与事件来源

### 7.1 单一事实源

`AgentWorkspaceTask` 继续作为任务 authority。计划可以作为其规范扩展，或由按 `taskId` 索引的专用领域 Store 保存，但不能建立第二套任务生命周期。

任务级状态和步骤级状态之间必须有明确关系：

- 任一步骤 `waiting` 时，任务可映射为 `input_required` 或 `awaiting_review`；
- 步骤 `failed` 不应自动把任务显示为成功；
- 任务取消后，尚未执行的步骤不能继续显示为 running；
- 任务完成前，所有非 skipped 步骤必须有可解释的终态，或明确记录计划被修订。

### 7.2 可信事件

计划状态只能来自以下来源之一：

1. Agent runtime 提供的结构化 plan/step 事件；
2. JunQi 自己可验证的确定性工作流；
3. 用户明确批准后的计划编辑；
4. 安装或协作领域已有的正式步骤协议。

如果当前 Agent CLI 只输出自由文本且没有稳定协议，应标记为“待验证”，不能用正则从自然语言或终端文本猜测成功条件。

### 7.3 事件幂等与顺序

计划事件至少需要：

- `taskId`；
- `planId`；
- `revision`；
- 稳定 `stepId`；
- 单调 sequence 或可比较时间；
- 明确的目标状态。

重复、乱序或旧 revision 事件不得覆盖较新的计划。

## 8. 计划修订

真实 Agent 会新增、删除、重排或拆分步骤。界面需要支持：

```text
计划已更新 · 5 → 7 步
```

规则：

- 已存在步骤使用稳定 ID，不因重新排序重新创建；
- 删除已完成步骤时保留审计记录，不能静默消失；
- 新增步骤进入 pending；
- 当前步骤变化时保留 revision；
- UI 默认显示最新计划，可查看修订摘要；
- 计划修订不能回写或伪造已经发生的 Tool Call。

## 9. 展示规则

### 9.1 展开态

每行包含：

- 状态图标；
- 步骤标题；
- 必要时显示简短 detail；
- waiting、failed 状态的可操作入口。

状态语义应接入 JunQi canonical status tone：

- pending：dormant；
- running：running；
- waiting：attention；
- completed：success；
- failed：danger；
- skipped：neutral/dormant。

不得使用硬编码品牌色或借用截图原始颜色。

### 9.2 折叠态

折叠态至少保留：

- “执行计划”标签；
- 当前步骤序号与总数；
- 当前步骤标题；
- waiting 或 failed 的强提示。

任务完成后显示“5/5 已完成”，而不是继续显示 running。

### 9.3 可访问性

- 展开按钮使用真实 `button`；
- 提供 `aria-expanded` 和受控区域 ID；
- 状态变化使用克制的 `aria-live="polite"`；
- 不依赖颜色单独表达状态；
- 键盘可以展开、折叠并进入错误或等待操作；
- 遵循 reduced-motion，不强制旋转或展开动画。

## 10. 交互异常

### 10.1 等待用户输入

```text
! 确认是否覆盖现有配置
  等待你的选择
```

waiting 既不是 running，也不是 failed。点击应进入现有任务输入通道，而不是在计划卡内部建立平行表单。

### 10.2 步骤失败

```text
FAIL 运行回归测试
  3 项测试失败
```

可提供“查看日志”或“回到任务”，重试操作必须调用原任务 authority。

### 10.3 跳过步骤

```text
— 安装 Node.js
  已检测到兼容版本，跳过
```

skipped 计入已处理数量，但不能冒充 completed。

### 10.4 并行步骤

首期不实现图形化 DAG。可以把并行执行归入一个阶段：

```text
● 运行验证
  前端：执行中 · Rust：完成 · Collaboration：执行中
```

“第 N/M 步”在并行场景下只能表达阶段位置，不能暗示严格串行。

### 10.5 来源丢失

Task 或计划来源丢失时必须 fail closed：

- 显示“计划来源不可用”；
- 不替换为最近任务；
- 不继续模拟进度；
- Dynamic Island 不跳转到其他 Task。

## 11. 推荐实现阶段

### 阶段一：协议验证

- 核对当前安装版本的 Claude、Codex、Pi 和 OpenClaw 是否存在正式结构化 plan/step 事件；
- 记录每种 runtime 的协议依据和未验证边界；
- 没有权威事件时停止自动推断方案。

### 阶段二：纯领域与回归测试

- 定义计划、步骤、revision 和事件 reducer；
- 覆盖重复事件、乱序事件、旧 revision、失败、等待、跳过和取消；
- 从步骤集合确定性推导当前步骤与摘要。

### 阶段三：Chat 计划卡

- 从消息时间线投影最新未完成计划，在输入框正上方、发送列中心显示会话级面板；
- 未完成计划不重复占用 assistant 消息列，完成计划回到消息流保留折叠记录；
- 不改变现有 Thinking 和 Tool Call 语义；
- 支持点击整块展开、折叠、长文本和三语言。

### 阶段四：AgentRun 复用

- AgentRun 消费同一计划 selector；
- 将 waiting/failed 操作连接到现有任务输入、日志和恢复能力；
- 不建立新的运行按钮或任务 Store。

### 阶段五：Dynamic Island 摘要

- 在 `DynamicIslandTask` 中增加经验证的当前步骤快照；
- 只显示摘要，不传输完整日志或敏感 detail；
- 点击精确返回对应 Task。

### 阶段六：领域组件复用

- 评估安装、构建和 collaboration 是否只复用展示组件；
- 各领域继续保持自己的 authority 和协议。

## 12. 非目标

首期不实现：

- 从自然语言猜测步骤及成功状态；
- 把 Tool Call 数量转换成百分比；
- 像素级复制截图；
- 无限嵌套计划树或完整 DAG 编辑器；
- 模型自动决定不可逆操作已经成功；
- 在 Dynamic Island 中展示完整日志；
- 将安装、协作和 Agent Task 合并为一个万能 Store；
- 用前端持久化冒充 runtime 的实时状态。

## 13. 安全与隐私

- 步骤标题和 detail 不得包含 Token、Provider Key、Gateway Token、设备凭据或完整敏感命令；
- Dynamic Island 只接收最小展示快照；
- Tool Call 参数和终端输出默认不复制进步骤标题；
- 持久化前应限制长度并清理控制字符；
- 日志、测试快照和 Markdown 不记录真实凭据；
- 外部截图和竞品只能用于观察通用行为，不能作为源码或视觉资产输入。

## 14. 验收条件

### 14.1 行为

- 至少三个步骤的真实结构化计划可以在输入框正上方点击整块展开和折叠，并与输入框/发送按钮的中心列对齐；
- 当前步骤、总步骤和标题由同一计划推导；
- completed、running、waiting、failed、skipped 语义准确；
- 计划修订保留稳定 Step ID 和 revision；
- Task 删除后 fail closed，不跳到其他任务；
- Chat、AgentRun 和 Dynamic Island 对同一 Task 显示一致摘要。

### 14.2 边界

- 没有结构化事件时不自动生成伪进度；
- Tool Call 仍显示为执行细节，不冒充计划；
- 安装和 collaboration 不丢失原 authority；
- Dynamic Island 不暴露敏感 detail；
- 任务结束后不残留 running 步骤。

### 14.3 视觉与可访问性

- 使用 Aegis token 和 canonical status tone；
- 四套主题均可读；
- 窄窗口、长标题和三语言不溢出；
- 键盘和屏幕阅读器可操作；
- reduced-motion 下不依赖动画表达状态。

## 15. 验证计划

自动化至少包括：

- plan reducer 与 revision 单元测试；
- 重复、乱序和旧事件回归测试；
- 当前步骤和 `N/M` 推导测试；
- waiting、failed、skipped、cancelled 映射测试；
- Chat/AgentRun/Dynamic Island selector 一致性测试；
- 来源缺失 fail-closed 测试；
- i18n key 和可访问性契约测试；
- `pnpm lint`、`pnpm test`、`pnpm build` 和 `git diff --check`。

仍需真实 Tauri 验收：

- Agent 实际运行和计划修订；
- 主窗口最小化后的 Dynamic Island；
- 多显示器、置顶和 click-through；
- 完全退出后的持久化恢复；
- Claude、Codex、Pi 各 runtime 的真实结构化事件兼容性。

## 16. 结论

截图中的折叠步骤进度模式适合 JunQi，但它的价值不在视觉外壳，而在可信的任务阶段语义。推荐产品链路为：

```text
Agent/runtime 结构化计划事件
→ Agent Task authority 校验并保存 plan revision
→ Chat 显示完整可折叠计划
→ AgentRun 显示同一计划与操作入口
→ Dynamic Island 投影当前步骤摘要
→ 完成后保留为任务执行记录
```

只有在结构化事件和状态 authority 得到验证后，才应进入组件实现。否则即使外观与截图一致，也只是无法证明真实执行状态的伪进度条。
