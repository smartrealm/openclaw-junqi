# JunQi Desktop 安装与首次启动

JunQi 是 OpenClaw Gateway 的 Tauri 桌面客户端。安装流程只负责桌面运行时选择、环境检测、Gateway 生命周期交接和官方 OpenClaw Wizard 的呈现；模型、凭据、工作区、渠道、会话和工具的语义均由 OpenClaw 决定。

## 当前流程

1. 用户确认存储位置并选择 Native 或 Docker 运行时。该选择会持久化，失败时不会静默切换到另一运行时。
2. JunQi 按所选运行时检测或准备 Node、npm、OpenClaw、Docker 与必要系统能力。路径和凭据始终绑定该运行时，不能使用开发机默认值。
3. JunQi 启动或复用 Gateway，并在认证连接与 Runtime Identity 均完成核验后继续。端口可达或进程启动不等于交接成功。
4. JunQi 调用官方 `openclaw.setup.detect`。官方判断需要配置时，在同一会话呈现官方 Wizard；官方不支持该方法时才进入同一 Gateway 的官方 Wizard，不以本地标记跳过。
5. Wizard 的模型、凭据、工作区、渠道及可跳过步骤均按其结构化步骤呈现。确认步骤的提示只在其确认控件中显示一次；配置核验与向导连接阶段默认展开日志，正常交互步骤默认收起，步骤失败时自动展开，用户始终可以手动切换。步骤切换必须复位主体滚动位置，不能让上一状态的滚动偏移把下一状态移出视口。
6. 官方 Wizard step 返回 `externalUrl` 时，JunQi 在任意步骤类型下通过共享前端组件本地生成二维码，并提供可点击授权入口和复制操作。第三方插件尚未接入 `openUrl()`、但在当前结构化 step 的 `message` 中只返回一个明确 HTTPS 地址时，JunQi 可将该地址原样投影为二维码；不读取历史日志、不改写地址，也不据此推断授权状态。存在零个或多个地址时保持原始提示，不猜测目标。`deviceCode` 继续按官方字段并列呈现，二维码生成失败时保留链接与手工流程。
7. 完成后进入 Dashboard。后续连接异常由统一 Gateway 生命周期协调器处理，不能把旧连接、文本日志或本地缓存当作成功。

## 当前验证与边界

自动化覆盖 Native 与 Docker 选择、配置交接和连接状态的协议边界。macOS、Windows 与 Linux 的安装器、系统服务、凭据库和真实官方插件行为仍须分别在目标设备验收；未验收时不得描述为跨平台已通过。

Gateway 启动环境使用 Gateway 配置中 `env.vars.OPENCLAW_LOCALE` 的值。JunQi 首次创建配置时以当前应用语言写入对应的 OpenClaw 原生 locale；后续由设置页的“OpenClaw 运行时语言”独立读取和修改该官方配置，不把 JunQi 界面语言切换误当作远端 Runtime 写权限。写入必须经过 `config.get` 快照、`hash` 与 `config.patch`，并在 JunQi 管理的本地 Runtime 上通过统一 Gateway 生命周期入口重启后生效；外部或远端 Runtime 只保留“配置已保存、需由运行时所有者重启”的真实状态。

Wizard 步骤文本属于 Runtime 或插件所有。接入 OpenClaw `createSetupTranslator` 的插件会随 `OPENCLAW_LOCALE` 使用官方英语、简体中文或繁体中文文案；没有接入该接口、将文案静态写为单一语言的第三方插件仍返回原文。JunQi 忠实呈现这些结构化文本，不以客户端字符串匹配、翻译表或猜测性 fallback 改写插件结果。

钉钉官方插件 0.8.24 及其 2026-08-11 主线仍在插件进程中调用 `qrcode-terminal`，终端二维码生成失败时只把授权 URL 写入 `prompter.note()` 正文，没有调用 OpenClaw 已提供的 `prompter.openUrl()`。因此该步骤不会产生结构化 `externalUrl`。JunQi 不补造该协议字段，仅对当前 step 正文中唯一、可验证的 HTTPS 地址生成本地二维码，并继续显示插件原文。长期正确边界仍在钉钉插件：取得 `verificationUriComplete` 后调用 `prompter.openUrl()`，由 OpenClaw 把地址绑定到结构化步骤。

### 渠道扫码边界

| 渠道形态 | OpenClaw 当前正式输出 | JunQi 呈现 |
| --- | --- | --- |
| Wizard 返回 `externalUrl` | 结构化授权地址 | 本地二维码、复制地址、浏览器打开 |
| 钉钉当前授权 note | 当前 step 正文中的唯一 HTTPS 授权地址 | 保留原文并原样生成本地二维码 |
| 声明 `web.login.start` 与 `web.login.wait` 的渠道插件 | `qrDataUrl`、`message`、`connected` | 直接显示官方 PNG 二维码并轮询官方结果 |
| 飞书当前扫码创建应用流程 | 插件内部直接向终端输出二维码，Wizard step 不携带二维码地址 | 保留官方原始步骤；上游未提供结构化载荷前不抓取终端画面或伪造地址 |
| 企业微信外部插件 | 由当前已安装插件版本定义的配置字段与连接方式 | 按当前插件的正式 schema 和 Wizard step 呈现，不从渠道名称推断扫码入口 |
| 其他渠道 | 取决于当前 Runtime 插件的 Wizard step 或正式 `gatewayMethods` | 动态呈现；没有正式载荷时显示不可用，不按渠道名称硬编码扫码能力 |

个人微信、QQ 或未来渠道是否显示二维码，不由 JunQi 的静态渠道表决定。当前 Runtime 只有在 Wizard step 返回明确授权地址，或插件正式声明完整 Web 扫码方法并返回 `qrDataUrl` 时，JunQi 才呈现扫码 UI。这样能够随 OpenClaw 和插件升级扩展，同时避免把“渠道本身可扫码”误写成“当前 Gateway 已向桌面客户端交付二维码”。

## 官方依据

- OpenClaw Wizard 语言解析与三种官方语言映射：[`src/wizard/i18n/index.ts`](https://github.com/openclaw/openclaw/blob/main/src/wizard/i18n/index.ts)
- 插件接入的官方本地化导出：[`src/plugin-sdk/setup-runtime.ts`](https://github.com/openclaw/openclaw/blob/main/src/plugin-sdk/setup-runtime.ts)
- 飞书渠道对 `createSetupTranslator` 的原生使用：[`extensions/feishu/src/setup-surface.ts`](https://github.com/openclaw/openclaw/blob/main/extensions/feishu/src/setup-surface.ts)
- 企业微信由官方目录中的腾讯外部插件拥有配置契约：[`docs/channels/wecom.md`](https://github.com/openclaw/openclaw/blob/main/docs/channels/wecom.md)
- OpenClaw Wizard 将 `openUrl()` 绑定到下一条结构化步骤的 `externalUrl`：[`src/wizard/session.ts`](https://github.com/openclaw/openclaw/blob/main/src/wizard/session.ts)
- OpenClaw Web 扫码请求的封闭参数 schema：[`packages/gateway-protocol/src/schema/channels.ts`](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/channels.ts)
- OpenClaw Web 扫码插件选择和结果转发：[`src/gateway/server-methods/web.ts`](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/web.ts)
- WhatsApp 插件对 Web 扫码方法的正式声明：[`extensions/whatsapp/src/shared.ts`](https://github.com/openclaw/openclaw/blob/main/extensions/whatsapp/src/shared.ts)
- 钉钉官方插件当前仍只在 note 正文输出授权 URL：[`src/onboarding.ts`](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/src/onboarding.ts)

流程静态预览见 [`../previews/junqi-first-run-flow.html`](../previews/junqi-first-run-flow.html)。

`wizard.start`、步骤类型、会话恢复、取消和终态交接的详细协议见 [`openclaw-wizard-start-flow.md`](openclaw-wizard-start-flow.md)。
