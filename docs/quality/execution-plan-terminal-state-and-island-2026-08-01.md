# 执行计划终态修复与灵动岛接入

日期：2026-08-01
基线：`daxia@f1562d0`
协议依据：本机安装的 `OpenClaw 2026.7.1-2 (0790d9f)`

## 协议依据

`update_plan` 是 Codex 原生工具，OpenClaw 在 `docs/plugins/codex-harness.md:573` 把它与 `read`/`write`/`apply_patch`/`exec` 并列为 Codex-native workspace operations，并通过 `tools.experimental.planTool` 对非 strict-agentic 模型开放（`docs/concepts/experimental-features.md:24`）。

关键契约：**`update_plan` 只报告每一步的 `pending` / `in_progress` / `completed`，不报告整个计划是否还在推进**。这是本次修复的根因。

## 当前行为与问题

### BUG-PLAN-01 · 中断的计划永久钉在输入框上方

`src/components/Chat/executionPlanPlacement.ts` 原判定只看计划自身状态：

```ts
return block.plan.state === 'completed' ? null : block.plan;
```

一次运行在第 2 步被中断或报错时，最后一份快照仍带 `in_progress` 步骤，`planState()` 因此算出 `running`。后果：

- 输入框上方持续显示「第 2/5 步 · 当前步标题」，表现得像仍在执行；
- 计划卡只有折叠、没有关闭，用户无法移除；
- 时间线同时不显示它（原逻辑 `block.plan.state !== 'completed'` 直接返回 `null`），因此该计划在两个位置的呈现都是错的：该撤下的没撤下，该留档的没留档；
- 只有下一次 `update_plan` 出现才会被顶掉。

`ResponseGroup.status` 已有 `streaming | final | error | aborted` 四态，且与计划块同属一个对象，但未被使用。

原有三个 placement 测试覆盖「选最新未完成」「完成留时间线」「无计划块」，均未覆盖中断场景。

### BUG-PLAN-02 · 完成态折叠行信息重复

完成时头部渲染 `第 5/5 步`，副标题渲染 `5/5 已完成`，同一信息出现两次，且都在回答「进度」——而完成之后用户关心的是「做了什么」。

### BUG-PLAN-03 · 计划卡没有通往执行追溯的入口

追溯面板是唯一保存全部 `update_plan` 快照序列（`计划快照 1..N`）的位置，而计划卡在 `revision > 1` 时明确显示「修订 N」徽章，却不提供查看这些修订的路径。

## 目标行为

引入 `ExecutionPlanOutcome`，由计划状态与响应组终态共同判定，作为放置与呈现的单一事实源：

| 条件 | outcome | 输入框上方 | 时间线 | 折叠行 |
| --- | --- | --- | --- | --- |
| `plan.state === 'completed'` | `completed` | 撤下 | 折叠留档 | `N 步已完成` + 收尾步骤标题 |
| 响应组 `error` 或 `aborted` 且计划未完成 | `interrupted` | 撤下 | 折叠留档 | `已完成 M/N 步` + 中断徽章 + 停在的步骤 |
| 其余 | `running` | 置顶显示 | 不显示 | `第 M/N 步` + 当前步骤 |

`ExecutionPlanCard` 的 `outcome` 为**必填**属性：`plan.state` 无法区分运行中与中途死亡，任何一侧的默认值都会误标另一侧。

## 灵动岛接入

`DynamicIslandSnapshot` 新增 `executionPlan: DynamicIslandExecutionPlan | null`，只携带 `currentStep`、`totalSteps`、`stepTitle` 三个字段。

- 不携带 `explanation`、工具参数或任何其他 transcript 内容。灵动岛是独立辅助窗口，遵循既有的最小投影原则（与 `DynamicIslandVoiceInput` 的注释约定一致）。
- `shouldPeekForSnapshot` 只在**步序前进**时触发一次展开。步数变化不触发，否则被反复修订的计划会在每次 revision 重新弹出。

## 未实现范围

AgentRun 与萌宠仍未接入执行计划，与 `docs/design/agent-execution-plan-progress-design.md` 的状态一致。

萌宠本轮评估后决定不接：`PetState.progress` 已被会话 token 占用比与安装进度占用（`usePetStateEmitter.ts:268`、`:410`），叠加计划进度会产生两套互相覆盖的语义。萌宠是情绪驱动的角色表达，不是状态面板，接入需要先定义 progress 通道的优先级契约，属于独立设计问题。

## 验证结果

在 `f1562d0` 基线上实际执行：

- `pnpm exec tsc --noEmit`：通过，退出码 0
- `node scripts/check-boundaries.mjs`：通过，覆盖 682 个文件
- 前端测试：2076 项通过，0 失败（本轮由 2064 增至 2076）
- 脚本测试：225 项通过，0 失败
- 三份 locale JSON 解析通过
- 本次修改文件 Emoji 扫描通过，`git diff --check` 通过

新增回归测试：

- `executionPlanPlacement.test.ts`：中断与失败两种终态各验证「不再置顶」与「判定为 interrupted」；另验证 streaming 仍置顶、已完成计划在运行报错时仍判定为 completed
- `ExecutionPlanCard.test.tsx`：完成态以收尾步骤而非重复计数收尾；中断态带徽章并保留停在的步骤；追溯入口为兄弟控件而非嵌套在折叠按钮内
- `executionPlanLayout.test.ts`：原断言直接匹配源码字面量 `block.plan.state !== 'completed'`，随实现改写即失效。已改为断言路由契约本身，并显式断言该字面量不再出现
- `model.test.ts`：步序前进触发一次 peek，仅步数变化不触发；灵动岛计划投影字段集合固定为三个

## 未验证边界

- 未连接真实 Gateway 触发真实的 `update_plan` 中断场景，中断路径为构造 `ResponseGroup.status` 的单元验证
- 未在真实 Tauri 窗口中人工验收灵动岛的计划行渲染、展开时机与窄窗口截断表现
- 未执行 `pnpm build` 与 `pnpm tauri build`
- 未验证 OpenClaw 未来版本扩展计划状态集合后的兼容性；升级时需重新核对安装版本的工具定义
