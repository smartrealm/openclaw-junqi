# Agent Office 只读协作投影规格

日期：2026-08-03

## 问题

现有协作详情只能按 WorkItem 图谱或列表观察运行，缺少按 Agent 聚合的空间化状态投影。直接嵌入第三方状态服务会产生第二权威源、身份漂移和恢复一致性风险。

## 目标

在现有协作详情中增加 Office 视图，直接从 `CollaborationRunSnapshot` 和同一协作实例的 Agent capability metadata 派生只读 Agent 工位状态。

## 强制约束

1. Collaboration Plugin 的 Run、WorkItem、Attempt 和 Intervention 快照保持唯一权威。
2. Office 不新增 Gateway 写命令，不修改 WorkItem 分派，不保存独立运行状态。
3. 只展示具有 Run 级 Planner/Synthesizer Attempt、WorkItem 分派或其他 Attempt 证据的当前 Run 参与 Agent；仅在 capabilities 中配置为协调 Agent 不构成参与证据。
4. 不把 configured、allowed 或 participant 解释为在线状态。
5. 不从 Agent 名称、WorkItem 标题、自然语言或执行时长推断研究、编码、写作或百分比进度。
6. `UNKNOWN` 和未解决 Intervention 必须显式可见并优先进入介入区域。
7. 缺少 capability metadata 时显示 Agent ID，不能伪造名称、运行时或头像。
8. 不复制 Star Office UI 的受限美术资源、Flask 服务、状态文件或轮询协议。
9. 保留 Graph 和 List 既有契约。
10. 使用 Aegis 语义 token，并覆盖键盘、窄窗口、空状态和错误边界。

## 验收条件

- 协作详情提供 Graph、List 和 Office 三种视图。
- Office 与 Graph/List 消费同一 `snapshot` 参数。
- 投影纯函数对参与 Agent、区域、工位、WorkItem、Attempt 和 Intervention 产生确定性结果。
- 未参与当前 Run 的 configured Agent 不出现在 Office。
- `UNKNOWN` Attempt 显示为“状态未确认”，不显示在线或失败结论。
- Office 空数据时显示明确空状态。
- Office 入口和 Agent 工位具有可访问名称，状态不只依赖颜色。
- 三种语言具备 Office 关键文案。
- 定向测试、完整前端测试、lint、build 和 `git diff --check` 通过。
- 未执行真实 Tauri 视觉验收时，文档和最终说明明确标记为未验证。
