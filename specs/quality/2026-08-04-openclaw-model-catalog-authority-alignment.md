# OpenClaw 模型目录权威性规格

## 问题

JunQi 把 OpenClaw `models.list` 的空结果继续补为配置、静态目录和会话历史模型。模型选择器
因此可能呈现没有运行时可用性证据的模型。

## 约束

- JunQi 只作为 OpenClaw 客户端，不建立本地模型可用性目录。
- `models.list { view: "configured" }` 是当前会话模型选择器的唯一运行时权威来源。
- 仅有 `available: true` 的结构正确条目可被投影为可选模型。
- 调用失败、空结果和无效结果必须失败关闭为无可选模型，不能用配置、历史 session 或静态
  catalog 填充。
- Provider 配置编辑和健康提示可以读取其已有权威来源，但不得写回 `availableModels`。

## 验收条件

- [x] 运行时模型加载只发送 `models.list` 的 `configured` 视图。
- [x] 权威响应为空、结构无效或只含不可用条目时，后续 loader 不得运行且结果为空。
- [x] 明确可用的 Gateway 模型保留 provider、label、alias 和图像能力投影。
- [x] 删除仅为旧回退链存在的配置、静态目录和 agent/session 模型加载代码及其测试。
- [x] TypeScript、相关回归、全量测试、构建和差异检查通过。
