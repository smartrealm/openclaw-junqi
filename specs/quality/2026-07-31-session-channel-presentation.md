# 会话渠道来源呈现规格

## 问题

外部 IM 发起的会话与桌面 Agent 会话在侧栏中都使用 Agent 图标，用户不能在会话列表中识别渠道来源。

## 约束

- 只使用当前 Gateway `sessions.list` 已返回的 `channel`、`lastChannel`、`origin.provider` 和 `origin.surface`。
- 不从 session key、标题、消息、Agent、渠道配置、本机路径或当前环境猜测渠道。
- 未知渠道不映射为已知 IM；其图标必须为通用渠道图标。
- 不将渠道来源字段描述为实时 reply route 或渠道绑定状态。
- 简体中文、繁体中文和英文均提供辅助文案。

## 验收条件

1. 有结构化渠道来源的会话行主图标显示通用渠道图标，不显示 Agent 机器人图标。
2. 有渠道来源的会话第二行同时展示渠道标识和已解析的 Agent 名称。
3. 缺少所有结构化渠道来源时保留 Agent 图标与名称。
4. 渠道字段的优先级为 `channel`、`lastChannel`、`origin.provider`、`origin.surface`。
5. 未知渠道、空渠道值和仅含 `origin.label` 的会话均不能伪造成已知 IM。
6. 投影逻辑有行为测试，TypeScript 类型检查通过。
