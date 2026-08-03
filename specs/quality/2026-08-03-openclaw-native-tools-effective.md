# OpenClaw 原生有效工具目录对齐规格

日期：2026-08-03

## 目标

Tools 页面在不改变 OpenClaw 权限和工具生命周期的前提下，展示指定 Session 当前由
Gateway 计算出的有效工具目录。

## 约束

1. 请求只能使用官方 `tools.effective`，权限为 `operator.read`；`sessionKey` 必须来自
   Gateway 的真实 `sessions.list`，不能由 JunQi 猜测或拼接默认值。
2. 可选 `agentId` 只作为官方请求字段透传；Session 上下文、渠道、插件、profile、
   MCP 状态和策略由 Gateway handler 决定。
3. 响应必须满足官方 `agentId`、`profile`、groups、工具条目和 notices 结构；缺失、
   类型错误、未知枚举、重复或错误的拒绝标记都不得进入 UI 状态。
4. 缓存必须绑定 Gateway 连接和 Session key。新的请求代次、断线、Session 删除或
   Gateway 返回未知方法时，旧快照不能继续冒充当前结果。
5. 配置 schema 与有效工具是两个不同数据面：配置字段可编辑，有效工具只读；不得用
   任一数据面推断另一数据面。
6. 未连接真实 Gateway 或目标平台时，验收记录必须明确标注未验证，不能把 TypeScript、
   lint 或构建通过描述为跨平台现场验证。

## 验收条件

- 能力广告为真且 Gateway 返回合法结果时，用户可选择真实 Session 并看到 agent、
  profile、来源分组、工具 ID/标签、Gateway notices 和 `deniedBySession`。
- Gateway 返回未知方法、响应非法、连接失败或 Session 被删除时，不显示
  旧快照，并呈现明确的不可用/失败状态。
- 多次刷新和连接切换不会让迟到响应写入当前 Session；Session 删除会清除快照和加载态。
- 自动化验证记录实际执行的测试；真实 Gateway 以及 macOS、Windows、CentOS、Ubuntu
  现场验证单独记录。
