# 会话模型切换闪动审计

日期：2026-07-30

## 依据

- 项目实际安装的 OpenClaw：`2026.7.1-2 (0790d9f)`。
- 安装包 `sessions.patch` 实现会先返回已解析模型，再发送
  `sessions.changed`，其中模型修改的 `reason` 为 `patch`。
- JunQi 的 Gateway 事件层已把 `sessions.changed` 转换为统一的
  `aegis:sessions-changed` 失效通知。

## 根因

模型保存成功后，JunQi 先同步更新本地会话，又额外发送
`aegis:model-changed` 触发一次完整 `sessions.list`。随后 OpenClaw 按契约发送
`sessions.changed`，再次触发权威会话刷新。

同时，`chatStore.setSessions` 在刷新时为每个会话创建新对象，即使所有可见字段完全相同。
订阅当前会话对象的聊天协作层因此被通知并重绘整棵会话视图，形成明显闪动。

## 修复

- 删除仅供模型切换使用的 `aegis:model-changed` 事件、监听与清理代码。
- 保留 OpenClaw `sessions.changed` 作为唯一权威失效契约。
- `chatStore.setSessions` 对完整会话投影做等价比较；字段与 `origin` 内容均未变化时
  复用已有对象引用。
- 身份、模型、思考级别、token、来源和运行状态等任一字段变化时仍生成新投影。

该实现不枚举模型或供应商，不根据模型名称猜测上下文窗口。

## 验证

- 回归测试确认模型设置代码和 App 不再包含 `aegis:model-changed`。
- 行为测试确认等价 `sessions.list` 刷新保留会话对象引用。
- 定向测试、TypeScript 静态检查和 `git diff --check` 已通过。
- 完整 `pnpm lint`、`pnpm test`、`pnpm build` 与 `git diff --check` 均通过；
  生产构建完成 8962 个模块转换，未触发分包预算或循环依赖失败。
- 尚未在真实 Gateway 配对环境进行交互帧录制；该边界保持待验证。
