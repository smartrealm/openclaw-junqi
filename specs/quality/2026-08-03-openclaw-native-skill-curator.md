# OpenClaw 原生技能生命周期对齐规格

日期：2026-08-03

## 问题

JunQi 已安装技能页缺少 OpenClaw 对 Skill Workshop 管理的技能生命周期状态，用户无法区分
Gateway 已标记的 stale、archived 或 pinned 条目与未被 curator 管理的普通安装技能。

## 目标

在已安装技能页忠实呈现 `skills.curator.status` 的只读状态，不把 JunQi 本地 SkillHub、
技能启停或 ClawHub 安全判定伪装成 curator 数据。

## 契约与约束

1. 只调用 `skills.curator.status`，不调用 pin、unpin、restore 或任一 proposal 写方法。
2. 只接受完整官方 status：最近执行字段、错误、三个计数、完整 lifecycle entry 与 overlap。
   遇到未知状态、缺少字段、无效数值或畸形嵌套条目时拒绝整个回包，不补默认值。
3. Gateway 明确未广告该方法时不得发送请求；广告未知时允许真实请求并显示实际错误，不能由
   OpenClaw 版本、系统平台或本地目录推断支持情况。
4. 技能标签只按 status 与 curator 的 `skillKey` 精确关联。没有匹配项必须保持未知，不能显示
   active、stale、archived、pinned 或使用次数。
5. Gateway `lastError` 和 RPC 失败仅为状态呈现，不能触发 sweep、修复、pin、restore、删除、
   自动重试或本地状态写入。

## 验收条件

- Gateway 返回的 lifecycle 标签、固定状态、使用次数、汇总计数和 overlap 数量可在已安装页显示。
- 显式不支持、回包畸形或 RPC 失败不会伪造 lifecycle 结果，也不影响技能列表读取。
- status 与安全判定、技能卡、启停和上传路径保持各自权限边界。
- 回归覆盖读取请求、严格解码和明确未广告场景；文档保留真实 Gateway 与四平台真机边界。
