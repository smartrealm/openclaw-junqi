# OpenClaw 会话操作事件对齐规格

日期：2026-08-03

## 目标

在不重新实现 OpenClaw 生命周期的前提下，消费官方 `session.operation` 事件，让 JunQi 桌面会话能够展示正在进行的原生压缩操作及其真实终态。

## 约束

1. 字段、枚举和事件来源只以 OpenClaw 官方文档、schema、handler 和广播实现为准。
2. 项目安装版本只记录复现范围，不作为能力开关、字段契约或代码分支条件。
3. 解码失败时丢弃事件，不生成本地成功、失败、工具结果或恢复结论。
4. UI 投影属于本地派生状态，不写回 transcript，不改变 Task/Session 身份和 Stop 语义。
5. 审批事件需要显式授权，未取得 `operator.approvals` 或 `operator.admin` 时不得订阅或伪造审批状态。

## 验收条件

- 官方 `compact` start/end payload 能被严格解析。
- `completed` 缺失时 UI 不显示成功。
- 非法 operation、隔离会话和无效身份不会污染其他事件处理。
- 完全相同的官方 operation 重放只投影一次；同一 operation 的 start/end 仍分别投影。
- 主窗口与 Quick Chat 使用相同的本地事件语义和国际化文案。
- 文档记录真实 Gateway 与跨平台真机验收仍待完成。
