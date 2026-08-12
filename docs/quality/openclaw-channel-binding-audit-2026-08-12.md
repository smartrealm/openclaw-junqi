# OpenClaw 渠道绑定完整性审计

## 范围与依据

本次审计覆盖渠道目录、插件安装、官方 Channels Wizard、二维码登录、账号配置、多账号能力、运行状态与钉钉连接器 0.8.24。协议依据为最新版 OpenClaw Gateway schema、channels Wizard runner、Web Login handler、官方 Control UI，以及本机安装的 OpenClaw 2026.7.1-2 和钉钉连接器 0.8.24 源码。

## 严重问题

### BUG-CHB-01：渠道中心绕过官方 Channels Wizard

位置：`src/pages/ChannelsCenter/index.tsx`

当前行为：普通渠道跳转终端，受管钉钉插件安装后打开通用 schema 编辑器。钉钉插件拥有的一键扫码、授权轮询、连接探测和访问策略步骤没有在渠道中心运行。

影响：首次配置可以扫码，但主界面无法完成同等的新增、重新绑定与多账号配置。

目标：新增和重新配置渠道统一使用最新版官方 `wizard.start { flow: "channels", channel }`。终态只消费官方返回的实际 `accounts`，旧 Runtime 明确拒绝该参数时才提供真实的终端交接。

### BUG-CHB-02：全局 Web Login 被错误泛化为按渠道方法

位置：`src/services/openclawChannelRuntime.ts`、`src/services/channelQrLogin.ts`

当前行为：JunQi 根据所选渠道 capability 显示二维码，但 `web.login.start` 与 `web.login.wait` 没有 channel 参数；Gateway 会选择首个声明方法的 provider。

影响：多个 Web Login provider 同时存在时，界面渠道身份与实际登录 provider 可能不一致。

目标：只有所选渠道是当前已安装目录中唯一同时声明两个 Web Login 方法的 provider，且账号来自官方 Channels Wizard 终态时，才允许后续内嵌二维码。

### BUG-CHB-03：就绪状态忽略连接与探测失败

位置：`src/services/channelConfig.ts`

当前行为：账号只要未明确报告 `configured=false` 或 `linked=false` 就显示 ready。

影响：停止、离线、存在 `lastError` 或 probe 失败的账号可能被显示为就绪。

目标：配置、链接、运行、连接和 probe 分别解释。任何显式失败都不能进入 ready；证据不足保持 unknown。

## 中等问题

### BUG-CHB-04：多账号 capability 被第一行覆盖

位置：`src/services/openclawChannelRuntime.ts`

当前行为：capabilities 数组只读取第一项，并按 channel 缓存。

影响：账号级 configured、enabled 和后续操作可能使用错误账号的证据。

目标：保留全部账号 capability，并提供按 accountId 的确定性选择；插件级 schema 与方法只从同一渠道的一致结果读取。

### BUG-CHB-05：官方 schema 与 uiHints 投影不完整

位置：`src/pages/ConfigManager/ChannelOfficialSchemaEditor.tsx`、`src/pages/ConfigManager/SchemaDrivenObjectEditor.tsx`

当前行为：丢弃 `uiHints`；联合 primitive 与 SecretRef 被降级为 JSON 文本区；结构化字段需要先应用再保存；对话框不等待 schema 校验。

影响：钉钉 `clientId`、`clientSecret` 难以正确输入，敏感字段提示和高级字段语义丢失。

目标：消费官方 uiHints，联合 primitive 使用可编辑 primitive 分支，SecretRef 保留结构化输入；草稿错误和未应用结构化编辑阻止外层保存。

### BUG-CHB-06：授权交互缺少身份与失败反馈

位置：`src/pages/ChannelsCenter/ChannelQrLoginDialog.tsx`、`src/pages/SetupPage/wizard/WizardAuthorizationHint.tsx`

当前行为：二维码对话框不显示渠道与账号；复制和打开浏览器失败静默；钉钉 note 的字符二维码与图形二维码重复展示。

影响：用户难以确认正在绑定哪个账号，桌面操作失败时没有恢复提示，窄窗口内容过长。

目标：显示渠道与账号身份；复制和打开失败提供内联反馈；授权步骤显示插件原始说明但折叠终端字符二维码，保留授权 URL 和插件终态语义。

## 未验证边界

- 本机安装 Runtime 2026.7.1-2 不支持 `flow: "channels"`，旧版本只能验证结构化拒绝和终端交接。
- 真实钉钉、WhatsApp 和其他 provider 的扫码、二维码轮换、授权过期仍需真机验收。
- Windows、Linux 的外部浏览器打开和剪贴板权限仍需目标平台验证。
