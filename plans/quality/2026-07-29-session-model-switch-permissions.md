# 会话模型切换权限修复计划

日期：2026-07-29

## 依据

- 本机 OpenClaw `2026.7.1-2` 的 `method-scopes` 将 `sessions.patch.model` 与
  `sessions.patch.thinkingLevel` 映射为 `operator.admin`。
- Gateway 日志可复现 `sessions.patch: missing scope: operator.admin`。
- JunQi 日常连接按最小权限只申请 `operator.read/write`，已有临时管理连接负责显式提权。

## 实施

- [x] 抽出会话设置客户端，统一字段级权限路由与响应确认。
- [x] 模型与思考级别通过单次 `operator.admin` 连接修改。
- [x] 标签继续使用 `operator.write`，不扩大权限。
- [x] 最终失败保留原值并显示错误通知。
- [x] 将 `sessions.list` 模型投影统一为 `provider/model`，标记并禁用当前项。
- [x] 增加权限路由、串行执行和无效响应回归测试。
- [x] 完成静态检查、完整测试与生产构建。
- [x] 将模型与思考设置迁移到输入框底部，按供应商/模型分组并显式保存。
- [x] 保存期间保留已提交标签，避免清空选择值造成布局闪动。
- [x] 删除顶部重复入口，并在切换会话时丢弃未保存草稿。
- [x] 将 MessageInput 的队列、附件、补全、语音和发送事务按职责拆分。
- [x] 为安全可预览的 HTML/SVG artifact 增加会话消息预览动作。
- [x] 增加领域逻辑和组件契约回归测试。
- [ ] 在真实 `operator.admin` 配对环境完成模型切换交互验证。

## 边界

管理连接仍由官方 Gateway 配对流程批准；JunQi 不修改 OpenClaw 的设备授权文件，
不在日常长连接中常驻 `operator.admin`。
