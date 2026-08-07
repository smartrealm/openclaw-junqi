# OpenClaw 全链路对齐审计

日期：2026-08-07

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
| 引导完成条件 | `wizard.*` 管理交互会话，`openclaw.setup.verify` 真实验证默认推理路由 | `openclawWizard`、`useWizardSession`、`setupCompletionGate` | 本轮已修复 |
| 模型与凭据 | `config.get`/`config.set` 的 hash 与 `models.*` Gateway handler | ConfigManager、模型状态与探测客户端 | 进行中 |
| 会话与发送 | `sessions.create`、`chat.history`、`chat.send` 与 leaf/session CAS | `sessionCreate`、`ChatView`、发送事务 | 本轮已修复，Stop 已核对 |
| cron 与任务投影 | `cron.*`、Task Ledger、运行事件为唯一事实来源 | `OpenClawCronManagementClient`、CronMonitor、任务视图 | 已核对 |

## 已证实问题

### A-01 高：引导跳过条件只检查静态模型字段

**官方依据**：`packages/gateway-protocol/src/schema/openclaw.ts` 定义空参数的
`openclaw.setup.verify`；`src/gateway/server-methods/system-agent.ts` 调用
`verifySetupInference`；后者读取当前配置并实时验证默认 Agent 的推理路由。

**当前实现**：`src/services/openclawWizard.ts#requiresOpenClawOnboarding` 只要发现
`agents.defaults.model.primary` 或字符串模型引用就返回已完成。`src/hooks/useSetupFlow/index.ts`
与 `src/services/setup/setupCompletionGate.ts` 因而能在 Gateway 可连但凭据失效、路由失效或模型不可用时
进入工作台。

**目标**：完成门禁必须先通过选定运行时的认证 Gateway 身份，再由官方 `openclaw.setup.verify` 的结构化
结果决定可否跳过向导。静态配置检查只能用于确定是否可发起验证；不支持、未授权、超时或无有效结果时
保持待配置或待核验，不伪造成功。

**处理结果**：新增严格读取官方 `openclaw.setup.verify` 结果的 Gateway 客户端。Gateway 就绪后的
继续操作、官方 Wizard 返回完成时以及进入工作台前的最终操作，均先检查选定 runtime 的认证 Gateway
身份、静态配置前置条件和实时推理验证；验证失败、不可用或未认证时回到官方配置流程，不写入任何
OpenClaw 状态。

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

## 本轮会话修复摘要

`docs/quality/openclaw-confirmed-empty-session-audit-2026-08-05.md` 记录的 BUG-01 至 BUG-04 已按
`sessions.create`、`chat.history` 与 `chat.send` 官方语义修复。普通新建会话直接创建指定 Agent 的独立
dashboard session；无初始 turn 的非 fork 会话不加载旧历史，首发失败仅刷新官方历史，不自动重发。

## 未验证边界

- macOS、Windows、Ubuntu 与 CentOS 的真实安装、凭据库和 Gateway 交接仍需逐平台验收。
- Provider 模板和新增 Provider 编辑器尚未完全替换为官方 Wizard 或 Gateway schema 驱动的入口；当前
  模型目录和保存控制面已经对齐，但该编辑入口仍需继续核验。
- 系统凭据授权已移除旧迁移访问，但 macOS Keychain、Windows Credential Manager 和 Linux Secret
  Service 的真实授权次数仍需在各平台安装包中实测。
- 安装运行时及逐平台真实验收尚未完成，不能据此宣布全局完成。
