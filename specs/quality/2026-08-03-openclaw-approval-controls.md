# OpenClaw 审批控制规格

## 验收条件

1. 普通 Gateway 连接继续只请求 `operator.read` 与 `operator.write`。
2. 审批列表和解析请求只通过声明 `operator.approvals` 的临时连接发送。
3. exec 与 plugin 记录分别按当前 OpenClaw 结构解析，未识别字段不得成为前端可执行输入。
4. 审批按钮只显示 Gateway 返回的 `allowedDecisions`，不补造或扩大决策集合。
5. 解析前有明确确认，只有收到 `{ ok: true }` 后才移除本地待审批记录。
6. 审批权限缺失、连接失败、协议字段异常和解析未确认都显示失败或不可用，不默认为拒绝、允许或空列表。
7. Chat transcript-only 的内联选择、Collaboration 审核和 OpenClaw exec/plugin approval 保持独立语义。
8. 简体中文、繁体中文和英文均有审批区域、决策、过期和失败文案。
9. 活动中心打开期间的审批事件连接只声明 `operator.approvals`，页面卸载后断开；连接失效
   时不扩大权限，列表重放仍可恢复待审批记录。

## 不在本轮范围

- JunQi 不调用 `exec.approval.request` 或 `plugin.approval.request` 创建第三方审批；请求方和
  Gateway 仍拥有审批生命周期。
- JunQi 不把 `systemRunPlan`、环境变量、命令原始参数或插件私有 payload 写入前端状态、日志、
  文档或持久化存储。
- 未取得真实 Gateway 事件样本前，不把审批事件强行关联到某个 Chat ResponseGroup。

## 验证边界

自动化只验证当前安装版静态契约、解析失败关闭、scope 隔离、页面级事件连接和 UI 调用链。
真实 Gateway scope、审批记录、事件广播、runId 关联和目标平台权限仍需人工验收。
