# Windows OpenClaw Wizard 可视化加固规格

## 范围

本规格仅增强 JunQi 对官方 OpenClaw Wizard 结构化步骤的可视化呈现。OpenClaw Gateway 继续拥有步骤、答案校验、认证流程、配置写入、渠道插件和终态。

## BUG-WVW-01 · 通用浏览器认证操作

**Current**：只有包含明确扫描语义的 QR note 才显示打开和复制 URL 操作。普通 OAuth 和 device-code note 只显示纯文本。

**Target**：从官方 note 原文中安全投影浏览器 URL 和明确标记的用户代码，提供打开与复制操作，不改写原文，不自动提交答案。

**Acceptance**：

- [ ] HTTP(S) URL 可打开和复制。
- [ ] URL userinfo、非 HTTP(S) scheme 和畸形 URL 被拒绝。
- [ ] 明确标记的 device code 可复制，但不进入日志、持久化或自动提交。
- [ ] 普通文档 note 不触发 Wizard 自动推进。
- [ ] QR polling 保留现有受限自动推进契约。

## BUG-WVW-02 · 长选项查找

**Current**：所有 select 和 multiselect options 直接显示为两列卡片，无搜索和无匹配状态。

**Target**：选项超过阈值时显示本地过滤器和计数，保持官方 value、顺序、初始选择与提交语义不变。

**Acceptance**：

- [ ] label 和 hint 可被不区分大小写地过滤。
- [ ] 少量选项不增加多余搜索控件。
- [ ] multiselect 已选项不会因筛选而丢失。
- [ ] 无匹配时显示明确空状态，并可清除过滤条件。
- [ ] 不根据 provider、model 或 channel 文本生成平行分类。

## BUG-WVW-03 · 步骤无障碍反馈

**Current**：步骤变化不管理焦点，错误无 alert 语义，select card 无 `aria-pressed`，text step 的官方 message 未直接成为输入标签。

**Target**：步骤变化、错误和选择状态可被键盘与辅助技术感知，同时避免重复播报轮询状态。

**Acceptance**：

- [ ] 新步骤到达后焦点进入步骤标题或等价语义容器。
- [ ] 错误使用 alert/live 语义。
- [ ] select options 暴露 `aria-pressed`。
- [ ] text input 的可访问名称来自官方问题文本或明确关联的 label。
- [ ] 所有交互都有 `focus-visible`，且不只依赖颜色表达状态。

## 权威与禁止项

- 不新增或猜测 Wizard 阶段、总步数、百分比或成功状态。
- 不解析 provider、model、channel 文本以生成业务状态。
- 不持久化 Wizard answer、API key、device code 或 OAuth code。
- 不绕过 `wizard.next` 的官方校验。
- 不修改 Native/Docker 选择，不静默切换 runtime。
- 不把 Gateway 健康等同于模型、配置、授权或 handoff 完成。
