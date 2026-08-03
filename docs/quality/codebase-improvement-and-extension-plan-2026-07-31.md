# 全局改进与功能拓展计划

日期：2026-07-31
基线：`daxia@de2a5b6`（`daxia`、`main`、`origin/main` 三者同点）
外部契约：本机安装的 `OpenClaw 2026.7.1-2 (0790d9f)` 及其随包官方文档

## 方法与覆盖声明

先说清楚覆盖范围，避免把结论说得比证据强。

- **完整机械覆盖**：全部 1739 个已跟踪文件由脚本逐文件、逐行读取并分类统计。测试覆盖缺口、文件体量、`any` 分布、空 catch、Rust panic 路径、硬编码文案、RPC 使用面这几项的数字是全量的，不是抽样。
- **人工深读**：追溯链路、Gateway 连接层、IPC 适配层、状态词汇相关页面为逐行阅读。
- **未做**：44 万行的逐行人工阅读不在可信范围内，本文不作此声明。61 个超过 800 行的大文件仅按结构与热点阅读，未逐行通读。
- **外部契约**：`protocol.md` 等官方文档为静态阅读，未连接真实 Gateway 取得任何响应体样本。

基线上实际执行的门禁（全部通过）：`pnpm exec tsc --noEmit` 退出码 0；模块边界检查覆盖 682 个文件；前端测试 2064 项、脚本测试 224 项、Rust 库测试 667 项通过与 3 项显式忽略；`cargo fmt -- --check` 通过。未执行 `pnpm build` 与 `pnpm tauri build`。

本文为只读分析，未修改任何实现。与既有 `docs/quality/full-codebase-audit-2026-07-29.md`（FCA 系列）不重复：该文处理硬编码、设计系统与 demo 代码，本文处理工程结构、测试资产与官方能力覆盖面。

## 量化基线

| 类别 | 文件 | 行数 |
| --- | --- | --- |
| TypeScript `.ts` | 838 | 136124 |
| React `.tsx` | 291 | 89027 |
| Rust `.rs` | 118 | 75466 |
| 脚本 `.mjs` | 70 | 18619 |
| 文档 `.md` | 210 | 21886 |
| 全仓合计 | 1739 | 443249 |

前端生产文件 679，测试文件 373，Rust 生产文件 117。

## A. 工程改进计划

### IMP-01 · 测试覆盖存在 23% 的结构性空洞

优先级：高

**证据**：679 个前端生产文件中，159 个既没有同名 `.test.ts(x)`，也没有被任何测试文件引用。集中区域：

| 目录 | 无覆盖文件数 |
| --- | --- |
| `src/pages`（顶层） | 13 |
| `src/components/Terminal` | 12 |
| `src/pages/FullAnalytics/components` | 12 |
| `src/components/shared` | 11 |
| `src/pages/Calendar` | 11 |
| `src/pages/ConfigManager` | 11 |
| `src/pet` | 9 |
| `src/components/Chat` | 8 |
| `src/utils` | 8 |

注意这不等于「质量差」：2288 项测试全部通过（前端 2064 + 脚本 224），核心协议与状态机覆盖扎实。问题在于覆盖分布不均——协议层重、交互层轻，而 `Terminal`、`Calendar`、`pet` 恰恰是状态复杂且难以人工回归的区域。

**目标**：按风险而非按比例补齐。先覆盖 `src/utils`（纯函数，成本最低收益最直接）与 `src/components/Terminal`（状态机复杂、回归代价最高），暂不追求整体百分比。

**验证**：新增测试必须能在引入缺陷时失败，遵循 `AGENTS.md` 对回归测试的要求。

### IMP-02 · 61 个文件超过 800 行，合计 96843 行

优先级：高，但必须分批且有守护测试

**证据**：

| 文件 | 行数 |
| --- | --- |
| `src-tauri/src/commands/collaboration_bootstrap.rs` | 8602 |
| `src-tauri/src/commands/storage.rs` | 4465 |
| `src-tauri/src/commands/gateway.rs` | 4132 |
| `src/pages/ConfigManager/ProvidersTab.tsx` | 3845 |
| `src-tauri/src/commands/system.rs` | 2980 |
| `src-tauri/src/paths.rs` | 2868 |
| `src/components/Terminal/ShellTerminalPanel.tsx` | 2614 |
| `src-tauri/src/commands/docker.rs` | 2462 |
| `src/pages/AgentHub/index.tsx` | 2185 |
| `src/stores/chatStore.ts` | 2046 |

`collaboration_bootstrap.rs` 单文件 8602 行是最突出的一个，且其中包含大量 `#[cfg(test)]` 内容（首个 `#[cfg(test)]` 位于第 6816 行，即约 1786 行测试与 6815 行实现）。

**目标**：不做「顺手重构」。按 `AGENTS.md` 的最小改动原则，只在以下条件同时满足时拆分：该文件正在因为其他任务被修改、存在明确的职责边界、拆分后有守护测试。优先候选是 `paths.rs`（路径构造是单一职责，已是事实上的单一事实源，拆分风险最低）与 `ProvidersTab.tsx`（UI 与 provider 契约混杂）。

### IMP-03 · 生产代码 342 处 `any`，IPC 边界占 52 处

优先级：高（仅指 IPC 边界部分）

**证据**：生产代码（排除测试与 `.d.ts`）共 342 处 `any`，分布于 69 个文件：

| 文件 | 处数 |
| --- | --- |
| `src/api/tauri-adapter.ts` | 52 |
| `src/pages/Dashboard/index.tsx` | 25 |
| `src/pages/ConfigManager/ProvidersTab.tsx` | 24 |
| `src/stores/gatewayDataStore.ts` | 19 |
| `src/pages/SkillsPage/index.tsx` | 15 |
| `src/services/gateway/Connection.ts` | 14 |

`AGENTS.md` 明确禁止用 `any` 掩盖 IPC 契约漂移。`tauri-adapter.ts` 的 52 处中，22 处直接标注 `invoke` 返回值。这是唯一必须优先处理的一类——Rust 侧 `serde(rename_all)` 改动时，这些位置会让 TypeScript 完全失去检测能力。

作为对照，`src/api/tauri-commands.ts` 的 `any` 为 0，说明项目内已有可参照的严格写法。

**目标**：只收敛 IPC 边界的 52 处，其余 290 处不作为独立任务，随各自模块改动时顺带处理。

### IMP-04 · 101 处空 catch

优先级：中

**证据**：42 个文件共 101 处形如 `catch { }` 或 `catch (e) { }` 的空捕获。最集中的是 `src/pages/AgentRunView.tsx`（12 处）、`src/pages/SkillsPage/index.tsx`（6 处）、`src/api/tauri-adapter.ts`（5 处）、`src/services/gateway/credentialProvider.ts`（5 处）。

其中一部分是合理的（例如 localStorage 配额超限的 `catch { /* quota exceeded */ }`），但 `credentialProvider.ts` 中的凭据路径静默失败风险更高：凭据读取失败与凭据不存在是不同语义，静默吞掉会让上层无法区分。

**目标**：不做全量整改。只审查凭据、Gateway 生命周期、安装三条链路上的空 catch，确认每一处是有意的还是遗漏，有意的补注释说明，遗漏的补日志或错误传播。

### IMP-05 · Rust 锁毒性级联

优先级：中

**证据**：Rust 生产路径共 97 处 `unwrap`/`expect`/`panic!`，其中 `src-tauri/src/commands/agent_task_pty.rs` 32 处、`src-tauri/src/commands/terminal.rs` 12 处。逐行分类后，这两个文件的 44 处中有 35 处是 `Mutex::lock().unwrap()`。

这是 Rust 的常见写法，不是随意的 unwrap。但语义后果需要正视：一旦某个线程在持锁期间 panic，锁被毒化，此后**每一次** PTY 或终端操作都会继续 panic。对于长时间运行的桌面应用，这意味着单次故障会升级为该子系统的永久不可用，且用户只能重启应用。

**目标**：在 PTY 与终端注册表这两个高频长生命周期路径上，把 `lock().unwrap()` 换成显式的毒化处理（恢复内部数据或返回可读错误）。不需要全仓统一处理。

### IMP-06 · 147 行真正硬编码的中文文案

优先级：中

**证据**：TSX 中含中文的 716 行里，569 行是 `t('key', '中文')` 的 i18n fallback 形式（合规），真正硬编码的是 147 行 / 22 个文件：

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `src/pages/AgentWorkspace/index.tsx` | 51 | 侧栏页签 label 等，用户可见 |
| `src/pet/PetBubble.tsx` | 21 | 状态文案，用户可见 |
| `src/pages/TimelinePage.tsx` | 14 | 状态词汇表，用户可见 |
| `src/pages/ActivityCenter.tsx` | 12 | 状态词汇表，用户可见 |
| `src/components/Layout/StatusBar.tsx` | 8 | 多为 JSX 注释，非用户可见 |

需要注意 `StatusBar.tsx`、`src/pet/skins/index.tsx`、`PaneComposerBar.tsx` 的命中主要是 `{/* 中文注释 */}` 形式的 JSX 注释，不是文案，不应计入整改范围。实际需要处理的用户可见文案约 110 行。

`src/pages/AgentWorkspace/index.tsx` 是 `main@10518b4` 刚刚重构过的文件，51 行硬编码是本次重构遗留的最大一处，与上一轮修复的 FIND-08 属于同一次改动的同类问题。

### IMP-07 · 状态文案存在三份独立词汇（已修复）

优先级：中。状态：2026-08-01 已修复。

**更正**：本条初稿写作「FCA-04 未真正闭环」，该判断有误。FCA-04 处理的是状态**指示器的色调语义**（`StatusDot` / `StatusIcon` / `StatusBadge`），已由 `src/components/shared/status/statusTone.ts` 收敛，结论成立。本条实际发现的是状态**文案词汇**，属于此前未被记录的另一个问题，与 FCA-04 无从属关系。

**证据**：三处各自维护状态文案，且已经漂移：

- `src/pages/ActivityCenter.tsx` 的 `STATUS_LABELS`，12 项硬编码中文，另有 5 项被 `lifecycle.*` 覆盖
- `src/pages/TimelinePage.tsx` 的 `statusLabel`，12 项硬编码中文
- locale 中的 `dynamicIsland.statuses`，10 项，已接入 i18n

三者互不相同：`running` 在前两处是「运行中」，在灵动岛是「执行中」；`pending` 分别是「等待运行」与「排队中」；`todo` 分别是「待开始」与「待办」。同一状态在不同界面显示不同文案。键集合也各不相同：`stopped` / `unknown` 只在 ActivityCenter，`queued` / `idle` 只在 TimelinePage。

**修复**：新增 `src/utils/taskStatusLabels.ts` 作为唯一词汇来源，任务状态部分以权威联合类型 `AgentWorkspaceTaskStatus` 为准，会话活动状态单列——两者是不同的域，不能合并成一张表。三份 locale 新增 `taskStatus` 命名空间共 14 项。未识别的状态回落为原始值而非编造标签，使上游词汇变更暴露为未翻译字符串。

### IMP-08 · 1.5.1 发布重演了 Cargo.lock 遗漏

优先级：中。改动量极小，但同一问题已连续两个版本发生。

**证据**：在 `de2a5b6`（发布：升级版本至 1.5.1）上核对四处版本：

| 位置 | 版本 |
| --- | --- |
| `package.json` | 1.5.1 |
| `src-tauri/Cargo.toml` | 1.5.1 |
| `src-tauri/tauri.conf.json` | 1.5.1 |
| `src-tauri/Cargo.lock` | **1.5.0** |

`AGENTS.md` 要求的三处一致成立，但锁文件再次落后。这与 1.5.0 发布时的情况完全相同：当时 `d6cce66` 同样漏了锁文件，由 `4a396f0`（修复：同步桌面版本锁文件）事后补救，`docs/quality/agent-guide-compliance-audit-2026-07-31.md` 的 FIND-07 已记录该问题并建议把 `Cargo.lock` 纳入版本一致性检查清单。该建议尚未落实，问题随即在下一个版本重现。

**影响**：已提交的锁文件与 `Cargo.toml` 声明版本不符时，干净检出的 Rust 构建会先重写锁文件，锁文件不再是发布制品的可信版本证据。`.github/workflows/` 的 cargo 步骤未使用 `--locked`，因此不会导致 CI 失败，问题只会静默存在。

**目标**：把四处版本一致做成自动检查，而不是依赖发布时的人工记忆。现有 `scripts/` 下已有多个校验脚本，可在同处新增，并接入 `pnpm test` 的 scripts 套件。

## B. 功能拓展计划

以下是审计时基于 OpenClaw `2026.7.1-2` 已提供能力整理的候选项，不含推测性设计；当前实现必须重新核对官方主线文档、源码、schema 和 handler。

**总体缺口**：`docs/gateway/protocol.md` 中出现的 RPC 与事件标识共 221 个，JunQi 引用 49 个，未使用 172 个。其中相当一部分（node 配对、device 配对、`doctor.memory.*` 的修复类操作、`connect.params.*` 握手字段、`policy.*` 策略字段）对桌面 operator 客户端不适用。以下只列真正适用且有明确产品价值的部分。

### EXT-A · 审计账本与审批协议

承接 `docs/quality/chat-response-trace-openclaw-extension-analysis-2026-07-31.md`，此处不重复展开。要点：

- `audit.list` 只需 `operator.read`，JunQi 日常连接已具备，是成本最低的权威数据源
- `exec.approval.*` 与 `plugin.approval.*` 提供带 actor 和 decision 的正式审批，可解除当前 `transcript-only` 的自我限制
- 状态词汇需补 `blocked` 与 `timed_out`

2026-08-03 的第一阶段已按 [OpenClaw 原生审批对齐](openclaw-native-approvals-alignment-2026-08-03.md)
接入 `exec.approval.list/resolve` 与 `plugin.approval.list/resolve`。当前只做 Gateway 原生
pending 队列的管理员临时读取和解析，日常 scope 不增加 `operator.approvals`；审批事件流、
策略管理、waitDecision 和正式 trace 节点仍未接入。

与 IMP-07 有交集：状态词汇统一时应直接对齐 OpenClaw 的 7 值口径，而不是先统一成 JunQi 的 4 值再改一次。

### EXT-B · 会话上下文的主动控制

优先级：高。这是当前产品能力上最明显的缺失。

**官方依据**：`protocol.md` 的 `sessions.compact`、`sessions.steer`、`sessions.abort`、`sessions.preview`、`sessions.search`、`sessions.resolve`；`docs/concepts/queue-steering.md`、`docs/concepts/compaction.md`

**审计时行为**：JunQi 只能观察压缩，按钮曾通过 `chat.send` 发送 `/compact`，不能调用原生会话维护 RPC。压缩缺口已由 [OpenClaw 原生会话压缩对齐](openclaw-native-session-compaction-alignment-2026-08-04.md) 修复；Stop 也已由 [OpenClaw 原生会话中止对齐](openclaw-native-session-abort-alignment-2026-08-03.md) 切换到 `sessions.abort`；Session Manager 的最近消息已由 [OpenClaw 原生会话预览对齐](openclaw-native-session-preview-alignment-2026-08-03.md) 接入 `sessions.preview`。`sessions.steer` 的语音抢话路径已经存在，仍需按当前官方 handler 和真实 Gateway 响应持续核对。

**可拓展**：

- 用户可以通过 Dashboard 或命令面板主动触发 OpenClaw 原生压缩，而不是依赖文本指令路径
- `sessions.steer` 允许在排队任务执行前调整方向，JunQi 已用于 Jarvis 语音抢话；2026-08-03 已完成普通文本路径的官方 queue mode 复核，活动 Run 的普通 `chat.send` 交由 Gateway，详见 [会话队列对齐记录](openclaw-native-session-queue-alignment-2026-08-03.md)
- `sessions.abort` 为 Stop 提供当前 Run 的原生中止确认；普通请求省略 `clearQueued` 以保留 Gateway 队列
- `sessions.preview` 已用于 Session Manager 的真实最近消息预览；`sessions.search` 已用于 Gateway 转录全文检索，具体见 [OpenClaw 原生会话检索对齐](openclaw-native-session-search-alignment-2026-08-03.md)。`sessions.resolve` 已核对但暂不接入：官方结果只返回 canonical key，而当前调用方已经持有 key 并需要 session id，增加该 RPC 不会提供新的有效能力

**边界**：压缩会改变模型可见上下文，且官方 `sessions.compact` 要求 `operator.admin`。触发入口必须保留已有管理员授权边界，不把 no-op 或授权失败当作成功；memory flush、degraded 情形和活动运行冲突由 Gateway 负责。

### EXT-C · 工具目录与工具可见性

优先级：中高

**官方依据**：`protocol.md` 的 `tools.catalog`、`tools.effective`、`tools.invoke`

**当前行为**：`tools.catalog` 已按 [OpenClaw 原生工具目录对齐](openclaw-native-tools-catalog-alignment-2026-08-03.md) 接入 Config Manager Tools 页面，按 agent 只读展示 Gateway 的 core/plugin 目录；`tools.effective` 已按 [OpenClaw 原生有效工具目录对齐](openclaw-native-tools-effective-alignment-2026-08-03.md) 展示指定 Session 的实际结果；`tools.invoke` 已按 [OpenClaw 原生工具调用对齐](openclaw-native-tools-invoke-alignment-2026-08-03.md) 提供受有效工具和运行时身份门禁保护的一次性调用入口。`src/services/gateway/OpenClawPlanToolSettings.ts:63` 的 `tools.experimental` 仍只是配置路径字符串，不能作为运行时工具目录。

**可拓展**：`tools.catalog` 展示 agent 级可配置的 core/plugin 目录，`tools.effective` 展示 Session 级最终结果，`tools.invoke` 只在有效工具和运行时身份均可验证时透传用户显式调用。三者并列可以解释配置目录、实际权限与一次性执行的边界；JunQi 不本地推断策略、不写入聊天/Task 图，也不自动重试副作用调用。审批队列、工具 schema 编辑和真实 Gateway 现场验证仍按官方能力另行核对。

这也与既有 `docs/quality/openclaw-config-authority-audit-2026-07-29.md` 的 BUG-OCA-02（Tools/provider/plugin 配置能力被整套硬编码）直接相关：`tools.catalog` 正是那条审计所缺的权威来源。

### EXT-D · 官方技能协议

优先级：中

**官方依据**：`protocol.md` 的 `skills.search`、`skills.detail`、`skills.securityVerdicts`、
`skills.install`、`skills.upload.begin` / `chunk` / `commit`、`skills.install.allowUploadedArchives`、`skills.bins`

**当前行为**：`src/services/openclawSkillsRuntime.ts` 已将 `skills.status`、`skills.search`、
`skills.detail`、`skills.update`、`skills.install` 与官方技能归档上传生命周期接入 Gateway；`SkillsPage` 的 Gateway
目录使用这些原生结果；status 只接受官方必需状态字段，不用默认值掩盖缺失状态。技能详情已按官方 schema 只展示真实的 score、版本、时间、owner、
metadata、tags、channel 与 changelog，不再把下载量、星标、安装量、README、版本历史或
外部链接猜测成数据。`/skill-hub` 仍是 JunQi 本地目录与项目符号链接工具，和 Gateway
技能目录保持边界。

已安装列表另外读取 `skills.securityVerdicts`；只把与 status `skillKey` 精确匹配的
`slug`/`requestedSlug` 关联到技能，并在官方 `securityPassed` 明确为布尔值时显示结果。安全
RPC 不可用时保留技能列表并显示非阻断提示，未知状态不被改写成通过或失败。

**可拓展**：继续以 OpenClaw 官方协议、源码和 schema 为依据，优先评估只读的
`skills.bins`、`skills.skillCard` 和提案协议；只有确认当前 Gateway 广告、权限和
结果字段后才接入。归档上传已按独立规格接入，仍不覆盖官方未提供的取消、删除或本地回退。

**边界**：这是一次协议迁移，涉及既有用户的本地安装记录。必须先确认官方协议能表达当前所有安装来源，否则会丢失能力。属于需要 spec 与 plan 三层记录的改动。

### EXT-E · 官方产物协议

优先级：中

**官方依据**：`protocol.md` 的 `artifacts.list`、`artifacts.get`、`artifacts.download`

**当前行为**：JunQi 的消息内联产物仍由 `<openclaw_artifact>` XML 标签投影；三个原生 RPC 已按 [OpenClaw 原生产物协议对齐](openclaw-native-artifacts-alignment-2026-08-03.md) 接入 Chat 会话顶部的只读产物面板。XML transcript 投影与 Gateway artifact 摘要保持独立。

**可拓展**：官方协议提供按 session、run 或 task 范围的产物列举与下载，不依赖标签出现在当前 transcript 中。当前 JunQi 首先使用真实 session scope，保留 run/task scope 作为客户端后续扩展边界；不把 XML、本地文件或 URL 猜测成原生产物。

### EXT-F · Memory 的官方来源

优先级：中低

**官方依据**：`protocol.md` 的 `doctor.memory.status`、`doctor.memory.remHarness`（后者明确标注 requires `operator.read`，返回 bounded read-only 预览）；当前官方 `core-descriptors.ts`、`server-methods/memory-search.ts` 和 `memory-host-sdk/host/types.ts` 对 `memory.search` 的权限、请求和结果类型定义。

**当前行为**：`src/pages/memory-explorer/MemoryExplorerPage.tsx` 保留通过受保护桌面 IPC 浏览当前 OpenClaw 工作区 `MEMORY.md` 与 `memory/` Markdown 的只读视图，并增加显式 Gateway 检索和 Gateway diagnostics 视图。Gateway 视图只调用官方 `memory.search`；diagnostics 视图按能力广告、连接和最新请求栅栏调用只读的 `doctor.memory.status` 与 `doctor.memory.remHarness`，不接入修复类方法。具体见 [OpenClaw 原生记忆诊断对齐](openclaw-native-memory-diagnostics-alignment-2026-08-03.md)。

**可拓展**：OpenClaw 自身就是 memory 的权威持有者。当前已接入 `memory.search`、`doctor.memory.status` 和 `doctor.memory.remHarness`，让 Gateway 返回持久记忆检索与显式只读诊断；后续只能在取得官方字段、权限和生命周期证据后继续扩展，不得把它们扩展成 JunQi 私有 CRUD。

**边界**：`doctor.memory.*` 家族中大部分是修复类操作（`resetDreamDiary`、`repairDreamingArtifacts` 等），属于破坏性动作，只应接入只读的 `status` 与 `remHarness`，不应把修复操作放进浏览界面。

### EXT-G · 剩余会话事件

优先级：中

审计时 `session.operation`、`session.ready`、`session.replaced` 三个标识未在 JunQi 的通用 ChatHandler 中处理。当前 `session.operation` 已按官方 schema 接入本地压缩事件投影，具体见 [会话操作事件对齐](openclaw-session-operation-alignment-2026-08-03.md)。官方当前文档把 `session.ready` 与 `session.replaced` 定义为 managed-room `talk.session.join` 的 Talk 事件；JunQi 当前只创建 gateway-relay Talk session，不调用 managed-room join，因此不把这两个事件伪装成普通会话生命周期。

**待验证**：如果未来接入官方 managed-room Talk，必须先取得其事件 payload 和连接所有权证据，再单独设计 join/replacement 状态；`session.operation` 的字段已由官方当前 schema 确认，不再属于待验证项。

### EXT-H · 任务与定时的完整视图

优先级：低

`tasks.list`、`tasks.cancel`、`cron.get`、`cron.status` 未使用（`tasks.get` 仅出现在协作测试的 mock 中）。JunQi 有 `CronMonitor.tsx`（1022 行），但缺 `cron.status` 这一权威状态来源。

## 排期建议

分三批，每批结束后重新核对，不合并成一次大改动。

**第一批 · 低风险高收益**，不需要权限变更也不需要协议迁移：

1. IMP-08 版本一致性自动检查，改动最小且已连续两版重现
2. IMP-07 状态词汇统一，直接对齐 OpenClaw 7 值口径（同时消化 EXT-A 的状态部分与 IMP-06 的一部分）
3. EXT-A 的 `audit.list` 接入
4. IMP-03 的 IPC 边界 52 处 `any`
5. IMP-06 剩余用户可见文案，重点是 `AgentWorkspace/index.tsx` 的 51 行

**第二批 · 产品能力补齐**：

6. EXT-B 会话预览、压缩、steering 与转录检索
7. EXT-C `tools.effective`（同时闭环 BUG-OCA-02）
8. IMP-05 PTY 与终端的锁毒性
9. IMP-01 按风险补测试，从 `src/utils` 与 `src/components/Terminal` 开始

**第三批 · 需要独立立项**：

10. EXT-A 的审批协议后续阶段：事件订阅、策略管理和正式 trace 对齐（pending list/resolve 已接入，仍涉及 `operator.approvals` 权限提升）
11. EXT-D 技能协议迁移（涉及既有安装记录）
12. EXT-E 产物协议（当前 session scope 已接入；run/task scope 待真实场景验证）
13. EXT-F Memory 只读接入（`memory.search`、`doctor.memory.status/remHarness` 已接入；写入/修复方法保持禁止）
14. IMP-02 大文件拆分，只在其他任务顺带触及时进行

## 不建议做的

- **不要为了降低 `any` 总数做全仓替换**。290 处非 IPC 的 `any` 没有契约漂移风险，批量修改的回归成本高于收益。
- **不要以覆盖率百分比为目标补测试**。`AGENTS.md` 要求测试行为与跨边界契约，凑数的渲染快照测试会增加维护成本而不增加保障。
- **不要一次性拆分大文件**。61 个文件近 10 万行，批量重构会与并行开发大面积冲突，且违反最小改动原则。
- **不要把 `doctor.memory.*` 的修复类操作接进 UI**。
- **不要因为接入官方协议就删除现有本地能力**，直到确认官方协议覆盖了全部既有场景。

## 未验证边界

- 本文是历史审计，外部契约结论主要来自当时的 OpenClaw `2026.7.1-2` 随包文档；新增或修改集成必须以 OpenClaw 当前官方文档、源码、schema 和 handler 为准，安装版本只记录复现范围。
- 当时安装包的 `src/` 目录仅含 `agents/`，运行时为打包产物；因此历史审计没有确认 `AuditEvent`、`session.operation`、`tools.effective`、`artifacts.*` 的精确字段。当前 `session.operation` 已在独立对齐记录中由官方主线 schema 确认。
- 172 个未使用 RPC 的「不适用」判断基于文档描述与 JunQi 产品形态推断，未逐个验证。
- 测试覆盖缺口的判定基于「同名测试文件」与「文件名在测试正文中出现」两个信号。通过间接依赖被覆盖的文件可能被误判为无覆盖，159 这个数字是上界。
- 61 个大文件仅按结构阅读，未逐行通读，不排除其中存在本文未发现的缺陷。
- 本文未做任何实现改动，因此不涉及测试与构建验证。
