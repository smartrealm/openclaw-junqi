# OpenClaw Wizard 版本协商审计

日期：2026-08-14

## 审计范围

- OpenClaw 官方主线 `packages/gateway-protocol/src/schema/wizard.ts`
- OpenClaw 官方主线 `src/gateway/server-methods/wizard.ts`
- 本机官方 stable `openclaw@2026.7.1-2` 的发布包 schema、handler 与 setup runner
- JunQi `OpenClawWizardClient`、首次设置状态机、步骤渲染和渠道配置入口

## 权威证据

- 官方主线提交 `c2269f7a6c4115972496e1a5ae1a79ad9af457ae` 的 `WizardStartParamsSchema` 接受 `mode`、`workspace`、`installDaemon`、`flow` 和 `channel`。
- 本机官方 stable `2026.7.1-2` 的发布包 `WizardStartParamsSchema` 只接受 `mode` 和 `workspace`，并以封闭对象拒绝额外字段。
- stable 的 `wizard.start` handler 在 schema 校验通过后才创建 `WizardSession`。因此精确的 `INVALID_REQUEST: unexpected property 'installDaemon'` 能证明该请求没有创建会话，也没有进入 setup runner。
- 真实 stable Gateway 已复现：带 `installDaemon:false` 的请求被上述 schema 拒绝；随后只带 `mode:local` 的请求成功返回官方 `note` 步骤和 sessionId，并可由 `wizard.cancel` 正常取消。
- stable QuickStart 在未接收 `installDaemon` 时默认进入官方 daemon 分支；已有服务由官方步骤让用户选择 restart、reinstall 或 skip。JunQi 不得把省略字段描述为已经关闭 daemon 分支。

## 分级发现

### WIZ-COMPAT-01 · P0 · 主线新增参数阻断当前 stable 官方 Wizard

位置：`src/services/openclawWizard.ts`

当前实现把主线新增的可选 `installDaemon:false` 作为所有 Runtime 都必须接受的参数。stable 在创建会话前拒绝该字段，导致一个实际可用的官方 Wizard 被 JunQi 判定为整体不兼容。

影响：

- 当前 npm stable 无法进入 JunQi 的 Classic Wizard 配置界面。
- 用户看到需要更新或协议不兼容，但同一 Runtime 使用公共参数可以正常返回官方步骤。

修复：首次 setup 启动先发送主线参数；只在精确的 schema 拒绝上自动重试一次 stable 公共参数。权限、连接、超时、其他字段拒绝和业务错误均不得重试。

### WIZ-COMPAT-02 · P1 · 安全协商错误被暴露为永久协议不兼容

位置：`src/hooks/useSetupFlow/useWizardSession.ts`、`src/pages/SetupPage/WizardScreen.tsx`

当前实现把精确字段拒绝分类为 `protocol-incompatible`，隐藏恢复操作并要求用户返回 Guided。该状态建立在“省略字段不安全”的旧判断上，与 stable handler 的校验顺序和真实运行结果冲突。

修复：字段协商由 `OpenClawWizardClient.start` 内部完成；删除无消费者的永久不兼容恢复模式、专属 UI、文案和测试。

### WIZ-COMPAT-03 · P1 · 文档错误声称所有 Classic Wizard 都已关闭 daemon 分支

位置：首次安装流程、规格、预览和项目状态文档。

主线接受 `installDaemon:false` 时该描述成立；stable 省略字段后不成立。stable 的 daemon 行为仍由官方 Wizard 步骤拥有。

修复：文档明确区分主线显式关闭与 stable 公共参数兼容模式，不把上游没有暴露的控制能力描述为 JunQi 已实现。

## 已核验而不修改的边界

- stable 与主线共有的七种 Wizard 步骤类型均已有通用渲染器。
- 主线新增的 `externalUrl`、`deviceCode`、`channels`、`accounts` 和 `preparedModelRef` 已按可选增量字段解析。
- stable 不支持渠道专用 `flow/channel` 参数；现有渠道中心会识别该结构化拒绝并转到官方终端配置入口，本轮不为 stable 伪造渠道 Wizard RPC。
- 其他客户端正在运行的 Wizard、会话丢失和未知终态继续使用现有恢复围栏，不因启动参数协商而自动重放答案或配置写操作。

## 验收

- 主线形状一次请求携带 `installDaemon:false` 并正常启动。
- stable 精确拒绝后只重试一次 `{mode:'local', workspace?}` 并采用真实官方返回。
- 其他错误只发送一次请求并原样失败。
- 首次设置不再显示 `installDaemon` 永久协议不兼容状态。
- stable daemon 分支在文档和界面中保持官方步骤拥有的真实语义。

## 官方依据

- [Wizard 协议 schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/wizard.ts)
- [Gateway Wizard handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/wizard.ts)
- [官方 Wizard 参考](https://github.com/openclaw/openclaw/blob/main/docs/reference/wizard.md)
