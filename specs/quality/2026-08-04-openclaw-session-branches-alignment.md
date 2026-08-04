# OpenClaw 原生会话分支对齐规格

## 范围

本规格约束 JunQi 对 OpenClaw 原生 transcript branch 的只读列表和已有分支切换。JunQi
仍是 OpenClaw 客户端，不拥有、合成或持久化 transcript DAG。

## 目标行为

1. 仅投影 `sessions.branches.list` 的官方 `SessionBranch` 字段；空、畸形或缺失必要字段的响应
   必须失败关闭。
2. 仅在用户打开会话上下文栏的分支控件时请求列表，并明确显示空列表、加载和错误状态。
3. 非活动分支必须经明确确认才调用 `sessions.branches.switch`，参数仅来自当前会话身份和 Gateway
   返回的 `leafEntryId`；调用必须使用一次性 `operator.admin` 授权通道，不能扩大为常驻权限。
4. 分支切换必须与同会话的发送和设置 mutation 串行；成功后重载该会话 history 与分支列表，且绝不
   自动重发草稿、失败消息或附件。
5. 本次范围不接入 `sessions.rewind`、`sessions.fork` 或分支恢复；后续若扩展，必须另行核对官方
   entryId、编辑器恢复和权限契约，不能伪造 UI 或调用。

## 验收条件

- 严格 parser 和 RPC 参数在行为测试中通过。
- 切换调用使用会话级串行 mutation。
- UI 仅渲染 Gateway 返回的分支，并且切换成功后通过既有 history loader 获取新的官方投影。
- TypeScript、相关测试、边界检查和文档验证通过。

## 非目标

- 不在 JunQi 创建 transcript 分支。
- 不绕过 Gateway 对活动 Run、外部会话或权限的拒绝。
- 不以 OpenClaw 版本、方法发现结果或本机环境作为能力承诺。
