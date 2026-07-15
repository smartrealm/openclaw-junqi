# OpenClaw Channels 官方可视化修复规格

## BUG-CH-01/02 - 动态目录与 schema

**Current**：静态渠道模板决定可见渠道和字段。

**Target**：`channels list --all --json` 是目录真相源；已安装插件的 `channels capabilities --channel ... --json` 提供配置 schema 与能力。

**Acceptance**：
- [x] UI 展示官方 configured/installed/installable 目录及 OpenClaw 版本。
- [x] 已安装渠道字段由 schema 渲染，未知字段读写无损。
- [x] installable 渠道不直接写 JSON，而进入官方安装/设置向导。

## BUG-CH-03 - 官方智能体绑定

**Current**：绑定写入渠道/账户 `agentId`。

**Target**：绑定写入根级 `bindings[]` route 项，按 channel/accountId 匹配。

**Acceptance**：
- [x] 新建、修改、清除绑定均生成官方合法配置。
- [x] peer、guild/team、role 与 ACP binding 不被覆盖。
- [x] 旧内嵌 `agentId` 可读取并在下一次保存时迁移清理。

## BUG-CH-04 - 登录、链接与二维码

**Current**：二维码只是禁用说明。

**Target**：Web QR 使用 Gateway 官方 start/wait/logout；其他 TTY/浏览器/设备链接流程运行官方 CLI。

**Acceptance**：
- [x] WhatsApp 可在 UI 显示二维码、等待扫描、刷新二维码和退出。
- [x] Feishu、Zalo User、Signal 等官方链接/二维码向导可从渠道页启动。
- [x] 命令参数经过白名单校验并兼容 Windows/macOS shell。
- [x] 取消、超时、二维码更新和 Gateway 离线均有可恢复状态。

## BUG-CH-05/06/09 - 官方生命周期与状态

**Current**：添加只改 JSON，就绪状态靠静态字段猜测。

**Target**：官方目录、status/probe、capabilities、logs 和 Gateway start/stop/logout 构成账户生命周期。

**Acceptance**：
- [x] 状态展示 configured/linked/running/connected/probe/lastError。
- [x] 可按渠道 probe，并查看该渠道官方日志。
- [x] 账户启动、停止、退出后刷新官方状态。

## BUG-CH-07 - 凭据安全

**Current**：可复制包含明文凭据的整个渠道对象。

**Target**：诊断与复制统一递归脱敏；秘密字段不自动回填到普通文本控件。

**Acceptance**：
- [x] token/secret/password/key/cookie/authorization 字段不会进入剪贴板或诊断。
- [x] SecretRef 只显示引用，不读取真实值。
- [x] 回归测试覆盖嵌套账户与数组对象。

## BUG-CH-08 - 共享抽象

**Current**：渠道中心和配置管理器分别维护模板逻辑。

**Target**：共享官方运行时、schema 提取、binding mutation、命令生成和脱敏模块。

**Acceptance**：
- [x] 两个入口使用同一目录/schema 与 mutation。
- [x] 不再存在 `dingtalk` 错误字段特判。
- [x] 新插件无需修改页面主流程即可进入目录和官方向导。
