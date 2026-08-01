# Wizard 配置、重启与 Gateway 重装链路加固方案

日期：2026-08-01
基线：`daxia@2665672`
外部契约：本机安装的 `OpenClaw 2026.7.1-2 (0790d9f)` 及其随包官方文档

## 审查范围

本文只覆盖一条链路：**在可视化界面完成 OpenClaw 配置（wizard 或配置页）之后，重启 Gateway、重装 OpenClaw、重启桌面应用时，系统是否保持可用**。

不覆盖首次安装的前置依赖探测（Node/Git/Docker）、渠道登录与二维码流程，这些已有独立审计记录。

## 官方契约要点

以下四条来自 OpenClaw 随包文档，是本文所有判断的依据。

### 1. wizard 与 config 强制 admin scope

`docs/gateway/protocol.md:240-241`：

> 这些保留核心前缀始终解析为 `operator.admin`（`src/shared/gateway-method-policy.ts`）：`config.*`、`exec.approvals.*`、`wizard.*`、`update.*`。

### 2. wizard 会改写 Gateway 自身的连接契约

`docs/reference/wizard.md:232-250` 列出 wizard 写入 `~/.openclaw/openclaw.json` 的字段，其中包含 **`gateway.*`（mode、bind、auth、tailscale）**。这意味着一次 wizard 运行可能改变端口、绑定地址与**认证凭据**——客户端此前持有的 token 可能立即失效。

### 3. OpenClaw 明确告知每个配置路径的重载语义

`docs/gateway/protocol.md:419`：

> `config.schema.lookup` 返回单个配置路径的作用域查询负载：规范化路径、浅层 schema 节点、匹配的 hint 与 `hintPath`、可选的 `reloadKind`，以及子项摘要。**`reloadKind` 为 `restart`、`hot` 或 `none` 之一**（`src/config/schema.ts`），并镜像 gateway 配置重载规划器对该路径的判定。

### 4. 服务化更新走托管交接，不在活进程内替换包树

`docs/gateway/protocol.md:417` 描述 `update.run`：包管理器更新与受监督的 git checkout 更新**使用分离的托管服务交接**，而不是替换包树或在活动 gateway 内改动 checkout/构建产物。

## 当前实现盘点

已核实为健壮的部分，不重复整改：

- **wizard 走 admin scope**。`useWizardSession.ts:74` 使用 `gateway.callPrivileged`，其底层 `createPrivilegedRequester` 建立 `scopes: ['operator.admin']` 的瞬时连接（`src/services/gateway/index.ts:326`），符合契约 1。`docs/installation/openclaw-windows-wizard-audit.md` 的 BUG-WIZ-01 确已闭环。
- **wizard 完成后重读凭据**。`useWizardSession.ts:153-170` 的 `refreshGatewayConnectionTarget` 在 wizard 终态后重新执行 `detectGatewayConfig()` 并从配置读取 token，而不是沿用引导进程的内存凭据，正面回应了契约 2。
- **wizard 完成后做服务归属交接与身份验证**。`useWizardSession.ts:229-231` 调用 `handoffGatewayToOfficialService()` 后再 `probe_selected_gateway`，验证失败即报错，不把"端口健康"当作"配置正确"。
- **配置写入有并发保护**。`channelConfig.ts:505-520` 采用读取最新 revision、三方合并、带 revision 写入并有限重试的模式，外部修改会返回冲突而不是被过期页面覆盖。

## 加固项

按「不可用风险 / 落地成本」排序。每项标注证据、当前行为、目标行为与验证方式。

### HA-01 · 重装 OpenClaw 前不停止正在运行的 Gateway

风险等级：高。这是本次审查中最可能造成不可用的一项。

**证据**：`reinstall_openclaw`（`src-tauri/src/commands/setup/openclaw.rs:729`）直接进入 `install_openclaw_impl`。在该文件中检索 `stop_gateway`、`shutdown`、`service`、`reconcile` 均无命中；前端编排 `useSetupInstallers.ts:164-205` 的顺序是「检测 → 安装/重装 → 校验」，中间没有任何停止步骤。

**问题**：重装等价于对当前正在被 Gateway 服务使用的 npm 包树执行 `npm install -g`。

- Windows 上正在运行的进程会锁定文件，`npm install -g` 可能失败或留下**部分替换的包树**，此时 `checkOpenclaw` 的 `package_valid` 可能仍为真而实际不可运行；
- macOS/Linux 上运行中的进程持有旧 inode 不会立刻崩溃，但服务在任意时刻重启后会加载新代码，故障点与操作时间脱钩，难以归因；
- 这与契约 4 的设计意图相反：官方更新路径明确避免在活动 gateway 内替换包树。

**目标行为**：重装与重定位前，先按当前选定 runtime 停止 Gateway 服务，重装成功后再按原有归属重新拉起，并复用既有的 `inspect_selected_native_gateway_service` 做身份再认证。停止失败必须中止重装，而不是继续覆盖包树。

**验证**：Rust 侧新增用例断言 `install_openclaw_impl` 在 `ReinstallExisting` 与 `Relocate` 模式下先经过停止路径；前端断言重装编排包含停止步骤且停止失败会中止。Windows 真机需人工验收。

### HA-02 · 每次保存配置都无条件重启 Gateway（已修复）

风险等级：高。状态：2026-08-02 已修复。

**证据**：`src/pages/ConfigManager/index.tsx:195-200` 在保存成功后直接调用 `gatewayLifecycle.restart('config-manager')`，没有任何基于改动路径的判断。全仓检索 `reloadKind` 与 `config.schema.lookup` 命中为 0。

**问题**：重启会中断全部进行中的会话与工具执行。而契约 3 明确指出 OpenClaw 已经按路径给出 `hot` / `none` / `restart` 三种重载语义——把一次 `hot` 改动执行成整体重启，是把可用性白白让出去。

**目标行为**：保存前对本次实际改动的配置路径集合调用 `config.schema.lookup`，聚合 `reloadKind`：

- 全部为 `none` 时不做任何生命周期动作；
- 存在 `hot` 且无 `restart` 时依赖 Gateway 自身热加载，仅刷新客户端视图；
- 存在 `restart` 时才重启，并在确认前告知用户「此项改动需要重启 Gateway，进行中的会话将被中断」。

`config.schema.lookup` 需要 `operator.admin`（契约 1），走既有 `callPrivileged` 通道即可，不需要新增权限模型。

**失败关闭**：`config.schema.lookup` 不可用或返回未知路径时，回落到「重启」这一保守行为，并记录回落原因。不得因为查不到重载语义就假定可以热加载。

**实测证据**：已连接本机运行中的 OpenClaw `2026.7.1-2` Gateway，用 `openclaw gateway call config.schema.lookup` 采样十条代表性路径：

| 配置路径 | reloadKind |
| --- | --- |
| `gateway.port` | `restart` |
| `gateway.auth` | `restart` |
| `gateway.bind` | `restart` |
| `channels.telegram.botToken` | `restart` |
| `agents.defaults.model` | `hot` |
| `models.providers` | `hot` |
| `agents.defaults.workspace` | `none` |
| `session.dmScope` | `none` |
| `tools.experimental.planTool` | `none` |
| `skills.install.nodeManager` | `none` |

**十条中有六条不需要重启**。改模型、改工作区、开关计划工具、改 DM 作用域、改包管理器、改 provider 目录，此前一律触发整体重启并中断全部进行中的会话。

另有一项独立结论：`openclaw config schema` 的完整输出（2.5 MB）中 `reloadKind` 出现 **0 次**。该字段不在静态 schema 内，只能由 RPC 按路径实时计算，因此无法预先打包或缓存成表。

**修复**：新增 `src/services/gateway/configReloadPlan.ts`。`diffConfigPaths` 产出本次实际变更的点分路径（数组整体比较，因为重载规划器按配置路径而非数组元素身份作答），`planConfigReload` 逐路径查询并取最强要求。配置页据此决定：`restart` 才重启，`hot` 与 `none` 直接完成保存。

**验证**：新增 9 项测试，把上表实测值固化为夹具；覆盖强度聚合、整棵子树增删的叶子路径展开，以及三类回落分支（查询抛错、缺 `reloadKind`、取值不可识别）均降级为 `restart`。

### HA-03 · 重启后不重新验证 Gateway 身份（已修复）

风险等级：中高。状态：2026-08-02 已修复。

**证据**：`GatewayLifecycleCoordinator.ts:232-254` 在 `manager.restart()` 返回 `success` 后直接判定完成并进入重连，全过程没有调用 `probe_selected_gateway`，也没有调用近期新增的 `inspect_selected_native_gateway_service`。

**问题**：`AGENTS.md` 明确要求「Gateway 健康不等于身份、配置和授权正确」。wizard 路径已经做了这层校验（`useWizardSession.ts:231`），但**配置页与渠道设置触发的重启没有**。重启后若端口被另一个本机 Gateway 抢占，客户端会连上一个不属于当前选定 state 的实例，且表现为"重启成功"。

**目标行为**：`restart` 成功后统一执行选定 runtime 的身份再认证，未通过时以明确错误结束该次生命周期请求，而不是宣告成功。把 wizard 已有的校验提升为所有重启来源共用的后置条件。

**修复**：`CoordinatorDependencies` 新增可选的 `verifySelectedIdentity`，`gatewayLifecycle` 注入 `probe_selected_gateway`。restart 成功后统一再认证，未通过时以 `gateway.progress.restartIdentityFailed` 结束并返回失败。探针抛错按未验证处理——不可达的检查不得升级为隐式通过。

**验证**：协调器新增 4 项测试，覆盖落到异己 Gateway、探针不可达、通过后仍成功、以及重启失败时不触发探针。

### HA-04 · 重启链路没有 Docker 分支

风险等级：中高。

**证据**：`GatewayLifecycleCoordinator.ts` 全文检索 `docker` 命中为 0。

**问题**：`AGENTS.md` 规定「Native 与 Docker 是用户明确选择并持久化的运行方式，失败时不得静默切换」。当前协调器对两种 runtime 使用同一条路径，Docker 模式下的重启是否等价、容器未运行时的错误是否可读、以及是否可能在 Docker 选定时误操作 Native 服务，均无代码层面的保证与测试。

**目标行为**：先补齐**测试与断言**明确当前语义边界——重启请求必须携带并校验当前选定 runtime，Docker 与 Native 各自的失败必须给出各自的可读诊断。在没有真机验证前，不改变现有行为，只把契约固定下来防止漂移。

**验证**：为两种 runtime 各补一组协调器测试。Docker Desktop 冷启动需人工验收，本项在验收前标记为待验证。

### HA-05 · 重装成功判定依赖的校验面偏窄（已修复）

风险等级：中。状态：2026-08-02 已修复。

**证据**：`useSetupInstallers.ts:202` 在安装后仅以 `installed.installed` 为真作为成功条件；而同文件 `:159-163` 判定「需要修复」时使用的是更严的三项组合：`version_ok`、`package_valid`、`gateway_command_ok`。

**问题**：判定「坏」用三项，判定「好」只用一项。一次部分成功的重装可能让 `installed` 为真而 `gateway_command_ok` 仍为假，流程继续推进，故障延后到启动 Gateway 时才暴露，且此时已经失去"重装刚刚发生"的上下文。

**目标行为**：安装后的成功条件与修复触发条件对齐，使用同一组判据。任一项不满足时给出指向具体失败项的诊断。

**修复**：新增 `src/hooks/useSetupFlow/openclawInstallHealth.ts`，`requiresOpenclawRepair` 与 `isOpenclawInstallUsable` 共用 `openclawInstallDefects` 的同一组判据。诊断由 `describeOpenclawInstallFailure` 指向具体失败项而非笼统的「安装失败」，三份 locale 补齐对应文案。

**验证**：新增 8 项测试，其中一项遍历三个检查项断言「触发修复的条件必然阻断成功」，另一项断言编排两处都使用共享判据。

### HA-06 · 未使用官方托管交接做 OpenClaw 自更新

风险等级：中低。属能力缺口而非缺陷。

**证据**：全仓未调用 `update.run` / `update.status`（RPC 缺口分析见 `docs/quality/codebase-improvement-and-extension-plan-2026-07-31.md`）。JunQi 通过 `src-tauri/src/commands/openclaw_update.rs` 自行实现更新。

**目标行为**：评估改用 `update.run`。按契约 4，它使用分离的托管服务交接，并返回明确的 `managed-service-handoff-started` / `unavailable` / `failed` 三态与 `handoff.command`，比自行替换包树更安全，也天然解决 HA-01 的同类问题。

**边界**：官方明确 `unavailable` 意味着缺少安全的 supervisor 边界或持久服务标识（例如 systemd 的 `OPENCLAW_SYSTEMD_UNIT`）。JunQi 的 Windows Scheduled Task 与 macOS launchd 是否满足该条件必须先核实，不能假定可用。属独立立项。

## 建议顺序

1. ~~**HA-05**：判据对齐~~ 已完成。
2. ~~**HA-03**：身份校验提升为所有重启来源共用~~ 已完成。
3. ~~**HA-02**：接入 `reloadKind`~~ 已完成，实测证据见该条。
4. **HA-01**：重装前停止服务。改动集中在安装编排，但涉及平台服务，需 Windows 真机验收。
5. **HA-04**：先补测试固定语义边界，真机验收后再决定是否改行为。
6. **HA-06**：独立立项。

## 不建议做的

- **不要为了避免重启而猜测配置项的重载语义**。`reloadKind` 是官方给出的唯一权威，查不到时必须回落到重启。
- **不要在重装失败后自动回退到"继续使用旧版本"而不告知**。包树可能已处于部分替换状态，静默继续会把安装故障转化为运行时故障。
- **不要把 HA-04 当作重构机会**。在没有 Docker 真机验证前改动重启路径，风险高于收益。

## 未验证边界

- HA-02 的 `reloadKind` 已对本机运行中的 Gateway 实测采样十条路径。其余外部契约结论（`update.run`、`wizard.*` 的返回结构）仍来自随包文档的静态阅读，未实际调用。采样只覆盖十条路径，不代表全部配置项。
- 安装包 `src/` 仅含 `agents/`，运行时为打包产物，`packages/gateway-protocol` schema 不可读，故 `reloadKind` 的完整枚举与 `update.run` 的返回结构未从源码确认。
- HA-01 描述的 Windows 文件锁定行为为平台通例推断，未在 Windows 真机复现重装竞态。
- 未执行 `pnpm tauri build`，未在打包安装包上验证任何一条链路。
- 本文为只读分析，未修改任何实现。
