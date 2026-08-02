# Wizard 流程与 Gateway 生命周期全量审查

日期：2026-08-02
基线：`daxia@85bdca0`
外部契约：本机安装的 `OpenClaw 2026.7.1-2 (0790d9f)` 及其随包官方文档

## 审查范围

两条链路的全量清点：

1. OpenClaw wizard 协议在 JunQi 侧的接入面，包括步骤契约、响应契约与失败处理；
2. JunQi 管理 Gateway 生命周期的**全部**入口与链路，覆盖 Rust command 注册面、前端调用面、Native 与 Docker 两种 runtime。

与 `wizard-config-restart-reinstall-hardening-2026-08-01.md` 的关系：那份聚焦「配置完成之后」的重启与重装，本文聚焦**接入面完整性与协议演进韧性**，不重复其六项内容。

## 生命周期入口清点

`src-tauri/src/lib.rs` 注册的 command 中，生命周期相关共 **43 个**。逐个与前端调用面交叉比对后，分为三类。

### 有前端调用方（38 个）

覆盖探测、凭据、运行时身份、日志、自启动、救援、插件恢复等，调用路径清晰，不逐一列出。

### 无任何调用方（5 个）

| Command | 前端运行期调用 | 说明 |
| --- | --- | --- |
| `stop_gateway` | 0 | 仅出现在读取 Rust 源码文本的回归测试中 |
| `stop_docker_gateway` | 0 | 全仓零引用 |
| `restart_local_gateway` | 0 | 仅出现在同类源码文本测试中 |
| `docker_gateway_status` | 0 | 全仓零引用 |
| `get_gateway_lifecycle` | 0 | 全仓零引用 |

`stop_gateway` 与 `restart_local_gateway` 在 `src/services/gateway/gatewayRecoveryRegression.test.ts` 中出现共 10 次（该文件此类源码偏移断言总计 22 处），但全部是 `gateway.indexOf('pub async fn stop_gateway')` 这类**对 Rust 源码字符串的位置断言**，不是运行期调用。

### 前端生命周期入口

`gatewayLifecycle` 的三个动作在前端共 9 处调用来源：

| 来源 | 动作 |
| --- | --- |
| `App.tsx:500` / `:1025` / `:1026` | `restart` / `recover` |
| `StatusBar.tsx:128-129` | `restart` / `recover` |
| `TopBar.tsx:400` | `recover` |
| `SettingsPage.tsx:335` / `:530` | `recover` |
| `GatewayLifecyclePanel.tsx:198` | `restart` |
| `useWizardSession.ts:526` | `restart` |
| `ConfigManager/index.tsx` | `restart`（受重载计划约束） |

## 发现

### AUD-01 · wizard 协议解析对上游演进零容忍（已修复）

风险等级：高。状态：2026-08-02 已修复。

**证据**：`src/services/openclawWizard.ts` 在两个层级都对未知字段抛错或整体拒绝。

响应信封层，`assertExactWizardKeys`（`:155-163`）：

```
const unknown = Object.keys(result).find((key) => !allowed.has(key));
if (unknown) throw new Error(`${context} has an unknown field \`${unknown}\`.`);
```

`wizard.start` 允许键仅 `sessionId`、`done`、`step`、`status`、`error`；`wizard.next` 仅 `done`、`step`、`status`、`error`。

步骤层，`:73-92` 采用白名单：

- 允许键固定为 `id`、`type`、`title`、`message`、`format`、`options`、`placeholder`、`sensitive`、`executor`；
- 出现任何白名单外的键，整步返回 `null`；
- `type` 必须属于 `note` / `select` / `text` / `confirm` / `multiselect` / `progress` / `action` 七值之一，否则整步返回 `null`；
- `format` 必须恰好为 `'plain'`；
- `executor` 必须为 `'gateway'` 或 `'client'`。

**实测复现**：用真实的 `OpenClawWizardClient` 注入三种上游演进形态，均已确认失败：

| 注入内容 | 实际结果 |
| --- | --- |
| 响应信封新增 `progressPercent` | 抛错 `... has an unknown field \`progressPercent\`` |
| 步骤新增 `required: true` | 抛错 `OpenClaw wizard response is missing the next step.` |
| 步骤 `type: 'password'` | 抛错 `OpenClaw wizard response is missing the next step.` |

后两种尤其值得注意：步骤校验返回 `null` 后，上层将其呈现为「**响应缺少下一步**」。真实原因是「有一个字段/类型我不认识」，但用户与日志看到的是一条指向完全不同方向的诊断，排障时会先去怀疑 Gateway 而不是版本兼容。

**问题**：OpenClaw 是活跃演进的上游，本机安装版本已是 `2026.7.1-2`（同一 minor 的第二个修订）。上游只要在 wizard 响应或步骤负载中**新增一个字段**，JunQi 的向导即刻失败，用户**无法完成首次配置**。这不是降级，是整条 onboarding 链路不可用。

严格校验本身有正当理由：`AGENTS.md` 要求不得猜测第三方插件结果。但拒绝一个**新增字段**并非避免猜测——忽略不认识的附加字段是演进型协议的标准前向兼容契约。严格性应作用于 JunQi **实际解释**的字段，而不是作用于字段的存在与否。

**放大因素**：见 AUD-02，JunQi 不对 OpenClaw 版本设上界。

**目标行为**：

- 响应信封与步骤负载忽略未知的附加字段，只校验 JunQi 实际读取的字段的类型与取值；
- 未知的 `type` 不再静默整步拒绝，而是产生一个明确的「当前 JunQi 版本不支持该配置步骤，请升级桌面端」的终端错误，携带步骤 `id` 与 `type` 以便定位。当前把它呈现为「响应缺少下一步」是把版本问题误报成协议问题；
- 保留对已知字段的严格取值校验，不放宽 `status`、`executor` 等参与决策的枚举。

**修复**：`assertExactWizardKeys` 改为 `warnOnUnknownWizardKeys`，未知信封字段只记录调试日志不再抛错。`normalizeWizardStep` 改为返回判别式结果：未知键被**投影丢弃**而非拒绝整步，未知 `type` 返回 `unsupported-type` 并由调用方抛出携带步骤 `id` 与 `type` 的「请升级 JunQi Desktop」错误。已知字段的取值校验一律保留。

投影而非透传是刻意的：未知字段不会到达 UI，因此「不得渲染安装版本没有的协议特性」这条既有约束仍然成立，只是不再以整条链路不可用为代价。

**验证**：新增 6 项兼容性用例覆盖信封新增字段、步骤新增字段、未知类型、真正畸形负载、已知字段取值仍严格、非法 `status` 仍拒绝。同时更新 5 处断言旧严格语义的既有测试——其中 `BUG-IW-04` 与 `BUG-ONB-41` 改为断言「类型集合封闭」与「未知键被投影丢弃」这两条真实约束，原意得以保留。

### AUD-02 · 安装校验不对 OpenClaw 版本设任何边界（已修复）

风险等级：高。状态：2026-08-02 已修复。

**证据**：`src-tauri/src/commands/system.rs:1632`：

```
let version_ok = version.is_some();
```

`installed` 由 `version_ok && package_valid && gateway_command_ok` 合成（`:1652`）。也就是说**只要版本号能解析出来就算通过**，不存在下界或上界。

对照之下，协作插件 `packages/junqi-collab/package.json` 明确声明 `openclaw: ">=2026.7.1 <2027.0.0"`。

**问题**：同一产品内两套版本立场不一致。插件侧承认存在兼容区间，安装校验侧却接受任意版本。用户通过 `npm i -g openclaw@latest`、系统包管理器或 OpenClaw 自更新拿到一个更新的大版本时，JunQi 不会给出任何提示，而 AUD-01 的解析器会在 wizard 环节直接失败。故障表现与根因（版本不匹配）之间没有任何提示链路。

**目标行为**：把 collab 插件已声明的兼容区间提升为安装校验的一等判据。版本低于下界拒绝并提示升级 OpenClaw；高于上界不阻断使用，但需要在设置与安装诊断中明确标注「该 OpenClaw 版本超出本 JunQi 版本的已验证范围」，使 wizard 失败时用户能立刻定位。

**修复**：`system.rs` 新增 `OPENCLAW_MIN_SUPPORTED_VERSION`（2026.7.1）与 `OPENCLAW_VERIFIED_BELOW_MAJOR`（2027），`openclaw_version_support` 返回「是否受支持」与「是否超出已验证范围」两个判定。`version_ok` 不再等价于「版本号可解析」，低于下界会给出指向升级 OpenClaw 的具体错误。`OpenclawStatus` 新增 `version_beyond_verified_range` 并同步到前端类型。

上界只告警不阻断：拒绝一个正常升级的 OpenClaw 会让用户彻底失去可用的桌面端，比未验证组合更糟。版本后缀（如 `2026.7.1-2`）视为同一契约的修订，不参与比较。

**验证**：新增 2 项 Rust 用例覆盖下界、上界、后缀忽略、无法解析不被静默当作受支持。

**展示接入**：`SetupFlowPanels` 的运行信息面板在超出验证范围时把版本行改为警告色，并给出「仍可使用，若向导或连接异常请优先考虑版本兼容」的说明。原「版本可读取」勾选项改为「版本受支持」——`version_ok` 的语义已从可解析变为在支持区间内，标签必须随之更正。

### AUD-03 · 五个生命周期 command 无调用方，其中包含全部停止入口

风险等级：中高。

**证据**：见上文清点。`stop_gateway`、`stop_docker_gateway`、`restart_local_gateway`、`docker_gateway_status`、`get_gateway_lifecycle` 均无运行期调用方。

**问题分两面**：

**产品面**：用户在 UI 中**没有停止 Gateway 的入口**。前端九个生命周期入口全部是 `restart` 或 `recover`，没有一个 `stop`。用户想临时停掉 Gateway（排查端口冲突、让位给手工启动的实例、离线场景省资源）只能退出应用或去命令行。而 `stop_gateway` 与 `stop_docker_gateway` 在 Rust 侧是完备实现的。

**边界面**：这五个 command 仍在 `generate_handler!` 中注册，构成对 WebView 暴露但无人使用的 IPC 面。这与既有 `docs/quality/codebase-improvement-and-extension-plan-2026-07-31.md` 的 IMP-04 是同一问题域。

**目标行为**：二选一，不要维持现状。要么补上停止入口（推荐，`stop_gateway` 与 `stop_docker_gateway` 已实现，仅缺 UI 与 runtime 分派），要么从注册表摘除并删除实现。`restart_local_gateway`、`docker_gateway_status`、`get_gateway_lifecycle` 三个需要单独判断是历史残留还是待接入能力。

### AUD-04 · 生命周期回归测试断言 Rust 源码字符串位置（已修复）

风险等级：中。状态：2026-08-02 已修复。

**证据**：`src/services/gateway/gatewayRecoveryRegression.test.ts` 中形如：

```
gateway.indexOf('pub async fn stop_gateway'),
gateway.indexOf('pub async fn restart_local_gateway'),
```

共 22 处 `indexOf('pub async fn ...')`，通过比较函数定义在源文件中的**字节偏移**来断言顺序或存在性。

**问题**：这类断言与实现的文本形态耦合，重命名函数、调整定义顺序、甚至改动函数签名的空白都会使其失效，而失效原因与被守护的行为无关。本次会话中已四次遇到同类脆弱断言（`executionPlanLayout`、`dashboardInteraction`、`worktreeForget`、`setupInstallClosureRegression`），每次都以「改断言」而非「改实现」收场——这说明守护测试正在消耗维护预算却未提供对应保障。

**目标行为**：把这些断言改为对行为契约的断言。对纯 Rust 逻辑，用 `#[cfg(test)]` 单元测试覆盖；确需跨语言守护的顺序约束，断言可执行的语义而非源码偏移。

**更正**：本条初稿把这些 `indexOf` 描述为「断言定义顺序」，不准确。它们实际是用来**切出函数体**做作用域限定，结束边界取自相邻函数名。真正的脆弱点是这个边界——插入或重排函数会静默改变被断言的范围。

**修复**：新增 `rustFnBody`，按花括号配平提取单个函数体，不再依赖相邻定义名。12 处切片全部改用它。

改造过程中暴露了一个此前被掩盖的问题：`BUG-GSO-01`、`BUG-GSO-02`、`BUG-GSO-08` 三条断言名义上作用于 `start_gateway`，但旧切片一直延伸到 `stop_gateway`，**实际跨越了多个函数**。被守护的启动策略真正位于 `start_gateway_locked_with_policy`，公开入口只是薄封装。三条断言已对准真正承载逻辑的函数。

**验证**：提取器本身新增自测，覆盖嵌套花括号、相邻函数隔离、`pub` / `pub(crate)` / 私有三种可见性、找不到与括号不配平两种错误。

**已立约定**：`AGENTS.md` 测试章节补充「守护测试断言契约，不断言实现的书写形式」，并明确禁止断言表达式文本、变量名与定义偏移，要求按语法边界截取范围。

### AUD-05 · Native 与 Docker 的生命周期操作面不对等

风险等级：中。

**证据**：按操作分类统计两个模块的函数定义：

| 操作 | Native (`gateway.rs`) | Docker (`docker.rs`) |
| --- | --- | --- |
| start | 8 | 3 |
| stop | 1 | 2 |
| restart | 3 | **0** |
| handoff | 1 | **0** |
| probe | 2 | **0** |

Docker 侧没有 restart、没有 handoff、没有 probe。`ensure_gateway_running`（`ensure.rs:293`）确实按 `paths::active_runtime_mode()` 分派，说明入口层的 runtime 绑定是存在的。

**问题**：不对等本身未必是缺陷——Docker 的重启可以由容器编排承担，探测语义也可能不同。但当前**没有任何测试或文档固定这个边界**，因此无法判断「Docker 没有 restart」是有意设计还是遗漏。上一轮 HA-04 已为前端协调器补了 runtime 无关性断言，Rust 侧尚无对应约束。

**目标行为**：先用测试与文档固定当前语义——Docker 路径下 restart 请求由谁承接、失败诊断是否可读、handoff 与 probe 在 Docker 下是否有等价概念。在 Docker Desktop 真机验收前不改变行为。

## 建议顺序

1. **AUD-01**：改为忽略未知附加字段、未知步骤类型给出可定位的明确错误。这是唯一会导致 onboarding 整体不可用的项。
2. **AUD-02**：把 collab 已有的兼容区间提升为安装判据。与 AUD-01 同批做，二者共同构成版本演进的防线。
3. **AUD-03**：补停止入口，或摘除注册。产品决策先行。
4. **AUD-04**：改写脆弱断言，并在 `AGENTS.md` 立约定。
5. **AUD-05**：补测试固定 Docker 语义边界，真机验收后再议行为。

## 不建议做的

- **不要放宽已知字段的取值校验**。`status`、`executor`、`format` 参与决策，放宽会把协议漂移变成静默误判。AUD-01 只针对**未知字段的存在**，不针对已知字段的取值。
- **不要在 AUD-02 中把版本上界做成硬阻断**。超出已验证范围应当可用并告警，直接拒绝会让用户在 OpenClaw 正常升级后失去可用的桌面端。
- **不要为了消除 AUD-03 而直接删除 `stop_*`**。Rust 侧实现完备，缺的是入口；先做产品判断再动代码。
- **不要在没有 Docker 真机的情况下改 AUD-05 的行为。**

## 未验证边界

- AUD-01 的三种失败形态已用真实解析器注入复现（见该条实测表）。但**未在真实 Gateway 上观察到上游确实新增了字段**，因此「上游会新增字段」仍是基于协议演进通例的推断。
- 未实际运行一次完整的 wizard 流程，`wizard.start` / `wizard.next` 的真实响应负载未采样。
- AUD-02 未验证 OpenClaw 跨大版本时 wizard 协议的实际变化幅度。
- AUD-05 的统计基于函数名模式匹配，可能低估通过通用函数间接实现的 Docker 能力。
- 本文为只读分析，未修改任何实现。
