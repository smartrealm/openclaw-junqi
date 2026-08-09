# OpenClaw 全链路对齐审计

日期：2026-08-07

> 2026-08-09 复审修订：本文件原先将 `openclaw.setup.verify` 误列为首次安装完成门禁。最新版官方源码表明，
> 配置完成状态由 `openclaw.setup.detect.setupComplete` 提供，实时模型验证属于官方 Wizard 内可跳过或失败后
> 继续的用户决策。当前契约以
> [安装完成契约审计](./openclaw-installation-completion-contract-audit-2026-08-09.md) 为准。

## 范围与依据

本审计覆盖 JunQi Desktop 的安装、选定运行时、Gateway 连接、OpenClaw 引导、模型与凭据、会话发送、
中断恢复、定时任务与任务投影。JunQi 仅作为 OpenClaw 桌面客户端；所有状态均须来自 Gateway、官方
配置或 Tauri 的受控运行时身份，不能由界面推断成功。

官方依据使用 OpenClaw 仓库 `https://github.com/openclaw/openclaw` 的源码提交
`1e3880352e614116549c0a30c67a59a2d40ba259`。本机已安装版本只用于后续复现，不作为能力契约。

## 审计矩阵

| 主线 | OpenClaw 官方契约 | JunQi 已核对入口 | 当前结论 |
| --- | --- | --- | --- |
| 安装与运行时 | Gateway 配置、认证身份与 selected runtime 必须共同成立 | `useSetupFlow`、Rust `gateway` 与 `config` command | 进行中 |
| 引导完成条件 | `wizard.*` 管理交互会话，`openclaw.setup.detect.setupComplete` 提供配置终态 | `OpenClawSetupClient`、`useWizardSession`、`setupCompletionGate` | 2026-08-09 复审修复 |
| 模型与凭据 | `config.get`/`config.set` 的 hash 与 `models.*` Gateway handler | ConfigManager、模型状态与探测客户端 | 进行中 |
| 会话与发送 | `sessions.create`、`chat.history`、`chat.send` 与 leaf/session CAS | `sessionCreate`、`ChatView`、发送事务 | 本轮已修复，Stop 已核对 |
| cron 与任务投影 | `cron.*`、Task Ledger、运行事件为唯一事实来源 | `OpenClawCronManagementClient`、CronMonitor、任务视图 | 已核对 |

## 已证实问题

### A-01 高：引导跳过条件脱离官方配置终态

**2026-08-09 官方依据复审**：`packages/gateway-protocol/src/schema/openclaw.ts` 定义
`openclaw.setup.detect`，其响应包含布尔字段 `setupComplete`；`src/gateway/server-methods/system-agent.ts`
将其实现为只读配置检测。`openclaw.setup.verify` 是明确请求时执行的实时推理验证；官方 Wizard 允许用户
跳过该验证或在可选验证失败后继续，因此它不是客户端可追加的安装完成条件。

**初始实现**：`src/services/openclawWizard.ts#requiresOpenClawOnboarding` 只要发现
`agents.defaults.model.primary` 或字符串模型引用就返回已完成。`src/hooks/useSetupFlow/index.ts`
与 `src/services/setup/setupCompletionGate.ts` 因而能在 Gateway 可连但凭据失效、路由失效或模型不可用时
进入工作台。

**复审目标**：完成门禁必须先通过选定运行时的认证 Gateway 身份，再读取官方
`openclaw.setup.detect.setupComplete`。静态模型字段和客户端实时验证都不能替代该终态。

**2026-08-09 处理结果**：统一 Setup 客户端严格解析官方 `setup.detect` 与 `setup.verify` 响应。Gateway
就绪后和进入工作台前核验选定 runtime 的认证连接与 `setupComplete`；官方 Wizard 返回终态后不再追加
实时模型验证，从而保留官方流程中的跳过与继续选择。`setup.verify` 仅供明确需要实时模型测试的业务入口使用。

### A-02 已核对：Stop 与工具中断只保留待核验本地投影

**官方依据**：`packages/gateway-protocol/src/schema/sessions.ts` 定义 `sessions.abort` 的 `key`、
`runId` 与可选 `clearQueued`；`src/gateway/server-methods/sessions-abort.ts` 保持普通中止的队列，只有
明确 `clearQueued` 才清除队列。

**JunQi 结论**：`OpenClawSessionAbortClient` 默认不发送 `clearQueued`。`abortAfterTaskCheckpoint` 先
持久化本地取消请求，再调用原生中止；持久化失败时不会发起远端中止。Task 检查点把未返回结果的工具
调用标记为待核验，且仅在后续 OpenClaw 工具事件或 `chat.history` 证据到达时收敛，未向 transcript 写入
合成 Tool Result、系统消息或完成状态。

### A-03 已核对：cron 运行与终态读取保持 Gateway 权威

**官方依据**：`packages/gateway-protocol/src/schema/cron.ts` 与 `src/gateway/server-methods/cron.ts` 定义
`cron.add`、`cron.update`、`cron.remove`、`cron.run` 和 `cron.runs`。

**JunQi 结论**：创建、更新、删除均等待相应 Gateway 回执再刷新官方列表。手动执行只接受包含 `runId` 的
`cron.run` 入队回执，并且仅在同一 `jobId + runId` 的 `cron.runs` 终态记录出现后展示结果。轮询超时与
读取失败只显示失败或待确认，不转换为成功。JunQi 没有本地 cron 调度器。

### A-04 高：配置页与通道设置绕过 Gateway 配置控制面

**官方依据**：`ConfigGetParamsSchema`、`ConfigSetParamsSchema` 与 `ConfigPatchParamsSchema` 定义
`config.get`、`config.set`、`config.patch`。`src/gateway/server-methods/config.ts` 要求既有配置写入携带
`config.get` 返回的 `hash` 作为 `baseHash`，并在写入时恢复 Gateway 脱敏字段、检查并发冲突和执行官方
配置校验。

**初始实现**：`ConfigManager`、`channelConfig`、通道中心与智能体设置曾通过 Tauri 直接读取或写入
`openclaw.json`，会绕过 Gateway 的脱敏恢复、插件 schema 校验、`baseHash` CAS 与控制面授权。

**本轮处理**：配置页、通道保存、通道中心、智能体通道设置和业务引导的连接后快照已迁移至 Gateway
`config.get`；配置页和通道保存通过同一快照的 `hash` 调用 `config.set`。前端 `write_config` command 与
错误页本地重置入口已删除。安装前或 Gateway 不可用时只保留 Tauri 只读诊断；不得以本地写入作为恢复
fallback。

### A-05 高：模型配置保存仍含 JunQi 静态规范化

**官方依据**：`models.list` 是当前运行时可选模型目录，`models.probe` 只能探测已配置 Provider，
`config.set`/`config.patch` 是唯一配置写入权威。Gateway 负责 Provider、插件 schema、SecretRef 脱敏恢复和
模型引用校验。

**当前实现**：`ProvidersTab.tsx` 仍提供本地模板作为编辑入口，但模型列表、认证健康状态和配置 schema
分别读取 Gateway 的 `models.list`、`models.authStatus` 与 `config.schema`；模板不能证明上游已支持的 Provider
能力，仍是本轮需要继续收敛的展示层边界。

**本轮处理**：保存前的静态 Provider ID 与模型别名规范化、凭据迁移、私网自动放行、模型能力补全和
候选配置探测均已删除。保存只把用户编辑与最新 Gateway 快照合并后交给 `config.set`，由 Gateway 完成
schema 校验、SecretRef 脱敏恢复与 CAS。新增 Provider 对话框不再展示基于本地候选配置的“测试连接”；
已配置 Provider 的健康检查仍仅使用官方 `models.probe`。

**本轮清理**：已删除静态 Provider/媒体目录及其按本机 OpenClaw CLI 生成的构建入口、版本绑定测试和
运行时消费者。模型能力仅采用当前配置的明确字段或 Gateway `models.list` 返回；构建不再读取当前开发机
的 OpenClaw 安装版本。

已删除无生产消费者的 `runtimeNormalization` 及其测试。该旧层会自行规范化 Provider ID、模型引用与
模型能力，既不属于 Gateway 配置协议，也会把本地目录当成运行时事实。另已删除 Provider 模板中无消费者
的静态推荐模型和默认模型引用，新增 Provider 后的可选模型只能来自当前 Gateway 的 `models.list`。

**剩余边界**：`ProvidersTab` 的 Provider 展示模板和新增 Provider 编辑器仍需按官方 Wizard 或
Gateway schema/`models.list` 的可验证能力继续收敛；Gateway 未返回的字段必须保持未知。在该替换完成前，
不能把模型配置链路标记为全量对齐。

### A-06 高：二维码登录曾调用未在 Gateway 暴露的取消方法

**官方依据**：`src/gateway/server-methods/web.ts` 与 Gateway 方法描述只定义 `web.login.start` 和
`web.login.wait`，没有 `web.login.cancel`。

**初始实现**：桌面端在刷新或取消二维码登录时会发送 `web.login.cancel`。该调用不是 OpenClaw 协议的一
部分，会在部分 Gateway 上产生 `METHOD_NOT_FOUND`，并可能把本地取消误呈现成远端已取消。

**处理结果**：已删除该 RPC 调用。界面仅取消自己的等待与过期投影，不再声明 Gateway 登录会话被取消；
已发起的官方 `web.login.wait` 由 Gateway 自然结束，后续状态仍以 `web.login.wait` 的结构化结果为准。

### A-07 高：启动时重复读取旧凭据导致系统授权重复

**初始实现**：Gateway 连接目标解析同时执行旧版凭据迁移、设备凭据读取和旧凭据清理。该链路会对同一
次启动重复访问系统凭据库，并保留浏览器存储迁移和旧 Tauri command。

**处理结果**：已删除旧凭据迁移、旧浏览器存储清理和旧 Tauri command。连接目标只读取当前 runtime 与
设备身份绑定的 Gateway 凭据；系统凭据库不可用时，凭据提供器返回明确的 `session_only` 或
`unsupported` 状态，不写入浏览器存储，也不自动触发第二次凭据授权。握手收到与已保存值相同的
`authDeviceToken` 时只复用，不再次写入系统凭据库；只有首次获得或实际轮换才保存。
同一 runtime 的并发读取采用 single-flight，因此冷启动、重连和多个界面消费者只共享一次系统凭据读取。

### A-08 高：Gateway 服务状态缺少 locale 时被误判为旧服务

**官方依据**：OpenClaw `gateway status --json` 的服务归属证据包括服务定义、状态目录、配置路径、运行时
命令和运行状态；服务环境中的 `OPENCLAW_LOCALE` 不是服务安装与运行的必需字段。官方向导也允许跳过可选的
渠道、搜索、技能和控制界面步骤，是否安装 Gateway 服务由 `installDaemon` 和当前平台条件决定。

**初始实现**：JunQi 在服务命令、状态目录和配置路径均匹配时，仍要求服务状态 JSON 返回与当前配置相同的
`OPENCLAW_LOCALE`。官方服务状态未回报该字段时被归类为 `StaleLocale`，重启后又因“未验证为当前服务”失败，
随后触发连接切换和向导重试竞态。

**处理结果**：缺少 locale 时按已选服务处理；只有字段明确存在且与配置冲突时才标记为 `StaleLocale`。服务
归属仍必须同时通过状态目录、配置路径、Node/OpenClaw 运行时命令和已知运行状态，未放宽外部服务隔离。
新增回归测试覆盖“locale 缺失仍为当前服务”和“locale 明确冲突仍需重建”。

### A-09 中：官方可跳过步骤与 JunQi 工作台准入边界

**官方依据**：OpenClaw `onboard --help` 暴露 `--skip-channels`、`--skip-search`、
`--skip-skills`、`--skip-ui`、`--skip-bootstrap`、`--skip-hooks`、`--skip-health` 和
`--skip-daemon`。Gateway `wizard.start` 只启动官方 Wizard 会话；步骤是否出现、是否可跳过以及终态
结果均由 Gateway/CLI 返回，JunQi 不在本地复制一套步骤判定。

**可跳过不等于可用**：渠道、搜索、技能、控制界面、默认工作区文件、hooks、健康检查和 Gateway 服务
安装可以按官方参数或平台条件跳过。服务安装跳过后，JunQi 只能展示“未由 OpenClaw 服务托管”，不能
声称后台常驻已完成。

**2026-08-09 复审后的 JunQi 准入条件**：进入工作台前必须核验选定 runtime 的认证 Gateway，并以官方
`openclaw.setup.detect.setupComplete` 判断配置是否完成。模型实时验证仍可在用户明确触发的模型或业务就绪
入口中执行，但不参与首次安装准入，也不能覆盖官方 Wizard 的终态。

**本机复现（2026-08-07）**：Gateway 服务已加载运行，RPC 身份为 `operator` 且具备 `operator.admin`；
选定 Gateway 对 `openclaw.setup.verify` 与 `models.probe` 均返回 `INVALID_REQUEST: unknown method`。同日核对的
最新版 OpenClaw 官方源码已包含这两个 handler，故这不是模型或凭据失败的证据，而是当前 Gateway 与官方源码
能力不一致。JunQi 将其保留为“官方实时验证不可用”，不把静态模型文本、Gateway 健康或其他探测替代为成功。

**交接复现（2026-08-07）**：官方 Wizard 最终写入配置并交接服务后，Gateway 日志显示从配置重载到 JunQi
重新建立认证连接约需 85 秒。此前统一使用 20 秒连接等待，导致服务实际恢复后客户端已报告连接超时。现在仅在
官方服务交接和交接后恢复路径使用 120 秒有界等待；首次连接和普通 Wizard 步骤仍保持原有 20 秒等待，避免把
常规故障隐藏为长时间无反馈。

## 本轮会话修复摘要

`docs/quality/openclaw-confirmed-empty-session-audit-2026-08-05.md` 记录的 BUG-01 至 BUG-04 已按
`sessions.create`、`chat.history` 与 `chat.send` 官方语义修复。普通新建会话直接创建指定 Agent 的独立
dashboard session；无初始 turn 的非 fork 会话不加载旧历史，首发失败仅刷新官方历史，不自动重发。

## 未验证边界

- macOS、Windows、Ubuntu 与 CentOS 的真实安装、凭据库和 Gateway 交接仍需逐平台验收。
- Provider 模板和新增 Provider 编辑器尚未完全替换为官方 Wizard 或 Gateway schema 驱动的入口；当前
  模型目录和保存控制面已经对齐，但该编辑入口仍需继续核验。
- 官方 Wizard 的可选步骤由 Gateway 返回的步骤和 `installDaemon` 结果决定，JunQi 不添加本地跳过规则；
  当前完成门禁要求选定 Gateway 的认证连接和官方 `setupComplete`。用户明确触发模型实时验证时，失败与方法
  不可用仍是不同状态，但两者都不得反向改写已经完成的官方安装终态或自动重跑 Wizard。
- 系统凭据授权已移除旧迁移访问，但 macOS Keychain、Windows Credential Manager 和 Linux Secret
  Service 的真实授权次数仍需在各平台安装包中实测。
- 安装运行时及逐平台真实验收尚未完成，不能据此宣布全局完成。
