# 全局专注上下文与任务简报规格

日期：2026-07-30

## 问题

1. Dynamic Island 会展示活动，但用户没有一个独立于“当前路由/当前选中行/当前运行进程”的全局专注对象。
2. `/ai-workspace` 已是 Worktree-centric；旧 Agent Task 的 `selectedTaskId` 不能代表全局专注。
3. Agent 新任务只有自由 Prompt，无法结构化整理目标、背景、约束、验收和上下文后再下发。
4. 直接把新 UI 塞进 Dynamic Island 或复制第三方项目会形成局部补丁、重复 authority 和许可证风险。

## 目标行为

### FC-01 独立 Focus identity

系统必须支持 `agent-task | chat-session | worktree | task-brief` 四种专注 target。Focus Store 只持有 identity、导航和展示快照；状态由原业务 Store 投影。

### FC-02 全局可见与可返回

TopBar 和 Dynamic Island 必须消费同一 Focus projection。点击 Focus 必须返回 allowlist 路由和稳定对象；对象不存在时显示 unavailable，不自动选择其他对象。

### FC-03 正确显示条件

Dynamic Island 继续优先显示资源拖放、等待处理、失败、运行会话和语音状态。主窗口最小化且存在 Focus 时可保持可见，但静态 Focus 不得使用 running spinner 或“Agent 正在运行”文案。

### TB-01 Brief 持久化

用户可创建、重命名、删除、归档 Task Brief。每个 Brief 包含 project path、有序卡片、引用、状态和 handoff identity，并在重启后恢复。

### TB-02 结构化卡片

支持 goal/background/constraint/acceptance/note。用户可增删、编辑并改变顺序；空卡片不进入编译结果。

### TB-03 确定性检查

检查器必须至少阻止缺少项目路径、目标或验收条件的 handoff，并对模糊表达给出非阻断 warning。检查是纯函数且不调用外部模型。

### TB-04 稳定编译

相同 Brief 必须生成相同 Markdown Prompt，顺序遵循卡片 reading order，引用只输出用户显式保存的 metadata，不自动读取文件或 URL 内容。

### TB-05 进入现有执行链

合法 Brief 可创建真实 `AgentWorkspaceTask`，保留 agent/permission/plan/launch 配置，记录 `sourceBriefId`，将 Brief 标为 launched，把新 Task 设为 Focus，并进入现有 AgentRun。

### TB-06 AgentRun 深链恢复

`/agent-run?taskId=<id>` 必须从 Task Store 恢复对应任务；不存在的 id 必须显示明确错误或新任务态，不能执行空 Prompt，也不能自动替换成其他任务。

### TB-07 生命周期与幂等性

Brief 内容、执行配置、卡片顺序或引用发生变化时，必须使旧 handoff identity 失效并重新计算 `draft | ready`。归档 Brief 只读且不能 handoff；恢复时按内容重新计算状态。相同 Brief 的重复 handoff 必须复用已有 `sourceBriefId` 任务，不能重复创建任务。

### TB-08 多语言 Prompt

Prompt 结构由纯编译器稳定生成，标题与章节标签由当前语言目录显式传入。编译器不得固定中文或英文展示语言，引用仍只输出用户明确保存的 metadata。

### NAV-01 产品入口

`/briefs` 必须通过 JunQi 现有 App Shell、FeatureRoute 和产品导航进入，不能成为隐藏 showcase route。

### SEC-01 Secret 边界

Focus 不保存正文或 secret。Brief 只保存用户显式输入内容和引用 metadata；本轮不抓取外部服务、不自动内联文件、不新增凭据存储。

### LIC-01 独立实现

实现不得复制 BonsAI/FocuSD 的源码、CSS、Prompt、图标、脚本、协议或视觉资产；不新增第三方代码声明需求。

## 非目标

- 自由坐标无限画布、边和自动布局；
- 云端语义 lint；
- GitHub/Linear/Notion/Figma/Sentry Connector；
- 剪贴板历史和媒体控制；
- 新 Agent Runtime、PTY 或 Worktree lifecycle；
- collaboration Workflow Template/Run 语义变化。

## 验收条件

1. Focus reducer/projection 测试覆盖四类 target、对象删除、状态变化和导航。
2. Brief Store 测试覆盖创建、更新、删除、重排、launched handoff 和 persistence migration。
3. Brief checker 测试覆盖阻断 error、模糊 warning 和合法 Brief。
4. Prompt compiler golden test 覆盖卡片顺序、空卡过滤、引用 metadata 和稳定输出。
5. handoff 集成测试证明只创建一个 Task、关联 sourceBriefId、更新 Focus 并生成 task-id route。
6. Dynamic Island model 测试覆盖静态 Focus 可见、activity 优先级、unavailable 和 auto-peek 不被普通文本编辑触发。
7. 三套 locale 均包含导航、Focus、Brief 和 Dynamic Island 新文案。
8. `pnpm lint`、定向测试、`pnpm test`、`pnpm build`、`git diff --check` 通过。
9. Tauri 真实窗口检查：TopBar Focus、Brief handoff、主窗口最小化后的 Dynamic Island 和点击返回。未执行时必须明确标为未验证。
10. Brief 归档恢复、编辑后 handoff 失效、重复 handoff 去重和三语言 Prompt 标签均有回归测试。
