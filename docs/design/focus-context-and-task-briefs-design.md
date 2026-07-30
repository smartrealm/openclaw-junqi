# 全局专注上下文与任务简报工作台设计

日期：2026-07-30

## 1. 背景

JunQi 已经拥有真实的 OpenClaw 会话、Agent Task、Worktree、终端、文件和 Dynamic Island，但缺少两个产品层能力：

1. 用户无法明确指定“我现在最关注哪一项工作”；当前选中行、当前路由和正在运行的进程被混为一谈。
2. 新任务只能从一段 Prompt 开始，缺少在执行前整理目标、背景、约束、验收条件和上下文引用的工作区。

本设计参考桌面专注岛和任务准备画布的公开产品范式，但使用 JunQi 自有领域模型、Aegis 设计系统和现有 OpenClaw/Workbench authority 独立实现，不复制 BonsAI 或 FocuSD 的源码、文案、视觉资产与内部协议。

## 2. 产品链路

```text
任务简报（准备）
  → 完整性检查
  → 编译为执行 Prompt
  → 创建 Agent Task
  → AgentRun / Worktree 执行
  → 全局 Focus Context 跟踪
  → Dynamic Island 展示状态并返回来源
```

## 3. 领域边界

### 3.1 Focus Context

Focus Context 是用户明确选择的全局关注对象，不是新的任务状态 authority。

支持四类 target：

- `agent-task`：引用 `AgentWorkspaceTask.id`；
- `chat-session`：引用 OpenClaw session key；
- `worktree`：引用 Workbench worktree id；
- `task-brief`：引用 Task Brief id。

持久化内容只包括：

- target kind 和稳定 id；
- 设置专注时的标题、说明和导航目标快照；
- `focusedAt`；
- 可选 source identity，例如 project path、agent 或 branch。

运行状态、失败原因、Agent 名称、Worktree lifecycle 和会话 activity 不复制进 Focus Store。消费者必须按 target identity 从原 Store 投影实时状态；原对象不存在时显示 unavailable，并允许用户清除，不能猜测替代对象。

### 3.2 Task Brief

Task Brief 是任务准备资产，不是 Workflow Run，也不直接拥有 Agent 进程。

一个 Brief 包含：

- 标题；
- 项目路径；
- 有序卡片；
- 上下文引用；
- 生命周期 `draft | ready | launched | archived`；
- 最近一次生成的 Agent Task id。

首轮卡片类型：

- `goal`：要实现的结果；
- `background`：现状、原因和相关事实；
- `constraint`：不可破坏的行为和边界；
- `acceptance`：可验证完成条件；
- `note`：补充说明。

上下文引用首轮支持显式记录：

- 本地文件或目录；
- Chat Session；
- Agent Task；
- Worktree；
- URL。

引用只保存 identity/路径与展示标签。首轮编译不会擅自读取文件内容或抓取 URL，从而避免把 secret 和大文件静默写进 Prompt。

## 4. 完整性检查

首轮使用确定性本地规则，不发起模型调用：

- 至少一张非空 `goal`；
- 至少一张非空 `acceptance`；
- 项目路径非空；
- 不允许空卡片进入编译结果；
- 检测常见模糊代词和无量化“优化/完善/处理一下”等表达并给出 warning；
- 至少一个约束或上下文引用作为建议项，但不阻断 handoff。

规则结果分为 `error | warning | suggestion`。只有 error 阻止创建 Agent Task。

后续模型语义检查必须显式由用户触发，使用当前选定 Provider，并展示将发送的内容；不可在输入过程中静默调用云模型。

## 5. Prompt 编译契约

编译器是纯函数，按卡片阅读顺序生成稳定 Markdown：

```markdown
# 任务：<标题>

## 项目
<project path>

## 目标
...

## 背景
...

## 约束
...

## 验收条件
- [ ] ...

## 上下文引用
- [file] label — path
```

编译结果进入现有 `AgentWorkspaceTask.prompt`。创建任务时：

- 状态为 `todo`；
- 保留用户选择的 agent、permission、plan mode 和 launch mode；
- 记录 `sourceBriefId`，用于从执行页返回来源；
- Brief 更新为 `launched` 并记录 task id；
- Focus Context 切换到新 Agent Task；
- 跳转现有 `/agent-run?taskId=...`。

`AgentRunRoute` 必须按 task id 从 Task Store 恢复配置，不能通过超长 URL 传 Prompt。

## 6. 全局交互

### 6.1 TopBar

TopBar 提供全局 Focus 控件：

- 有 Focus 时显示标题和状态；
- 当前页面有可聚焦上下文时允许“专注当前项”；
- 点击已有 Focus 返回对应页面；
- 可清除 Focus。

### 6.2 Dynamic Island

Dynamic Island snapshot 增加 Focus projection：

- 主窗口最小化且存在 Focus 时允许显示；
- active/attention/error 状态优先于静态 Focus；
- 没有运行活动时显示 Focus 标题，而不是假装 Agent 正在运行；
- 点击 Focus 使用 allowlist route 返回主窗口；
- 原对象已删除时显示 unavailable，不静默跳到其他任务。

### 6.3 Task Briefs

新增 `/briefs`：

- Brief 列表与创建；
- 卡片新增、编辑、删除和上下移动；
- 上下文引用编辑；
- 完整性检查；
- Prompt 预览；
- 创建 Agent Task；
- 将当前 Brief 设为 Focus。

首轮不使用自由拖拽无限画布。原因是当前仓库没有图编辑依赖，且在卡片 identity、持久化、键盘可访问性和执行 handoff 未稳定前增加自由坐标只会制造第二套复杂状态。后续画布仍复用相同 Brief/Card identity 和编译器。

## 7. 持久化与安全

- Focus Context：Zustand persist，键 `junqi:focus-context:v1`；不保存 secret 或正文。
- Task Brief：Zustand persist，键 `junqi:task-briefs:v1`；保存用户显式输入的卡片文本和引用 metadata。
- 不自动读取引用文件内容；不把 Provider key、Gateway token 或系统凭据写入 Store。
- 任务 handoff 继续走已有 Agent Task persistence 和运行命令。
- 本轮不新增 Tauri command，不改变 OpenClaw、PTY、Worktree 或 collaboration wire contract。

## 8. 后续阶段

### Phase B：上下文解析器

按 authority 增加 file/session/task/worktree resolver，在编译前展示内容预算和 secret 风险；用户确认后才内联摘要。

### Phase C：语义检查

显式调用当前模型，返回结构化 finding；模型不可用时保留本地规则结果，不降级为虚构成功。

### Phase D：图画布

为卡片增加坐标、边和 reading order projection；列表与画布是同一 Brief 的两种视图，不建立第二套存储。

### Phase E：Spec/Plan 输出

从 Brief 生成仓库内 spec/plan 草稿时必须先展示目标文件和 diff，并沿用 Workspace Files authority，不允许页面直接任意写文件。

## 9. 许可边界

- 不复制 BonsAI 的 FSL 受限源码、Swift 类型、Prompt、Connector 实现、MCP tool 命名和视觉资产。
- 不复制无许可证 FocuSD 的 React/Rust/CSS、Hook 安装脚本或 marker 协议。
- JunQi 实现只依据通用产品需求和本仓库现有 architecture。

