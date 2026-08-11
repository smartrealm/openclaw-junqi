# OpenClaw 第三方渠道支持与 JunQi 集成边界

更新时间：2026-08-11

本文整理 OpenClaw 对第三方消息平台的正式支持范围、插件归属、配置与授权方式、扫码能力、运行时核验方式，以及 JunQi 可以忠实呈现的客户端边界。本文不是 JunQi 自建渠道清单，也不把第三方平台的产品能力自动等同于 OpenClaw 已接入能力。

## 一、核验依据与时间边界

- OpenClaw 上游依据为 2026-08-11 核验的 `main` 提交 [`2046dbcd6f123abe8a007bda2c58d0835eec7dc2`](https://github.com/openclaw/openclaw/commit/2046dbcd6f123abe8a007bda2c58d0835eec7dc2)。
- 渠道总表以该提交生成的[官方渠道目录](https://github.com/openclaw/openclaw/blob/2046dbcd6f123abe8a007bda2c58d0835eec7dc2/docs/channels/index.md)和[外部渠道目录快照](https://github.com/openclaw/openclaw/blob/2046dbcd6f123abe8a007bda2c58d0835eec7dc2/scripts/lib/official-external-channel-catalog.json)为准。
- 单个渠道的消息类型、认证和限制以其官方渠道文档、插件清单和运行时代码为准。外部插件的详细行为由插件提供方负责，OpenClaw 只拥有通用插件契约和目录记录。
- 当前安装版本只用于复现。JunQi 不按版本号硬编码渠道能力，最终以所选 Runtime 的 `channels list`、`channels capabilities` 和 `channels status --probe` 结果为准。

## 二、什么才算“OpenClaw 支持”

“平台名称出现在页面上”不能单独证明渠道可用。支持状态必须分层判断：

| 层级 | 权威信号 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| 目录可发现 | `openclaw channels list --all --json` | 当前 Runtime 已知该渠道，及其 `installed`、`configured`、`enabled` 状态 | 凭据有效、连接健康、消息可收发 |
| 插件已安装 | 目录中的 `installed: true` | Runtime 已加载该渠道插件 | 账号已经配置或连接 |
| 配置可表达 | 插件 `channelConfigs` 与配置 schema | 可配置字段及敏感字段边界 | 填入的值真实有效 |
| 能力可发现 | `openclaw channels capabilities --channel <id> --json` | 当前插件报告的 `support`、`actions`、schema 和 Gateway 方法 | 当前账号已经登录或在线 |
| 账号已配置 | `channels list` 或 `channels status` 中的账号状态 | 账号配置存在 | 上游平台认证成功 |
| 运行健康 | `openclaw channels status --channel <id> --probe --json` | 当前账号的连接、探测和审计结果 | 历史上所有消息都已送达 |
| 路由已建立 | OpenClaw `bindings` 和账号路由结果 | 指定渠道账号由哪个 Agent 处理 | Agent 的模型、工具或权限一定可用 |
| 消息闭环 | 真实入站与出站测试、渠道日志、死信记录 | 当前目标平台上的实际收发结果 | 其他账号、群组或媒体类型也同样正常 |

OpenClaw 的[渠道 CLI 契约](https://github.com/openclaw/openclaw/blob/2046dbcd6f123abe8a007bda2c58d0835eec7dc2/docs/cli/channels.md)还提供 `resolve`、`logs` 和 `dead-letters`。JunQi 应把目录、配置、健康、路由和消息闭环分开显示，不能用单个“已连接”覆盖全部状态。

## 三、官方目录中的 31 个渠道入口

### 3.1 随核心安装或内置的入口

| 渠道 | 归属 | 主要范围 | 配置或授权 |
| --- | --- | --- | --- |
| [Reef](https://docs.openclaw.ai/channels/reef) | OpenClaw bundled plugin | 不同用户的 OpenClaw Agent 之间进行受保护的端到端加密消息 | 使用 Reef 自身的身份与配对流程 |
| [Telegram](https://docs.openclaw.ai/channels/telegram) | OpenClaw bundled plugin | Bot API 私聊、群聊、媒体与群组策略 | Bot token，配合 DM pairing 或 allowlist |
| [WebChat](https://docs.openclaw.ai/web/webchat) | OpenClaw core | Gateway WebSocket 上的原生 WebChat | Gateway 身份与权限，不是第三方账号登录 |

### 3.2 OpenClaw 官方可下载插件

这些插件由 OpenClaw 官方目录标记为 `official`，通常通过 `openclaw plugins install @openclaw/<id>` 或渠道向导按需安装。是否已经存在仍以目标 Runtime 的目录结果为准。

| 渠道 | 插件或接入方式 | 文档确认的主要范围 | 主要配置或授权 |
| --- | --- | --- | --- |
| [Buzz](https://docs.openclaw.ai/channels/buzz) | `@openclaw/buzz` | Buzz 团队房间与线程回复 | Relay URL、私钥 |
| [ClickClack](https://docs.openclaw.ai/channels/clickclack) | `@openclaw/clickclack` | 自托管聊天、群组与直接消息 | 一次性 setup code 或 bot token |
| [Discord](https://docs.openclaw.ai/channels/discord) | `@openclaw/discord` | 服务器、频道、私聊、组件、语音与媒体能力 | Discord bot token |
| [Feishu](https://docs.openclaw.ai/channels/feishu) | `@openclaw/feishu` | 飞书或 Lark 私聊、群聊、流式卡片、文档、知识库、云盘和多维表格工具 | App ID 与 App Secret，或扫码创建机器人 |
| [Google Chat](https://docs.openclaw.ai/channels/googlechat) | `@openclaw/googlechat` | Google Workspace Chat 应用与 HTTP webhook | 服务账号或 token、audience、webhook |
| [iMessage](https://docs.openclaw.ai/channels/imessage) | `@openclaw/imessage` | 通过 `imsg` 接入本机 iMessage 或 SMS，并支持部分私有消息动作 | 已登录的 macOS、`imsg` bridge 和系统权限 |
| [IRC](https://docs.openclaw.ai/channels/irc) | `@openclaw/irc` | IRC 频道和私聊 | 主机、端口、TLS、昵称与可选密码 |
| [LINE](https://docs.openclaw.ai/channels/line) | `@openclaw/line` | LINE Messaging API webhook bot | Channel access token 与 channel secret |
| [Matrix](https://docs.openclaw.ai/channels/matrix) | `@openclaw/matrix` | 私聊、房间、线程、媒体、反应、投票、位置和端到端加密 | Homeserver、access token 或密码、设备与加密配置 |
| [Mattermost](https://docs.openclaw.ai/channels/mattermost) | `@openclaw/mattermost` | 频道、群组与私聊 | Bot token 与服务 URL |
| [Microsoft Teams](https://docs.openclaw.ai/channels/msteams) | `@openclaw/msteams` | Bot Framework 私聊、群组、团队频道、卡片和媒体 | Azure Bot、应用凭据、webhook，部分能力需要 Graph 权限 |
| [Nextcloud Talk](https://docs.openclaw.ai/channels/nextcloud-talk) | `@openclaw/nextcloud-talk` | 自托管 Nextcloud Talk webhook bot | Base URL、secret、token 或密码 |
| [Nostr](https://docs.openclaw.ai/channels/nostr) | `@openclaw/nostr` | NIP-04 加密私聊 | 私钥与 relay 列表 |
| [QQ Bot](https://docs.openclaw.ai/channels/qqbot) | `@openclaw/qqbot` | C2C 私聊、群聊、频道和富媒体；频道媒体范围更窄 | AppID 与 AppSecret，或 QQ 扫码绑定机器人 |
| [Raft](https://docs.openclaw.ai/channels/raft) | `@openclaw/raft` | Raft CLI 唤醒桥，用于人与 Agent 协作 | Raft profile |
| [Signal](https://docs.openclaw.ai/channels/signal) | `@openclaw/signal` | `signal-cli` 私聊与群组 | 手机号、`signal-cli` 或 REST bridge；可扫码链接已有账号 |
| [Slack](https://docs.openclaw.ai/channels/slack) | `@openclaw/slack` | Workspace 私聊、多人私聊、频道、线程与媒体 | Bot token、App token 或签名密钥；Socket 或 HTTP 模式 |
| [SMS](https://docs.openclaw.ai/channels/sms) | `@openclaw/sms` | Twilio SMS 与 MMS 的 webhook 收发 | Twilio SID、auth token、号码或 Messaging Service |
| [Synology Chat](https://docs.openclaw.ai/channels/synology-chat) | `@openclaw/synology-chat` | Synology NAS Chat 频道与私聊 | token、incoming URL 与 webhook path |
| [Tlon](https://docs.openclaw.ai/channels/tlon) | `@openclaw/tlon` | Urbit 或 Tlon 消息 | ship、URL、登录 code 与群组配置 |
| [Twitch](https://docs.openclaw.ai/channels/twitch) | `@openclaw/twitch` | Twitch 直播聊天 | Twitch access token |
| [WhatsApp](https://docs.openclaw.ai/channels/whatsapp) | `@openclaw/whatsapp` | WhatsApp Web 私聊、群聊、媒体与账号路由 | 仅通过二维码链接设备 |
| [Zalo](https://docs.openclaw.ai/channels/zalo) | `@openclaw/zalo` | Zalo Bot API | Bot token 与可选 webhook secret |
| [Zalo Personal](https://docs.openclaw.ai/channels/zalouser) | `@openclaw/zalouser` | 通过 `zca-js` 自动化个人 Zalo 账号，支持私聊与群组，但官方文档标记为实验性 | 二维码登录；存在账号封禁风险 |

### 3.3 被 OpenClaw 官方目录收录的外部插件

这些插件出现在 OpenClaw 官方目录中，但运行时代码由外部团队维护。OpenClaw 的目录收录不等于 OpenClaw core 对插件内部行为背书。

| 渠道 | 插件与维护方 | 文档确认的范围 | 主要配置或授权 |
| --- | --- | --- | --- |
| [WeChat](https://docs.openclaw.ai/channels/wechat) | `@tencent-weixin/openclaw-weixin`，腾讯微信团队 | 私聊与媒体；插件 capability 只声明 direct，不声明群聊 | `openclaw channels login --channel openclaw-weixin` 后微信扫码 |
| [WeCom](https://docs.openclaw.ai/channels/wecom) | `@wecom/wecom-openclaw-plugin`，企业微信团队 | Bot 模式消息、企业应用 webhook，以及文档、日程、任务等插件工具 | Bot ID 与 Secret，或企业应用的 CorpID、CorpSecret、AgentId 和回调凭据 |
| [Yuanbao](https://docs.openclaw.ai/channels/yuanbao) | `openclaw-plugin-yuanbao`，腾讯元宝团队 | WebSocket 私聊、群聊、分块输出、原生命令菜单和插件工具 | App Key 与 App Secret |
| [Zalo ClawBot](https://docs.openclaw.ai/channels/zaloclawbot) | `@zalo-platforms/openclaw-zaloclawbot` | 绑定所有者的个人助手机器人，使用官方 Zalo Bot Platform API | Zalo Mini App 二维码授权 |

### 3.4 相关但不属于聊天渠道目录的插件

[Voice Call](https://docs.openclaw.ai/plugins/voice-call) 是通过 Plivo、Telnyx 或 Twilio 提供电话能力的相关通信插件，不应在 JunQi 中伪装成普通聊天渠道账号。

## 四、中国大陆常用渠道的详细边界

### 4.1 钉钉

钉钉需要拆成两条独立能力链，不能混为一个“钉钉已连接”状态。

第一条是消息渠道。钉钉团队维护的 [`@dingtalk-real-ai/dingtalk-connector`](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) 注册 `dingtalk-connector` 渠道，插件声明 direct 与 group 聊天、媒体和交互卡片，不声明线程、反应、编辑或原生回复。插件支持 AppKey 与 AppSecret，也提供一键扫码创建或绑定机器人。

截至本次核验，该连接器不在 OpenClaw 官方渠道目录的 31 个入口中。JunQi 仅在 Rust 可信边界中将其列为经过审查的外部插件，并通过 OpenClaw 自己的 `plugins install <spec> --pin` 安装；插件安装后，schema、账号、状态和能力仍必须由所选 Runtime 真实返回。对应实现是 [`src-tauri/src/commands/openclaw_channel.rs`](../../src-tauri/src/commands/openclaw_channel.rs)。

第二条是业务工具。JunQi 的 `@junqi/openclaw-dingtalk-business` 插件通过 DWS 暴露通讯录、审批、考勤、日程和待办工具。它不是消息渠道，不能代替 `dingtalk-connector` 收发聊天，也不能用 DWS 登录状态推断钉钉机器人已在线。架构边界见[钉钉业务 Runtime ADR](../adr/0002-openclaw-plugin-owned-dingtalk-business-runtime.md)。

### 4.2 飞书与 Lark

飞书是 OpenClaw 官方插件。官方文档确认 Bot 私聊、群聊、流式卡片回复、文档、知识库、云盘和多维表格工具；WebSocket 是默认事件传输，不要求公网 URL，webhook 是可选模式。它支持多账号、按私聊或群组绑定 Agent、话题线程会话，以及按用户动态创建隔离 Agent。

飞书有两种设置方式：手工输入 App ID 与 App Secret，或扫码创建机器人。扫码流程会把 DM 策略收紧到当前扫码用户的 `open_id`。当前上游实现通过终端二维码输出完成扫码，没有把二维码数据作为通用 Wizard 字段交给桌面客户端，因此“平台支持扫码”不等于 JunQi 已获得可嵌入的二维码数据。

### 4.3 企业微信

企业微信是 OpenClaw 官方目录收录的外部插件，由企业微信团队维护。其[插件官方仓库](https://github.com/WecomTeam/wecom-openclaw-plugin)描述两种模式：Bot 模式使用 WebSocket 或 HTTP webhook，企业应用模式使用加密 XML webhook。插件还注册 `wecom_mcp` 工具，并声明文档、智能表格、日历和任务等企业能力。

当前公开设置方式是 Bot ID 与 Secret，或企业应用的 CorpID、CorpSecret、AgentId、Token 和 EncodingAESKey。官方文档没有把个人微信式扫码登录声明为企业微信渠道设置方式，因此 JunQi 不应显示“企业微信扫码绑定”入口，除非目标 Runtime 的实际插件以后通过正式 capability 或 Wizard 步骤提供该能力。

### 4.4 QQ Bot

QQ Bot 是 OpenClaw 官方插件，使用 QQ Bot API 和 WebSocket gateway。它支持 C2C 私聊、群聊与 Guild 频道；C2C 和群聊支持图片、语音、视频和文件，Guild 频道只支持文本和远程 URL 图片。插件不支持反应和线程。

QQ 扫码绑定的是 QQ Bot 应用凭据，不是把普通个人 QQ 账号登录为聊天客户端。当前插件在 setup finalize 内部调用腾讯 connector 的 `qrConnect`，二维码生命周期由该 connector 持有，没有通过 OpenClaw 通用 `web.login.start` 与 `web.login.wait` 返回给 JunQi。

### 4.5 个人微信

个人微信通过腾讯微信团队维护的外部 `openclaw-weixin` 插件接入。官方 OpenClaw 文档确认直接消息和媒体，未声明群聊。登录命令会启动微信二维码登录，凭据保存在 OpenClaw 状态目录中，多账号应使用按账号、渠道和对端隔离的 DM scope。

JunQi 只能根据安装后的插件 capability 决定是否能在应用内呈现二维码。官方文档确认“可以扫码”，但没有因此保证所有版本都会返回结构化 `qrDataUrl` 或 `externalUrl`。

### 4.6 腾讯元宝

元宝是官方目录收录的外部插件。插件文档确认 WebSocket 私聊、群聊、分块输出、原生命令菜单、多账号，以及群信息、会话成员和提醒工具。授权使用 App Key 与 App Secret，不是个人账号扫码登录。

元宝插件细节由腾讯元宝团队维护。JunQi 需要把 OpenClaw 目录状态与插件自身运行状态分开，不得把目录收录描述为 OpenClaw core 已验证全部配置和行为。

## 五、扫码能力真相表

扫码至少有四种完全不同的语义：链接个人设备、创建或绑定机器人、链接外部 CLI 设备、打开外部授权页。JunQi 不能只看到“QR”就使用同一完成条件。

| 渠道 | 扫码语义 | 上游当前输出方式 | JunQi 内嵌边界 |
| --- | --- | --- | --- |
| WhatsApp | 链接 WhatsApp Web 设备 | OpenClaw 正式 `web.login.start` 与 `web.login.wait` 可返回 `qrDataUrl`、轮换二维码和 `connected` | 目标 Runtime capability 同时声明两个方法时可内嵌；官方成功回调后独立刷新渠道状态 |
| Zalo Personal | 链接个人 Zalo 账号 | 渠道 gateway adapter 提供 QR start 与 wait | 仍以 Runtime capability 是否正式暴露对应 Gateway 方法为准 |
| WeChat | 登录个人微信插件账号 | `channels login` 触发插件二维码 | 文档未保证结构化二维码；不能从终端图形或历史日志重建 |
| DingTalk | 创建或绑定钉钉机器人并取得凭据 | 插件当前把终端二维码和授权 URL 放入 note 文本 | JunQi 只可将当前步骤中唯一明确的 HTTPS 地址做本地二维码投影；不能从显示成功推断授权完成 |
| Feishu | 扫码创建机器人并限制 DM 到扫码用户 | 上游 setup 直接调用终端 QR 输出 | 当前没有通用结构化 QR 字段，JunQi 不能凭渠道名伪造 |
| QQ Bot | 扫码绑定 QQ Bot 应用凭据 | 腾讯 connector 内部 `qrConnect` | 当前没有通用结构化 QR 字段，JunQi 不能把普通 QQ 登录当成 Bot 绑定 |
| Zalo ClawBot | 通过 Zalo Mini App 绑定所有者机器人 | 外部插件在终端渲染二维码 | 只能忠实呈现插件正式返回；令牌过期后必须由插件重新生成 |
| Signal | 通过 `signal-cli` 链接现有 Signal 账号 | 外部 CLI 在终端生成链接二维码 | 这不是 OpenClaw Web 登录 RPC，JunQi 不应假装拥有扫码会话状态 |
| WeCom | 当前文档没有扫码配置契约 | Bot ID、Secret 或企业应用回调凭据 | 不展示扫码入口 |
| Yuanbao | 当前文档没有扫码配置契约 | App Key 与 App Secret | 不展示扫码入口 |

二维码只是一种授权地址的视觉编码。JunQi 的完成条件始终是插件正式返回的终态和后续账号探测，不能是二维码已显示、用户声称已扫描或浏览器已打开。

## 六、跨渠道共同能力

### 6.1 多渠道并行与确定性路由

OpenClaw 允许多个渠道同时运行。入站消息会按渠道、账号、对端和 `bindings` 确定路由，模型不自行选择回复渠道。直接消息、群组、频道和线程使用不同 session key 形状，JunQi 不得把同名联系人跨渠道自动合并。

### 6.2 多账号

多数现代渠道插件支持 `accounts.<id>` 或等价账号配置。是否支持多账号及其默认账号语义必须从插件 schema 和 capability 读取。JunQi 不能为不支持多账号的插件生成第二个本地账号，也不能让一个账号的健康状态确认另一个账号已连接。

### 6.3 私聊与群组访问控制

OpenClaw 通用模型包括 DM pairing、allowlist、group policy、群组 allowlist、发送者 allowlist 和 mention gating。具体字段和默认值可能由插件收紧。DM pairing 只授权直接消息，不会自动授权群组消息。

### 6.4 媒体、反应、线程与动作

官方总览只保证所有渠道支持文本。媒体、反应、编辑、删除、投票、线程、卡片、语音和文件必须分别读取 `channels capabilities` 的 `support` 与 `actions`，并结合目标账号和会话类型核验。JunQi 不维护按渠道名写死的动作表。

### 6.5 目录解析与主动发送

支持目录的插件可以通过 `openclaw channels resolve` 将用户、群组或频道名称解析为稳定目标。解析是只读操作，不会安装插件。主动发送仍需明确的 channel、account 和 target，不能把上一次会话目标当成全局默认。

### 6.6 可靠性与死信

部分渠道对入站事件提供持久队列、去重和重试，但保证范围由各插件说明。OpenClaw 的 dead-letter 命令可以检查失败事件；JunQi 不应从会话列表缺少新消息推断渠道离线，也不应在结果未知时自动重放有副作用的发送。

## 七、JunQi 当前适配规则

### 7.1 目录与安装

- JunQi 每次从当前选定 Runtime 执行 `channels list --all --json`，不维护另一份静态渠道清单。
- 官方目录返回的 bundled、configured 和 installable 条目原样进入 UI。
- 当前只有 `dingtalk-connector` 是 JunQi 在 Rust 可信边界中明确审查的额外 managed install。前端不能提交任意 npm 包名。
- 安装完成后必须重新读取 OpenClaw 目录，只有插件实际加载并报告 `installed: true` 才算安装成功。

### 7.2 配置与状态

- 配置表单来自安装插件的 schema，不按渠道名称硬编码字段。
- capability 来自 `channels capabilities --channel <id> --json`。渠道状态优先通过 Gateway 的官方 `channels.status` 请求读取，只有该请求不可用时才由所选 Runtime 的正式 CLI 适配层执行 `channels status --probe --json`。
- “已安装”“已配置”“已登录”“运行中”“已连接”和“探测通过”必须分别展示。
- 账号路由由 OpenClaw `bindings` 拥有，JunQi 只做可视化编辑与核验。
- 渠道中心采用紧凑的目录与详情双栏：左侧只负责筛选、选中和汇总，右侧展示账号、路由、连接操作与 Runtime 证据；渠道目录使用独立对话框，不在主页面堆叠所有安装入口。
- 添加渠道、账号字段、安装状态、图标和授权方式全部来自当前所选 Runtime 的目录、schema 与 capability。JunQi 不维护渠道专属凭据字段，也不根据渠道名称推断缺失凭据。
- 后台探测期间保留上一份渠道快照并显示局部加载状态，避免刷新时整页闪烁。用户主动探测只更新目标渠道，不以固定定时器重复刷新所有状态。
- 配置保存只调用全局 Gateway 生命周期协调器。渠道页不提供第二套 Gateway 重启、重试或诊断入口；保存后的重启结果与状态刷新必须保持真实失败语义。
- Runtime 原始状态与脱敏日志默认折叠，作为核验依据按需展开；主要操作区不重复显示调试字段，也不把日志内容解释成成功状态。

### 7.3 Wizard 与二维码

- 完整首次配置继续使用 OpenClaw 官方 `wizard.start` setup 流程，渠道步骤由当前插件动态提供。
- 正式 `externalUrl` 可以本地编码成二维码；当前步骤只有一个明确 HTTPS 地址时，可以作为不改变协议状态的展示派生数据。
- 渠道 capability 同时声明 `web.login.start` 与 `web.login.wait` 时，渠道中心可以使用内嵌 QR 对话框。
- 终端 ASCII 二维码、日志片段和渠道名称都不是结构化二维码契约，JunQi 不从这些内容恢复扫码状态。
- `web.login.wait` 返回新 `qrDataUrl` 时，JunQi 在同一有界等待窗口中替换二维码并继续监听；返回未连接且没有新二维码时停止自动请求，保留插件消息并允许用户显式继续监听或重新生成。
- `web.login.start` 或 `web.login.wait` 返回 `connected: true` 时，扫码流程直接进入官方成功终态。随后刷新渠道状态只更新运行观测，不得把传播延迟或探测失败改写成扫码失败。
- OpenClaw 当前没有通用结构化二维码过期状态。JunQi 不从插件消息、等待时长或本地截止时间推断二维码已过期。

相关实现：

- [`src/services/openclawChannelRuntime.ts`](../../src/services/openclawChannelRuntime.ts)
- [`src/pages/ChannelsCenter/ChannelListPanel.tsx`](../../src/pages/ChannelsCenter/ChannelListPanel.tsx)
- [`src/pages/ChannelsCenter/ChannelDetailPanel.tsx`](../../src/pages/ChannelsCenter/ChannelDetailPanel.tsx)
- [`src/pages/ChannelsCenter/ChannelCatalogDialog.tsx`](../../src/pages/ChannelsCenter/ChannelCatalogDialog.tsx)
- [`src/pages/ChannelsCenter/ChannelAccountDialog.tsx`](../../src/pages/ChannelsCenter/ChannelAccountDialog.tsx)
- [`src/services/channelQrLogin.ts`](../../src/services/channelQrLogin.ts)
- [`src/pages/ChannelsCenter/ChannelQrLoginDialog.tsx`](../../src/pages/ChannelsCenter/ChannelQrLoginDialog.tsx)
- [`src/pages/SetupPage/wizard/WizardAuthorizationHint.tsx`](../../src/pages/SetupPage/wizard/WizardAuthorizationHint.tsx)
- [OpenClaw Wizard 流程](../installation/openclaw-wizard-start-flow.md)
- [OpenClaw 渠道二维码生命周期审计](../quality/openclaw-channel-qr-lifecycle-audit-2026-08-11.md)

## 八、禁止推断

- 不因渠道出现在 OpenClaw 文档中就显示为当前 Runtime 已安装。
- 不因插件安装成功就显示为账号已配置或已连接。
- 不因平台支持扫码就假定插件提供结构化二维码。
- 不因一个账号健康就确认同渠道其他账号健康。
- 不把飞书扫码创建机器人、QQ Bot 扫码绑定、钉钉扫码授权、WhatsApp 设备链接和 Signal CLI 链接当成同一种状态机。
- 不把钉钉消息连接器与 JunQi DWS 业务工具合并为一个权限或健康状态。
- 不为外部插件补写凭据、成功状态、群聊能力、媒体能力或本地化文本。
- 不从 `hello-ok.features.methods` 未列出某方法推断方法一定不支持；应在身份和权限核验后按正式请求契约调用，并依据结构化响应判断。

## 九、验证清单

对任一渠道宣称“可用”前，至少完成：

1. 当前 Runtime 的 `channels list --all --json` 能发现该渠道。
2. 插件已安装且来源、版本或完整性记录可追溯。
3. `channels capabilities` 能返回当前 schema、support、actions 和 Gateway 方法。
4. 账号配置未把 secret 写入日志、Markdown 或前端持久存储。
5. `channels status --probe` 对目标 account 返回真实运行结果。
6. 入站与出站各完成一次真实平台测试。
7. 私聊、群聊、mention、pairing 与 allowlist 按渠道实际能力验证。
8. 媒体、线程、反应、卡片或语音只在对应 capability 存在时测试和展示。
9. 多账号情况下分别核验账号状态与 Agent binding。
10. 扫码流程验证刷新、过期、取消、扫码后探测失败和 Gateway 重连。

## 十、当前未验证边界

- 本文完成了上游源码与官方插件文档核对，没有在所有 31 个渠道上建立真实第三方账号。
- 外部插件可以独立发布新版本；WeChat、WeCom、Yuanbao、Zalo ClawBot 和 DingTalk 的细节必须在实际安装版本上再次核验。
- Feishu、QQ Bot 和 DingTalk 当前有扫码流程，但没有统一向 JunQi 返回结构化二维码数据；若上游以后增加 `externalUrl`、`deviceCode` 或 Gateway login 方法，应以新契约替换当前终端输出路径。
- Windows、macOS 和 Linux 上的系统权限、凭据存储、webhook 可达性和二维码真机扫描尚需分别验收。
