# 首次设置前置门禁审计

## 依据

- OpenClaw 官方发布渠道说明将 `stable` 定义为推荐给大多数用户的 npm `latest` 渠道，将 `extended-stable` 定义为受支持月份内的滞后稳定渠道；`beta` 是候选构建，`dev` 是实验主线且不应在生产环境运行：[Release channels](https://docs.openclaw.ai/install/development-channels)。
- OpenClaw 官方更新说明确认 `openclaw update --channel <stable|beta|dev>` 会改变持久化渠道，并且渠道切换可能降级；客户端不能替用户静默切换：[Updating OpenClaw](https://docs.openclaw.ai/install/updating)。
- OpenClaw 官方发布策略将 `YYYY.M.PATCH-N` 定义为 regular fallback correction release，不是 beta 后缀：[Release policy](https://docs.openclaw.ai/reference/RELEASING)。
- 2026-08-14 分别查询 npm 官方 registry 与 npmmirror：两者的 `latest` 均指向 `2026.7.1-2`，`beta` 均指向 `2026.8.1-beta.1`。本机官方 updater dry-run 同时返回 `effectiveChannel: stable`、`tag: openclaw@latest`、`currentVersion: 2026.7.1-2` 与 `targetVersion: 2026.7.1-2`。因此 `2026.7.1-2` 是官方 stable 修订，国内镜像没有漏掉 `latest`。
- OpenClaw npm `latest` 2026.7.1-2 的正式 `WizardStartParamsSchema` 只接受 `mode` 与 `workspace`，但同一稳定包正式注册了 `crestodian.setup.detect`、`crestodian.setup.activate` 与 `crestodian.chat`。其中 detect 返回候选、手工 Provider、工作区与 `setupComplete`；activate 真实调用模型并且只在成功后持久化。
- 最新官方文档把上述结构化流程重命名为 `openclaw.setup.detect` 与 `openclaw.setup.activate`，仍明确规定 activate 先执行真实模型调用、成功后才持久化：[OpenClaw setup agent](https://docs.openclaw.ai/cli/openclaw)。
- JunQi 必须依据当前 Runtime 的结构化响应判断实际支持，不使用版本号作为能力开关。

## 缺陷

### BUG-01 · 严重 · 更新检查没有成为 Wizard 前置操作

`OpenClawUpdatePanel` 位于会自动离开的 `gateway-stopped` 页面，且检查结果不约束“核验配置”。已有安装可以未经检查直接进入 Wizard。

2026-08-14 交互复核：更新检查不能作为 Gateway 就绪页内的附属卡片。已有 Native 安装必须在“正在配置 JunQi Desktop”完成后进入独立更新步骤，再进入官方配置；本次新安装不重复检查。

### BUG-02 · 严重 · 协议拒绝被当成可重复恢复

当前 Runtime 以 `INVALID_REQUEST` 拒绝 `wizard.start.installDaemon` 后，界面仍提供“重新核验”，再次发送完全相同的无效请求。省略字段也不安全：当前稳定版 QuickStart 在未显式指定时默认进入 Gateway service 安装或重启分支。

后续复验更正：stable handler 在 schema 校验通过后才创建 Wizard session。真实 stable Gateway 证明该精确字段拒绝没有创建会话，而只带 `mode:local` 的公共参数可以启动并取消官方 Wizard。因此修复已改为严格参数协商：主线请求仍带 `installDaemon:false`；只有上述精确零副作用拒绝才在操作仍有效时省略该字段重试一次。stable 的 daemon 分支继续由官方 Wizard 步骤拥有，JunQi 不再把它描述为已关闭。完整证据见 [Wizard 版本协商审计](openclaw-wizard-version-negotiation-audit-2026-08-14.md)。

### BUG-03 · 中等 · 数据位置表单被容量统计阻塞

未配置状态下，`get_storage_setup_status` 在返回表单所需路径前递归统计整个旧 OpenClaw 目录。本机目录约 1.9 GB、37032 个条目；容量仅用于辅助展示，不应阻塞可编辑表单。

### BUG-04 · 严重 · 漏掉稳定版官方 Guided 方法导致错误阻断

JunQi 只调用最新版文档中的 `openclaw.setup.detect`。稳定版返回 unknown-method 后，客户端直接退到 Classic Wizard，再发送该稳定版 schema 不接受的 `installDaemon`，最终错误显示“等待稳定更新”。这忽略了同一 stable Runtime 已提供的 `crestodian.setup.*` 正式结构化协议。

修复后，客户端先调用最新版 `openclaw.setup.detect`；只有精确 unknown-method 才继续调用稳定版正式 `crestodian.setup.detect`。任一方法成功后，后续 activate 与 chat 绑定到该方法族；连接、权限、非法响应与业务失败都不能触发换名重试。只有两个 detect 均明确 unknown-method 才进入 Classic。稳定方法族的 activate 请求严格按其封闭 schema 省略 `modelRef`，并将 activate 返回的真实模型调用成功作为本次配置交接证据，不伪造不存在的 `setup.verify`。

Classic Wizard 的 `installDaemon` 字段差异由服务层安全协商，不再暴露为永久协议不兼容。其他真实错误仍在当前准备边界呈现，不导航到更新页。更新页只服务于本次设置开始前已有的 Native 安装；更新结果不能充当协议兼容性证据。

### BUG-05 · 严重 · 受管更新跟随 beta 或 dev 渠道

新安装已经通过官方 npm `latest` 解析目标；按官方发布渠道契约，这就是 stable，不需要客户端再从版本字符串猜测渠道。缺陷位于已有安装：更新直接执行当前持久化渠道的官方 updater；只要本地此前切到 `beta` 或 `dev`，JunQi 就会继续检查并安装该渠道版本。界面也只展示渠道名称，没有阻止进入配置。

修复后，新安装继续只解析官方定义为 stable 的 npm `latest`，不增加版本名推断。已有安装的受管检查保留真实渠道结果，但只有 `stable` 与 `extended-stable` 可进入更新和后续配置；未知渠道同样失败关闭。Rust 更新 command 在停止 Gateway 或替换软件包前再次执行同一门禁，前端不能绕过。

JunQi 不自动把现有 `beta` 或 `dev` 切回 stable。官方说明指出渠道切换会持久化并可能降级，因此界面只链接官方说明，等待用户显式完成切换后重新检查。

### BUG-06 · 严重 · 自动候选激活异常阻断手动配置

Windows 首次安装实测中，稳定 Runtime 的 `crestodian.setup.activate` 自动探测 `minimax` 时先报告临时推理 Agent 缺少 API Key，随后清理临时 SQLite `-shm` 文件返回 `EBUSY`。这是官方激活请求的异常终态，不是 JunQi 可以解释为“未执行”或“配置成功”的结果。

修复后，自动候选梯子在任一激活请求异常时立即停止，不重试该请求，也不继续调用下一个候选。JunQi 保留同一次 `detect` 的官方候选、认证方式和手动 Provider 入口，在选择界面内呈现原始诊断。用户可显式选择另一条官方路径；成功仍只以 OpenClaw 的结构化激活回执与后续交接核验为准。

## 未验证边界

- 本机已真实调用 `openclaw.setup.detect` 并得到结构化 unknown-method，再调用 `crestodian.setup.detect` 成功返回配置完成状态与真实候选；为避免改变现有用户配置，没有在开发机上执行有写入副作用的 `crestodian.setup.activate`。
- 当前稳定 Classic Wizard 不接受 `installDaemon`，但已经通过公共参数真实启动并取消；完整交互、daemon 选择和终态仍需隔离配置真机验收。
- beta 制品不是 JunQi 的安装、更新或配置候选。
- Windows、Linux、Docker 和真实更新后的 Gateway 重连需要目标环境验证。
- Windows 上临时 SQLite `-shm` 被占用时的真实 UI 回退尚未在修复后的安装包中验收；自动化只证明客户端不会重放未知激活，也不会丢失手动配置入口。

## 顶层工具导航归属

OpenClaw 工具入口使用 `/config?tab=tools` 呈现当前 Runtime 返回的工具目录、当前 Session 的有效工具以及官方 `tools` 配置。此前顶层导航同步只读取 `/config`，忽略查询参数，导致页面内容为工具而顶层标签和侧栏错误切换到“智能体”。修复后仅 `tab=tools` 归入“工具”，普通 Provider、Agent 与渠道配置仍归入“智能体”。
