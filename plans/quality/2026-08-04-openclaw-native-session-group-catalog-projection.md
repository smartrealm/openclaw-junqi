# OpenClaw 原生会话组目录投影计划

1. [x] 审阅 JunQi Stop、队列、Task checkpoint、session category、菜单和 Gateway adapter 全链路。
2. [x] 核对最新版 OpenClaw groups schema、handler、category registration 和权限 descriptor。
3. [x] 记录只读 catalog 投影的审计、规格、范围和不可用边界。
4. [x] 新增严格的 `sessions.groups.list` Gateway client，并在 facade 暴露只读方法。
5. [x] 在 chat store 增加非持久 catalog 状态和刷新 action；菜单只经 store 使用它。
6. [x] 补 client/store 行为回归，验证不支持、无效响应、原生顺序和 Jarvis 不额外写 catalog。
7. [x] 执行定向、完整 TypeScript、构建、官方链接、遗留引用、diff 与 Emoji 验证，并中文提交。

## 非目标

- 不重建此前已删除的本地 group catalog。
- 不实现 `sessions.groups.put`、rename 或 delete。
- 不将 Gateway method 广告当作能力门禁。
- 不修改 OpenClaw 的 session、transcript、queue、tool 或语音协议。
