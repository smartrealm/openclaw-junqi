# OpenClaw 渠道二维码生命周期审计

## 范围与依据

本次审计覆盖渠道中心从能力发现、`web.login.start`、二维码显示、`web.login.wait`、二维码轮换、扫码终态到渠道状态刷新的完整链路。协议依据为 OpenClaw 最新主线的 Gateway handler、渠道适配器类型、WhatsApp 插件、Control UI 与 macOS 客户端；本地安装版本只用于复现，不作为能力开关。

## 严重问题

### BUG-QR-01：客户端用第二套状态门禁覆盖官方成功回调

位置：`src/services/channelQrLogin.ts`

当前行为：插件返回 `connected: true` 后，JunQi 继续把 `channels.status` 探测结果作为是否进入成功状态的门禁。探测传播延迟或临时失败会把官方已完成的扫码结果降级成 `qr_not_ready` 或 `qr_status_failed`。

影响：用户已经完成扫码，界面仍显示失败；二维码被清除后也没有可恢复的官方登录会话。

目标：`web.login.start` 或 `web.login.wait` 的 `connected: true` 是扫码流程的官方终态。渠道状态刷新是终态后的独立观测，不得改写扫码结果。

### BUG-QR-02：客户端十分钟轮询与过期状态没有上游契约

位置：`src/services/channelQrLogin.ts`

当前行为：JunQi 在插件一次等待返回后继续循环十分钟，并在本地截止时间到达时宣称二维码过期。OpenClaw 的等待结果没有结构化过期字段，插件可能用同样的 `connected: false` 表达仍在等待、没有活动登录、登录失败或二维码过期。

影响：客户端可能把仍有效的二维码误报为过期，也可能在插件已经结束会话后继续发起等待请求。

目标：采用 OpenClaw 原生 macOS 客户端的有界等待窗口。只在官方结果返回新二维码时继续等待；官方返回 `connected: false` 且没有新二维码时停止自动请求，保留当前二维码和原始消息，并允许用户显式继续等待或重新生成二维码。

## 中等问题

### BUG-QR-03：返回值缺少运行时类型校验

位置：`src/services/channelQrLogin.ts`

当前行为：任意对象都会被当作二维码结果，错误类型的 `message`、`connected` 或 `qrDataUrl` 被静默降级成等待状态。

目标：按官方结果类型校验已知字段。结果不是对象、必需字段缺失、字段类型错误或二维码不是受限 PNG data URL 时明确进入请求失败状态，不用默认值掩盖协议漂移。

### BUG-QR-04：等待、等待结束与刷新操作没有独立语义

位置：`src/pages/ChannelsCenter/ChannelQrLoginDialog.tsx`

当前行为：`waiting` 同时表示二维码可见和请求正在进行，刷新按钮在整个等待期间禁用；等待请求返回后客户端又立即循环，用户无法选择继续等待或重新生成。

目标：界面分别呈现准备二维码、正在监听、等待已暂停、已连接和失败。等待已暂停时提供“继续等待”和“生成新二维码”；两者分别调用 `web.login.wait` 与 `web.login.start`。官方等待请求进行期间不并发发起新的开始请求。

### BUG-QR-05：Wizard 后续步骤被普通链接误判为授权二维码

位置：`src/pages/SetupPage/wizard/WizardAuthorizationHint.tsx`

当前行为：旧实现会把任意当前 Wizard step 正文中唯一的 HTTPS 地址投影为二维码。授权完成后的说明步骤只要包含一个文档链接，界面就会继续显示二维码，看起来像上一授权步骤没有结束。

目标：结构化 `externalUrl` 只绑定其所属官方步骤；旧插件 note fallback 只接受唯一、带非空 `user_code` 的 HTTPS 一次性授权地址。步骤标识变化、提交等待、终态、取消或失败后不保留上一二维码，也不把普通说明链接当成授权入口。

## 实施结果

- 删除二维码会话专用的 `channels.status` 验证器和客户端状态方法。官方 `connected: true` 直接进入成功状态，父级随后刷新渠道快照，刷新结果不回滚扫码终态。
- 删除十分钟循环、客户端过期状态、固定轮询延迟及其专属错误文案。单次监听按 OpenClaw macOS 客户端使用 120 秒有界窗口，只在收到轮换二维码时继续。
- 开始结果按官方 `message`、可选 `qrDataUrl` 和可选 `connected` 校验；等待结果按必需 `message`、必需 `connected` 和可选 `qrDataUrl` 校验。错误形状不再静默变成等待。
- 对话框复用共享 Radix Dialog、`QrCodeDisplay` 和 `LoadingIndicator`，补齐准备、监听、暂停、成功和错误状态，以及继续监听与重新生成操作。
- 对话框关闭和组件重建使用代际围栏隔离旧请求结果；官方等待期间拒绝并发开始请求。OpenClaw 没有取消方法，因此 JunQi 不发送伪造的取消 RPC。
- Wizard 授权二维码只从当前步骤的结构化 `externalUrl` 或带 `user_code` 的一次性授权地址派生；后续说明步骤的普通 HTTPS 链接不再生成二维码。

## 自动化验证

- 渠道二维码状态机和 Gateway 客户端定向测试 14 项通过。
- 完整 `pnpm test` 通过，共 2780 项测试通过。
- `pnpm lint` 通过：模块边界、版本一致性和 TypeScript 类型检查均通过。
- `pnpm build` 通过：协作插件、钉钉业务插件、TypeScript 与 Vite 生产构建完成。
- `git diff --check` 通过。

## 未验证边界

- OpenClaw 当前通用 Web 扫码协议只由实际声明 `web.login.start` 与 `web.login.wait` 的渠道插件提供。JunQi 不按渠道名称推断扫码能力。
- 插件返回的 `message` 继续原样展示并做脱敏，不从文本推断过期、失败或成功。
- 真实 WhatsApp、Zalo Personal 及未来声明相同方法的插件仍需分别完成扫码、二维码轮换和多账号真机验证。
