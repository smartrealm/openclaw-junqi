# JunQi Desktop 安装与首次启动

JunQi 是 OpenClaw Gateway 的 Tauri 桌面客户端。安装流程只负责桌面运行时选择、环境检测、Gateway 生命周期交接和官方 OpenClaw 安装协议的呈现；模型、凭据、工作区、渠道、会话和工具的语义均由 OpenClaw 决定。

当前路径按所选 Runtime 的正式 RPC 响应协商配置模式：支持 Guided Setup 时使用 guided inference；明确不支持该方法时使用官方 Classic Wizard。实施依据与未验证边界见 [OpenClaw 原生安装对齐审计](../quality/openclaw-native-installation-alignment-audit-2026-08-12.md)。

## 当前流程

1. 用户确认存储位置并选择 Native 或 Docker 运行时。该选择会持久化，失败时不会静默切换到另一运行时。
2. JunQi 按所选运行时检测或准备 Node、npm、OpenClaw、Docker 与必要系统能力。路径和凭据始终绑定该运行时，不能使用开发机默认值。
3. 数据位置步骤会读取选定运行时绑定的真实目录，但初次读取只保持最终表单的静态骨架，不把短暂 IPC 阶段展示为独立页面。读取失败时才显示可重试错误。正常表单默认展开“安装位置”，直接展示 OpenClaw 工作区及可选的 npm、Node.js 和 Git 位置；用户可以折叠该区域，在同一次设置会话中返回此步骤时保留用户的展开或折叠选择。
4. JunQi 启动或复用 Gateway，并在认证连接与 Runtime Identity 均完成核验后继续。端口可达或进程启动不等于交接成功。
5. 认证连接建立后调用 `openclaw.setup.detect` 协商配置协议。成功时按 Guided 结果继续；只有 Gateway 明确返回 unknown-method 才进入同一 Runtime 的官方 Classic Wizard。无权限、断线与响应非法分别保留真实失败，不能冒充协议不支持。
6. 认证或准备 Wizard 结束后重新探测候选并执行真实激活，不把“授权流程结束”误判为模型已经可用。推理成立后使用独立 session 调用 `openclaw.chat`，由官方对话继续工作区、Gateway、渠道和其他可选配置。用户显式选择“详细配置”时才进入经典 Wizard。
7. 官方 Wizard step 返回 `externalUrl` 时，JunQi 在该步骤存活期间通过共享前端组件本地生成二维码，并提供浏览器打开和复制操作。第三方插件尚未接入 `openUrl()`、但在当前结构化 step 的 `message` 中返回唯一、带非空 `user_code` 的 HTTPS 一次性授权地址时，JunQi 可将该地址原样投影为二维码；普通文档链接不生成二维码。授权区域明确说明完成外部授权后还需提交当前官方步骤，主要操作使用授权专用文案。步骤标识变化、提交等待、官方终态、取消或失败后立即销毁该投影，不读取历史日志、不改写地址，也不据此推断授权状态。`deviceCode` 继续按官方字段并列呈现，二维码生成失败时保留链接与手工流程。
8. Guided 与 Classic 的官方终态共用唯一交接门禁：优先复用当前已核验连接，连接失效时才等待既有生命周期操作收敛并重连，并在同一连接围栏内核验所选 Runtime。Guided 继续执行 `setup.detect` 与 `setup.verify`；Classic 直接采用当前官方 Wizard 的 `done`，不要求 Runtime 实现 Guided 专属方法。任一步失败都停在当前配置页，不重启向导、不恢复旧二维码、不写入完成标记。

## 当前验证与边界

自动化覆盖 Native 与 Docker 选择、配置交接和连接状态的协议边界。macOS、Windows 与 Linux 的安装器、系统服务、凭据库和真实官方插件行为仍须分别在目标设备验收；未验收时不得描述为跨平台已通过。

Gateway 启动环境使用 Gateway 配置中 `env.vars.OPENCLAW_LOCALE` 的值。JunQi 首次创建配置时以当前应用语言写入对应的 OpenClaw 原生 locale；后续由设置页的“OpenClaw 运行时语言”独立读取和修改该官方配置，不把 JunQi 界面语言切换误当作远端 Runtime 写权限。写入必须经过 `config.get` 快照、`hash` 与 `config.patch`，并在 JunQi 管理的本地 Runtime 上通过统一 Gateway 生命周期入口重启后生效；外部或远端 Runtime 只保留“配置已保存、需由运行时所有者重启”的真实状态。

Wizard 步骤文本属于 Runtime 或插件所有。接入 OpenClaw `createSetupTranslator` 的插件会随 `OPENCLAW_LOCALE` 使用官方英语、简体中文或繁体中文文案；没有接入该接口、将文案静态写为单一语言的第三方插件仍返回原文。JunQi 忠实呈现这些结构化文本，不以客户端字符串匹配、翻译表或猜测性 fallback 改写插件结果。

钉钉官方插件 0.8.24 及其 2026-08-11 主线仍在插件进程中调用 `qrcode-terminal`，终端二维码生成失败时只把授权 URL 写入 `prompter.note()` 正文，没有调用 OpenClaw 已提供的 `prompter.openUrl()`。因此该步骤不会产生结构化 `externalUrl`。JunQi 不补造该协议字段，仅对当前 step 正文中唯一、带非空 `user_code` 的 HTTPS 一次性授权地址生成本地二维码，并继续显示插件原文。进入下一步骤后不再从普通 HTTPS 链接恢复二维码。长期正确边界仍在钉钉插件：取得 `verificationUriComplete` 后调用 `prompter.openUrl()`，由 OpenClaw 把地址绑定到结构化步骤。

### 渠道扫码边界

| 渠道形态 | OpenClaw 当前正式输出 | JunQi 呈现 |
| --- | --- | --- |
| Wizard 返回 `externalUrl` | 结构化授权地址 | 本地二维码、复制地址、浏览器打开 |
| 钉钉当前授权 note | 当前 step 正文中唯一、带非空 `user_code` 的 HTTPS 一次性授权地址 | 保留原文并原样生成本地二维码；离开当前步骤后销毁 |
| 声明 `web.login.start` 与 `web.login.wait` 的渠道插件 | `qrDataUrl`、`message`、`connected` | 显示官方 PNG 二维码，在单次官方等待窗口内监听轮换与终态；等待结束后由用户继续监听或重新生成 |
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
- OpenClaw macOS 客户端的有界扫码等待与二维码轮换：[`apps/macos/Sources/OpenClaw/ChannelsStore+Lifecycle.swift`](https://github.com/openclaw/openclaw/blob/main/apps/macos/Sources/OpenClaw/ChannelsStore%2BLifecycle.swift)
- 钉钉官方插件当前仍只在 note 正文输出授权 URL：[`src/onboarding.ts`](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/src/onboarding.ts)

流程静态预览见 [`../previews/junqi-first-run-flow.html`](../previews/junqi-first-run-flow.html)。

`wizard.start`、步骤类型、会话恢复、取消和终态交接的详细协议见 [`openclaw-wizard-start-flow.md`](openclaw-wizard-start-flow.md)。
