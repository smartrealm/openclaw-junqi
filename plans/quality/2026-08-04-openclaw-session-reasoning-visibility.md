# OpenClaw 会话推理可见性对齐计划

## 完成步骤

1. 阅读最新官方推理指令与 Gateway 协议文档，并用当前安装的官方类型和会话行投影复现字段边界。
2. 审查 JunQi 发送前置逻辑、会话设置客户端、会话列表投影、本地 Zustand 状态和顶部会话控制。
3. 删除发送时自动 `reasoningLevel: "on"` 的隐式写入和吞错逻辑。
4. 建立严格的四状态映射，复用 `SessionSettingsClient` 的 `operator.admin` 串行 mutation 路径。
5. 以 Gateway 返回的 `entry.reasoningLevel` 回写目标会话，补齐摘要、控件、本地化和受限高度滚动。
6. 添加协议映射、持久化权限、状态回写与本地化回归，执行全量验证和中文提交。

## 非目标

- 不改变 OpenClaw 推理内容、模型思考等级、`chat.send` 参数或通道对流式预览的能力。
- 不为不支持推理预览的模型或通道伪造 `stream` 结果。
- 不加入私有推理存储、浏览器权限或跨平台 fallback。
