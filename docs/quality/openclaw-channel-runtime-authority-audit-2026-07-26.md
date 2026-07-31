# OpenClaw 渠道 Runtime 权威源全仓审计（2026-07-26）

## 审计契约

除钉钉外部插件的一键安装白名单和旧版钉钉配置迁移外，JunQi 不得维护渠道 ID、渠道全集、默认渠道、字段 schema、凭据要求、能力、排序、状态或登录方式。所有当前渠道事实必须来自用户当前选中的 OpenClaw Runtime；Runtime 不可用时应明确降级，不能用 JunQi 静态数据替代。

本审计不读取本机 OpenClaw 的渠道结果作为实现依据，只检查 JunQi 仓库源码的数据来源和降级行为。

## [critical] BUG-CRA-01 · 静态渠道模板参与配置和状态判断

**位置**：`src/pages/ConfigManager/channelTemplates.ts`、`src/services/channelConfig.ts`、`src/pages/ChannelsCenter/index.tsx`

JunQi 静态维护多个渠道的凭据字段、默认 policy、streaming、媒体大小和多账号能力，并用于新配置、readiness 和编辑器初值。OpenClaw 插件升级后可能被 JunQi 写入旧默认值或判错。

**修复**：删除非钉钉静态模板；配置字段只读取 Runtime capability schema；通用新建只写必要的 UI 字段；Runtime 状态未知时不猜凭据。

## [critical] BUG-CRA-02 · 首次安装向导内置飞书协议

**位置**：`src-tauri/src/commands/channel_enrollment.rs`、`src/services/channelEnrollment.ts`、`src/services/feishuQrWizardBridge.ts`、`src/pages/SetupPage.tsx`

JunQi 内置飞书注册端点、协议字段和 OpenClaw 向导步骤启发式。这既绕过当前 Runtime capability，又会随飞书/OpenClaw 协议漂移。

**修复**：删除飞书专项 enrollment 和步骤识别；首次安装向导原样渲染当前 OpenClaw wizard；只保留与渠道无关的本地 QR 内容渲染器。

## [critical] BUG-CRA-03 · 日历固定投递渠道并默认 Telegram

**位置**：`src/pages/Calendar/calendarTypes.ts`、`src/pages/Calendar/EventModal.tsx`

日历只允许五个 JunQi 写死的渠道，并默认 Telegram。当前 Runtime 新增、删除或禁用渠道不会反映。

**修复**：投递渠道 ID 改为动态字符串；选项来自当前 Runtime status；保留 `last` 作为 OpenClaw 通用路由语义；Runtime 不可用时只保留 `last` 和既有事件值。

## [medium] BUG-CRA-04 · Agent 页固定飞书和旧钉钉快捷创建

**位置**：`src/pages/AgentHub/AgentSettingsPanel.tsx`

Agent 页静态创建飞书和旧 `dingtalk` 配置，并写入静态默认字段。

**修复**：删除静态快捷创建，统一跳转动态渠道中心并携带 Agent ID。钉钉安装和迁移仍由受审专用链路处理。

## [critical] BUG-CRA-06 · 遗留 Telegram 配对命令绕过 Runtime

**位置**：原 `src-tauri/src/commands/pairing.rs`

Native 层直接读写 Telegram 专属 pairing/allowFrom 文件，前端没有调用但仍注册为 Tauri command。该死链绕过 OpenClaw 当前 Runtime API，并可能写入已变化的内部文件格式。

**修复**：删除整个遗留模块、command 注册和测试；Gateway 设备配对继续使用现有 Runtime 通用 token/approval 流程。

## [medium] BUG-CRA-05 · 名称、图标和 known 状态依赖模板

**位置**：渠道中心、Config Manager、Agent Hub

显示名称、图标和 known 状态仍读取 JunQi 模板。

**修复**：名称优先使用 Runtime `channelLabels`/capability metadata，否则显示原始 ID；图标使用 ID 派生占位；known 只由当前 Runtime catalog 判断。

## 允许保留的例外

- `dingtalk-connector` 到受审 npm spec 的 Native + renderer 双重安装白名单。
- 旧 `dingtalk`、旧凭据字段到 `dingtalk-connector` 的兼容迁移。
- 测试中用于证明“非钉钉渠道不在白名单”的任意示例字符串。
- 技能分类、文案翻译、第三方品牌文字等不参与 OpenClaw 渠道发现或配置的数据。
