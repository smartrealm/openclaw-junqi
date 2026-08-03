# OpenClaw 原生技能提案清单对齐规格

日期：2026-08-03

## 问题

JunQi 缺少 OpenClaw Skill Workshop 已保存提案的原生只读入口，且不能将本地技能目录或当前
会话猜测为提案 workspace scope。

## 目标

在技能页忠实显示 Gateway 默认 scope 的 `skills.proposals.list` manifest，同时维持
OpenClaw 的 agent scope、权限和管理员写入边界。

## 契约与约束

1. 只调用 `skills.proposals.list`，不调用 inspect、history、events 或任一 proposal 写方法。
2. 只接受固定 schema、非空 `updatedAt` 和完整条目；字段缺失、未知 kind/status/scan state 或
   畸形条目时拒绝整个回包，不补默认值。
3. Gateway 明确未广告该方法时不得发送请求；广告未知时允许实际 RPC 并显示真实错误，不能由
   版本号、平台或本机状态推断支持性。
4. 因页面尚无已核对的 agent scope 选择，调用必须省略 `agentId`，并且 UI 不得称结果属于当前
   会话、当前 agent 或本地 `/skill-hub`。
5. 页面只呈现原生清单字段和加载、空、失败状态；不得伪造详情、草稿、scanner 结论、revision
   hash、执行结果或 lifecycle 动作。
6. 不读取或写入本机技能路径、proposal 文件、Gateway 配置或系统凭据。

## 验收条件

1. 已广告 Gateway 返回完整 manifest 时，技能页显示每个原生提案的标题、描述、skillKey、更新
   时间与 lifecycle status。
2. 任何不完整或未知枚举值的 manifest 都显示协议错误，不显示部分条目。
3. 显式未广告时不产生 `skills.proposals.list` 请求且不显示该页签。
4. 服务测试覆盖完整解码、异常枚举、默认 scope 参数和未广告边界。
5. TypeScript、相关测试、locale JSON、文档链接、diff 与 Emoji 扫描通过；真实 Gateway 和各
   平台打包应用验证结果单独记录，不能由本机构建替代。
