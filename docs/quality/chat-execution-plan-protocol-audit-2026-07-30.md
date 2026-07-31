# Chat 执行计划协议审计

日期：2026-07-30

## 结论

当前锁定的 OpenClaw `2026.7.1` 内置 `update_plan` 工具。它接收有序步骤快照，步骤状态限定为 `pending`、`in_progress` 和 `completed`，并校验同一快照最多存在一个 `in_progress` 步骤。

该工具并非对所有模型默认开放。OpenClaw 会对其 strict-agentic 支持范围自动启用；其他模型需要用户通过 `tools.experimental.planTool` 显式选择。JunQi 必须呈现自动、始终启用和关闭三种模式，不能根据供应商名称自行改写配置。

JunQi 已接收 OpenClaw Gateway 的结构化工具流。工具事件包含 `sessionKey`、`runId`、`seq`、`toolCallId`、工具名称、参数和 `start/update/result` 阶段。因此 Chat 可以从 `update_plan` 的参数建立可信计划投影，不需要解析自然语言、Thinking 或普通工具调用。

## 协议依据

- 安装版本：`pnpm-lock.yaml` 锁定 `openclaw@2026.7.1`。
- 工具实现：安装包 `dist/openclaw-tools-*.js` 中的 `createUpdatePlanTool`。
- 输入字段：可选 `explanation` 与非空 `plan` 数组。
- 步骤字段：`step` 和 `status`。
- Gateway 工具流：`src/services/gateway/ChatHandler.ts` 已验证并处理 `sessionKey`、`runId`、`seq`、`toolCallId`、`data.args` 与阶段。
- 启用条件：安装包的 `isUpdatePlanToolEnabledForOpenClawTools` 与 schema 描述共同定义 `tools.experimental.planTool`。
- 历史恢复：Gateway transcript 已由 `normalizeHistoryMessage` 保留工具名称、参数、结果、调用 ID 和原始结构化内容。

## 当前缺口

1. `update_plan` 提供快照，不提供 `planId`、revision 或稳定 Step ID。
2. 当前 Chat 把 `update_plan` 当作普通 Tool Call，用户只能看到实现细节。
3. 历史与实时消息可能采用不同工具表示，需要统一适配。
4. OpenClaw 当前状态集合不包含 waiting、failed 和 skipped，JunQi 不能自行推断这些状态。

## 适配边界

- 计划 ID 由已验证的 `sessionKey + runId` 生成；历史缺少 runId 时退回来源消息 ID。
- revision 是同一响应组中去重后的 `update_plan` 快照顺序，不冒充上游原生 revision。
- Step ID 由规范化步骤标题和同名出现次数稳定生成。标题改变表示步骤身份改变，不做模糊匹配。
- `seq` 只用于拒绝同一实时工具流中的旧事件；历史回放保持 transcript 原始顺序。
- 仅适配工具名精确为 `update_plan` 且通过字段验证的参数。
- 无效快照继续作为普通 Tool Call 展示，不能产生部分计划。
- Thinking、回复文本和普通 Tool Call 不参与计划推导。
- 三态设置通过 Gateway `config.get` 和带 `baseHash` 的 `config.patch` 保存；自动模式只删除 `planTool` 覆盖并保留其他 experimental 字段。
- JunQi 不静默启用实验工具，OpenClaw 负责配置变更后的热加载或重启。

## 2026-07-30 Chat 布局修正

- 复核发现首版 `ExecutionPlanCard` 作为 `RenderBlock` 直接进入 Virtuoso 消息时间线，并使用 `ml-[46px]` 对齐 assistant avatar/message 列，位置与目标交互不符。
- 最新未完成计划现从 response groups 派生为会话级投影，固定显示在输入框正上方；计划面板与输入 surface 共用水平居中的 `760px` 最大宽度，发送按钮位于同一列右端。
- 未完成计划不再在消息流中重复渲染；最新计划完成后，输入框上方面板撤下，完成计划仍在原消息时间线位置以折叠记录保留。
- 展开/折叠继续使用整块真实 `button`、`aria-expanded` 和 `aria-controls`，不改变 OpenClaw `update_plan` authority 或三态状态契约。
- 消息发送队列同步收敛到 composer 上方同一中心列：正常排队使用中性 surface，折叠态显示数量与首条摘要，展开后继续提供编辑、删除和失败重试；垂直顺序为快捷回复、执行计划、发送队列、输入框。
- 2026-07-31 截图复核发现窄窗口中的 assistant 正文显得过于粗大。Chat assistant Markdown 保留既有正文、强调、表头和标题字重及颜色层级，只用 `clamp()` 让正文字号随视口宽度在 13px 到 15px 之间平滑变化；用户消息和文件 Markdown 预览不受影响。
- 本地 `/Applications/ChatGPT.app` 已确认版本 `26.721.81911`、bundle ID `com.openai.codex`；观察时主进程没有可访问窗口（仅残留 helper/kernel，AX `windows=0`），因此本记录不声称完成其队列像素或可访问性树核对。

## 未验证边界

- OpenClaw 未来版本可能扩展状态或字段，升级时必须重新核对安装版本源码。
- 当前未进行真实 Gateway 长任务与应用重启后的人工验收。
- Claude、Codex 和 Pi 的独立 AgentRun 协议不在本次 Chat 接入范围内。

## 验证结果

- `pnpm lint`：通过，模块边界检查覆盖 645 个文件，TypeScript 检查通过。
- `pnpm test`：通过，前端测试 1960 项、脚本测试 224 项，共 2184 项。
- `pnpm build`：通过，协作插件契约与生产构建通过；计划卡片生成独立延迟加载 chunk。
- `git diff --check`：通过。
- 未执行 `pnpm tauri build`，本次没有将 Web 生产构建描述为桌面安装包。
- 未执行真实 Tauri 窗口下的 Gateway 长任务、配置热加载、应用重启和跨主题人工验收。
