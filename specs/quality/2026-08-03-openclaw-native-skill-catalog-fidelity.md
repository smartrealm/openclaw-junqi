# OpenClaw 原生技能目录字段对齐规格

## 目标

JunQi 的 Gateway 技能目录必须忠实呈现 OpenClaw 原生 `skills.search` 和 `skills.detail`
结果。JunQi 可以改善布局、错误状态和可读性，但不能凭空增加 OpenClaw 没有返回的 marketplace
统计、README、版本历史、CLI 命令或来源 URL。

## 约束

1. OpenClaw 官方协议、schema 和 handler 是字段与权限的唯一依据；安装版本只用于复现，不得
   作为硬编码能力开关。
2. `skills.search` 结果必须有有效的 `score`、`slug` 和 `displayName`；可选字段只在类型正确
   时保留。
3. `skills.status` 必须有官方 status entry 的 `skillKey`、`name`、`description`、`source`、
   `disabled`、`eligible` 和 `userInvocable`；缺失字段不得转换成默认启用或默认可用。
4. `skills.detail.skill` 必须有 `slug`、`displayName`、`createdAt` 和 `updatedAt`；
   `latestVersion`、`metadata`、`owner` 等可选结构不得用空对象或假值补齐。
5. 页面只展示实际字段。未知值显示为空缺状态或不显示，不得显示 `0`、空版本历史或猜测
   的 ClawHub URL。
6. `skills.install` 仍通过受保护的 Gateway 管理员出口执行；本次不改变安装权限和风险确认。
7. 已安装技能的安全标记只能来自原生 `skills.securityVerdicts`；仅在 verdict 的 `slug` 或
   `requestedSlug` 与 status `skillKey` 精确匹配且 `securityPassed` 为布尔值时显示，其他情况
   必须保持未知。

## 验收条件

- 搜索结果显示官方 score，并按存在性显示版本；不再读取 downloads、stars 或 installs。
- 详情面板只显示官方 detail 字段；没有默认 CLI、README、版本历史和外部链接。
- detail 请求失败时仍能显示搜索结果，并把失败文本作为错误状态，而不是伪造详情。
- 非法类型和缺少必需字段的 Gateway 响应被拒绝；回归测试覆盖这些情况。
- `skills.securityVerdicts` 失败不阻断已安装技能列表；不存在判定或未知判定不会显示通过或失败
  图标。
- 中英文及繁体中文 locale 都有新增标签，JSON 可解析。

## 不在本规格内

技能上传、技能卡片、二进制依赖探测、提案和真实 Gateway/桌面平台验收需要独立规格；安全
判定只覆盖已安装 ClawHub 关联项，不扩展为目录搜索项审计。
