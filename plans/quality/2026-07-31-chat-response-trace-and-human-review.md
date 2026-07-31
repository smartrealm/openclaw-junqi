# Chat 响应追溯与人工审核实施计划

1. 扩展 SemanticBlock 基础契约，保留 `sourceSequence` 与 `toolCallId`。
2. 新增纯函数响应追溯投影，覆盖所有结构化节点和审核边界。
3. 将消息预览状态收敛为通用 Chat 侧边面板状态。
4. 提取共用侧边面板外壳，并实现响应追溯面板。
5. 在主 Chat 与 Quick Chat 的统一响应 Footer 增加追溯入口。
6. 主 Chat 提供 Collaboration 历史入口，Quick Chat 保持只读追溯。
7. 增加领域、UI、国际化和边界回归测试。
8. 运行相关测试、lint、完整测试、生产构建与 `git diff --check`。
