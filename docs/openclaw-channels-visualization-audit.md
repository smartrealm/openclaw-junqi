# OpenClaw Channels 可视化链路审计

审计基线：本机 OpenClaw `2026.7.1 (2d2ddc4)` 的 `channels` CLI、Gateway `channels.*` / `web.login.*` 方法、动态插件目录与配置 schema。范围覆盖渠道发现、安装/添加、账户配置、智能体路由、登录/二维码、探测、日志、退出和删除。

## 结论

当前页面不是 OpenClaw 官方 Channels 的完整可视化。它以 10 个静态模板直接修改 JSON，未接入官方动态目录、插件 schema、运行状态、probe、login/logout、二维码或渠道日志；部分静态键已经与当前官方插件契约冲突。现有“绑定智能体”还把 `agentId` 写进渠道对象，而官方要求根级 `bindings[]`，在官方写盘校验启用后会被拒绝。

## 严重问题

### BUG-CH-01 · CRITICAL - 渠道目录与官方插件目录脱节

**位置**：`src/pages/ConfigManager/channelTemplates.ts`

页面只维护 Feishu、DingTalk、Telegram、Discord、WhatsApp、Slack、Google Chat、Mattermost、Signal、iMessage。当前官方 `channels list --all --json` 返回 30 多个 configured/installable 渠道，且目录会随插件安装变化。

**影响**：官方已支持或已安装的插件在 UI 中不可见；新增插件必须修改 React 代码。

**修复**：运行时读取官方目录并显示 configured/installed/installable 来源，静态元数据只作为离线名称和视觉兜底。

### BUG-CH-02 · CRITICAL - 静态字段会写入错误的官方配置路径

**位置**：`src/pages/ConfigManager/channelTemplates.ts`、`src/pages/ChannelsCenter/index.tsx`、`src/services/channelConfig.ts`

例如当前钉钉模板使用 `dingtalk` 与 `appKey/appSecret/robotCode`，本机官方插件 ID 是 `dingtalk-connector`，凭据字段是 `clientId/clientSecret`。页面还只覆盖少量字段，无法表达插件的账户 schema。

**影响**：配置无法通过官方校验，或看似保存但插件完全不读取。

**修复**：已安装渠道从 `channels capabilities --channel <id> --json` 提取官方 schema；未知嵌套字段使用结构化编辑并保持无损。

### BUG-CH-03 · CRITICAL - 智能体绑定写入非官方字段

**位置**：`src/services/channelConfig.ts:85`、`src/services/channelConfig.ts:158`

当前读取和写入 `channels.<channel>.agentId` / `accounts.<id>.agentId`。OpenClaw 2026.7.1 使用根级 `bindings[]`，匹配结构为 `{ agentId, match: { channel, accountId? } }`。

**影响**：绑定保存会被 `additionalProperties: false` 拒绝；旧数据即使存在也不会按官方规则路由。

**修复**：统一通过根级 route binding 读取、更新和删除；迁移时清理旧 `agentId`，同时保留 peer/ACP 等更具体 binding。

### BUG-CH-04 · CRITICAL - 登录与二维码链路完全缺失

**位置**：`src/pages/ChannelsCenter/index.tsx:388`

页面把二维码授权展示为禁用说明，没有调用官方 `channels login` 或 Gateway `web.login.start` / `web.login.wait`。官方当前为 WhatsApp 和 Zalo User 提供 web QR 适配器，Feishu/WhatsApp/Zalo User 具有登录或设置向导，Signal 设置流程也包含设备链接二维码。

**影响**：无需令牌、必须扫码或必须链接的渠道无法从桌面端完成配置。

**修复**：WhatsApp 使用 Gateway data URL 在 UI 内显示并自动等待；其他官方登录/链接流程通过应用终端运行原生命令，保留完整 TTY、二维码和浏览器交互。

## 高风险问题

### BUG-CH-05 · HIGH - 添加安装型渠道绕过官方安装/设置向导

**位置**：`src/services/channelConfig.ts:192`、`src/pages/ChannelsCenter/index.tsx:709`

点击添加只创建一个静态 JSON 节点，不安装插件，也不运行 setup adapter。

**影响**：installable 渠道会变成无效配置，依赖、认证目录和插件启用状态均缺失。

**修复**：installed 渠道可进入 schema 配置；installable 渠道统一运行官方 `channels add --channel <id>` 向导。

### BUG-CH-06 · HIGH - 就绪状态是模板猜测，不是官方 probe

**位置**：`src/services/channelConfig.ts:96`

当前仅检查几个静态字段和本地 `agentId`，没有读取 `channels.status` 的 configured/linked/running/connected/probe/audit/lastError。

**影响**：错误凭据可能显示“就绪”，已链接的免密渠道可能显示“缺少凭据”。

**修复**：状态以 Gateway `channels.status` 为主，CLI JSON 为离线兜底；用户可显式执行 probe。

### BUG-CH-07 · HIGH - 复制配置会泄露渠道凭据

**位置**：`src/pages/ChannelsCenter/index.tsx:976`

“复制”按钮把整个渠道配置原样写入剪贴板，其中可能含 bot token、app secret、password 或 SecretRef 细节。

**影响**：凭据可能进入聊天、工单、剪贴板历史或远程协助工具。

**修复**：复制诊断前递归脱敏敏感字段；密码输入不回显已有秘密，SecretRef 保持引用对象。

### BUG-CH-08 · HIGH - 两套渠道页面重复且语义漂移

**位置**：`src/pages/ConfigManager/ChannelsTab.tsx`、`src/pages/ChannelsCenter/index.tsx`

两个页面各自维护字段、默认值和多账户逻辑，已经出现钉钉字段、streaming 表示和二维码文案差异。

**影响**：同一配置在两个入口表现不同，修复容易只落到其中一个页面。

**修复**：目录、schema、命令、状态、绑定和脱敏逻辑下沉为共享服务；配置管理器复用同一官方 schema 编辑器。

## 中等问题

### BUG-CH-09 · MEDIUM - 缺少官方 capabilities、日志、resolve 与生命周期操作

**位置**：`src/pages/ChannelsCenter/index.tsx`

页面只有本地 Gateway 日志与整体重启，没有渠道级 capabilities、probe、start/stop/logout、渠道日志或名称解析入口。

**修复**：账户行提供 probe、启动/停止、登录/退出；渠道详情提供能力摘要和官方渠道日志，名称解析作为 allowlist/binding 输入的后续扩展点保留在统一运行时 API。
