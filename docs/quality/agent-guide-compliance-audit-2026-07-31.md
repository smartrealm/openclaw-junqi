# CLAUDE.md 全量合规审查

日期：2026-07-31

## 审查契约

审查标准是仓库根目录的 `CLAUDE.md` 及其通过 `@AGENTS.md` 导入的共享规范。审查对象是当前工作区的全部已跟踪文件。

- 基线 commit：`daxia@d856ef9`（重构：整理提供商模型目录）
- 分支状态：审查执行时 `main` 领先 `daxia` 4 个 commit（`ddb0d2c`、`10518b4`、`462c273`、`4a396f0`）且尚未合并。下列结论均针对基线 commit 成立；合并 `main` 后应重新核对，FIND-07 已确认由 `main` 侧修复
- 工作区状态：仅 `CLAUDE.md` 一处未提交修改（本轮同步进行的 Claude 专属约定整理）
- 规模：1098 个 TS/TSX、118 个 Rust、191 个 Markdown；模块边界检查覆盖 666 个文件
- 本审查为只读审查，除本文件与 `docs/README.md` 索引项外未修改任何源码或配置

本文按 `AGENTS.md` 的 Emoji 禁止规则书写。凡需指代 Emoji 字符处一律使用 Unicode 码位记法，不写入字面 Emoji。

## 自动化门禁实测结果

以下命令在基线 commit 上实际执行并取得输出：

| 命令 | 结果 |
| --- | --- |
| `node scripts/check-boundaries.mjs` | 通过，666 个文件，无违规 |
| `pnpm test`（`src` 套件） | 2001 项全部通过，0 失败、0 跳过 |
| `pnpm test`（`scripts` 套件） | 224 项全部通过，0 失败、0 跳过 |
| `cargo fmt -- --check` | 通过，退出码 0 |
| `cargo test --lib` | 664 项通过、3 项显式忽略，单套件 8.43s |
| `pnpm verify:openclaw-docs` | 通过，核对 55 个官方链接与锚点 |
| `pnpm collab:validate` | 通过，`junqi-collab package contract: ok` |
| `git diff --check` | 通过 |

TypeScript 类型检查不在上表内。本文初版曾记录 `npx tsc --noEmit` 在基线上通过，该记录不成立：`npx` 当时并未解析到项目内的 TypeScript 编译器，命令没有真正执行类型检查。基线上的类型检查结论因此撤销，替代验证见「合并后复核」。

未执行：`pnpm build`（Vite 生产构建）、`pnpm collab:test`、`collab:gateway:smoke`、`collab:gateway:behavioral`、`pnpm tauri build`。因此本轮结论覆盖到「自动化通过」层级，不覆盖生产打包、真机验收与发布签名。

## 已核实的合规项

以下项目经交叉核对确认符合规范，非仅凭文档声明：

### Tauri IPC 契约完整闭合

对 `src-tauri/src/lib.rs` 的 `generate_handler!` 列表、全仓 `#[tauri::command]` 定义和前端 `invoke` 字面量做了三方核对：

- 注册项 299 个，`#[tauri::command]` 函数 299 个
- 定义但未注册：0
- 注册但无定义：0
- 重复注册：0
- 前端调用但未注册：0（前端出现 260 个 `invoke` 字面量，全部命中注册表）

这项契约在 `AGENTS.md` 工程边界一节中是硬性要求，当前状态无漂移。

### 硬编码配置路径（FCA-02）确已闭环

`docs/quality/full-codebase-audit-2026-07-29.md` 将 FCA-02 记为「已闭环并有守护测试」。逐行核对结果支持该结论：

- `openclaw.json` 在 Rust 中共出现 125 处，其中 113 处在代码行、12 处在注释
- 按 `#[cfg(test)]` 边界归类后，生产代码路径只剩两处具名常量：`src-tauri/src/commands/docker.rs:23` 的 `OPENCLAW_CONTAINER_CONFIG_PATH`（容器内官方路径）与 `src-tauri/src/commands/collaboration_bootstrap.rs:53` 的 `CONFIG_BACKUP_FILE_NAME`
- 其余全部位于测试模块的临时目录夹具，属于审计契约明确排除的「测试夹具」
- 路径构造集中在 `src-tauri/src/paths.rs`

### 凭据未越界

- 全仓已跟踪文件扫描 `sk-`、`ghp_`、`AKIA`、`xoxb-`、PEM 私钥头，仅命中 3 处，全部是 `scripts/evidence-content-policy.test.mjs` 与 `scripts/validate-external-release-evidence.test.mjs` 中用于验证脱敏逻辑本身的合成样本
- `localStorage.setItem` 未写入任何 token、secret 或 API key，命中项均为主题、字体、标签页等偏好键常量
- `console.log`/`warn`/`error` 未打印 token、apiKey 或 secret

### 版本三处一致

`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 均为 `1.5.0`，符合 `AGENTS.md` 的三处一致要求。但 `src-tauri/Cargo.lock` 存在同源漂移，见 FIND-07。

### 无遗留标记

`src/` 与 `src-tauri/src/` 中 `TODO`、`FIXME`、`HACK`、`XXX` 计数为 0。

## 发现的问题

### FIND-01 · Emoji 禁止规则被系统性违反

严重度：高（直接违反 `AGENTS.md` 中措辞最强的一条规则）

`AGENTS.md` 规定「严禁在回复、代码、注释、文档、配置、测试快照、提交信息和其他任何写入内容中使用 Emoji」，且要求写入前扫描全部内容。当前仓库中 23 个已跟踪文件、108 行含有 Emoji 表现形式的码位。

检测口径：Emoji_Presentation 默认为 Yes 的码位，加上带 U+FE0F 变体选择符的序列。箭头（U+2192 等）、U+2713 对勾、制表符号等文本表现字符不计入，因此下列数字不含 `AGENTS.md` 未禁止的排版符号。

生产与测试代码，11 个文件 41 行：

| 文件 | 行数 | 性质 |
| --- | --- | --- |
| `src/processing/messageParsingShared.ts` | 15 | 解析 OpenClaw 上游输出中的 Emoji 标记 |
| `src/services/gateway/Connection.ts` | 9 | 调试日志装饰（U+2705、U+274C） |
| `src/processing/buildSemanticBlocks.test.ts` | 4 | 上游输出格式的测试夹具 |
| `src/pages/ConfigManager/providerTemplates.ts` | 3 | provider 图标字段（U+1F30B、U+1F536、U+1F999） |
| `src/utils/exportChat.ts` | 3 | 导出 Markdown 的角色与工具前缀 |
| `src/stores/calendarStore.ts` | 2 | 写入任务名与提醒文案（U+1F4C5、U+23F0） |
| `src/pages/SkillsPage/index.tsx` | 1 | 按钮文案（U+2B50） |
| `src/pet/PetBreakOverlay.tsx` | 1 | 界面文案（U+2728） |
| `src/processing/TextCleaner.ts` | 1 | 匹配上游 compaction 提示串 |
| `src/utils/theme-colors.ts` | 1 | 源码注释（U+26A0 U+FE0F） |
| `src/pages/maintenancePages.design.test.ts` | 1 | 禁用 Emoji 的守护断言正则本身 |

CI 配置，2 个文件 6 行：`.github/workflows/ci.yml`（2 行）、`.github/workflows/release.yml`（4 行），均为 job 名称与 summary 输出中的 U+2705。

文档，10 个文件 61 行，其中 `docs/quality/full-codebase-audit-2026-07-29.md` 14 行、`docs/installation/install-diagnostics-audit.md` 11 行、`docs/previews/usage-icons-preview.html` 9 行，用法是审计条目的严重度色标（U+1F534、U+1F7E1）与预览页标题装饰。

需要区分处理，不能一刀切删除：

- 纯装饰类（provider 图标、按钮与界面文案、调试日志、源码注释、CI job 名、文档色标、预览页标题）无外部契约约束，应直接清除或换为纯文本，共约 80 行；
- 协议驱动类（`messageParsingShared.ts`、`TextCleaner.ts` 及其测试夹具）中的 Emoji 来自 OpenClaw 上游输出格式，删除会破坏解析契约。当前 `AGENTS.md` 的禁令没有为「匹配第三方输出所必需的字面量」留出例外，这是规范本身的缺口；
- `src/pages/maintenancePages.design.test.ts:14` 的断言正则必须包含被禁字符才能守护该规则，属于同类矛盾。

建议：先清理装饰类；同时在 `AGENTS.md` 中为「解析或断言第三方输出所必需的字面量」增加显式例外并要求集中到单一常量模块，使规则可完全执行而不是长期部分失效。

### FIND-02 · 安装流程变更未同步首次启动流程图

严重度：中

`AGENTS.md` 要求「安装或首次启动流程变化时，同时检查并更新 `docs/previews/junqi-first-run-flow.html`」。

- `docs/previews/junqi-first-run-flow.html` 最后一次改动：`da9fd2d`（2026-07-30）
- 安装相关 Rust 源码最后一次改动：`c6c5bfc`（2026-07-31，「修复：收敛安装与运行时状态边界」）
- `c6c5bfc` 新增 `src-tauri/src/commands/setup_progress.rs`（109 行新文件），并改写 `src-tauri/src/commands/setup/openclaw.rs`（270 行），同时改动 `src/hooks/useSetupFlow/` 与 `setupProgressEvents.ts`

该 commit 引入了以 native operation ID 绑定进度事件的新语义，属于安装流程行为变更，但预览流程图未同步，配套记录 `docs/quality/installation-dashboard-chat-provider-channel-runtime-boundary-remediation-2026-07-31.md` 也未说明是否检查过该文件。`AGENTS.md` 同时规定「线上流程图当前不是自动部署产物，不得声称已同步」，因此这里既缺同步动作也缺「已检查、无需更新」的显式记录。

### FIND-03 · IPC 适配层用 any 遮蔽契约

严重度：中

`AGENTS.md` 明确「禁止用 `any`、强制断言或静默默认值掩盖 IPC 契约漂移」。

- `src/api/tauri-adapter.ts` 中 `any` 出现 48 次，其中 22 次直接是 `invoke` 返回值的类型标注（形如 `const s: any = await invoke("gateway_status")`、`const info: any = await invoke("get_platform_info")`、`const result: any = await invoke("restart_gateway", {})`）
- `src/api/tauri-commands.ts` 中 `any` 为 0，说明项目内已有更严格的写法可作为收敛目标

这正是规则针对的场景：Rust 侧 `serde(rename_all = ...)` 改名或字段增删时，`any` 会让 TypeScript 编译期完全失去检测能力。全仓 `any` 共 465 处，其余集中在测试文件（`ChatHandler.test.ts` 90 处）与页面组件，优先级低于 IPC 边界。

### FIND-04 · 24 个已注册 Tauri command 无任何调用方

严重度：中（其中凭据类为安全相关）

299 个注册 command 中，39 个未出现在前端 `invoke` 字面量里。逐个在全仓 TS/JS/JSON（排除 `node_modules` 与 `dist`）中做文本检索后，其中 15 个经由包装函数或动态名调用，另外 24 个在前端零引用：

```
delete_provider_secret        get_provider_secret           list_provider_secrets
read_provider_api_key         store_provider_secret         start_provider_oauth
detect_agent_paths            docker_gateway_status         get_agent_config_file_path
get_dynamic_island_visible    get_gateway_lifecycle         get_quickchat_visible
get_terminal_integration_status  git_create_branch          prepare_builtin_skill
read_agent_config_file        reposition_dynamic_island     return_to_desktop
save_app_settings             stop_docker_gateway           voice_wake_status
write_agent_config_file       write_models_log              write_project_config
```

抽样核实：`store_provider_secret`、`get_provider_secret`、`delete_provider_secret`、`list_provider_secrets`、`read_provider_api_key`、`start_provider_oauth`、`save_app_settings`、`detect_agent_paths` 在全仓 TS/JS 中命中数均为 0，在 Rust 中命中数为 2 至 4，即仅有定义与注册两处。

前 6 个是 provider 凭据读写与 OAuth 启动接口。`AGENTS.md` 要求「Secret、Gateway token、Provider key 和设备凭据只存在于最小必要边界」。一组无调用方却对 WebView 暴露的凭据 command 不符合最小边界原则，应确认是待接入功能还是历史残留，并据此接入或摘除注册。

### FIND-05 · 验证记录的测试计数与当前 HEAD 不符

严重度：低

`docs/quality/installation-dashboard-chat-provider-channel-runtime-boundary-remediation-2026-07-31.md:42` 记「`pnpm test` 通过，1994 项前端和脚本测试全部成功」。

`pnpm test` 实际串联两个套件。本轮实测为 `src` 套件 2001 项、`scripts` 套件 224 项，合计 2225 项。`c6c5bfc` 之后仅有 25 行测试新增（`ConfiguredModelDirectory.test.ts`），不足以解释 2225 与 1994 的差额，因此原记录的 1994 更可能只统计了 `src` 套件却描述为「前端和脚本测试」。

`AGENTS.md` 要求验证结论精确可复现，这类计数与口径偏差应在记录时写明套件划分。

### FIND-06 · 全量审查仍有未闭环条目

严重度：低（属已知在办事项，非新增偏差）

`docs/quality/full-codebase-audit-2026-07-29.md` 当前状态表显示：FCA-14 处于「分域拆分进行中（wire contract 已提取，其余子域待迁移）」，FCA-05 与 FCA-07 为「已分类，保留有理由的例外」。该文档的状态描述与实施记录自洽，且已明确修正过一次此前的过度声明，符合 `AGENTS.md` 对状态诚实性的要求，此处仅作为未闭环项登记。

### FIND-07 · 1.5.0 发布未同步 Cargo.lock（`main` 已修复，本分支待合并）

严重度：中；本分支状态：待合并，非待修复

`AGENTS.md` 要求版本发布保持 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 三处一致。这三处确实一致，但同一次发布遗漏了锁文件。

- 发布 commit `d6cce66`（发布：升级至 1.5.0）只改动了 `README.md`、`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 四个文件
- 在本次审查基线 `daxia@d856ef9` 上，`src-tauri/Cargo.lock` 中 `junqi-desktop` 仍记为 `version = "1.4.21"`，该文件最后一次改动是 `151deb3`（2026-07-30）
- 本轮执行 `cargo test --lib` 时 cargo 自动改写了锁文件，该工作区改动已还原，不计入本次提交

复核分支状态后确认：`main` 分支已由 `4a396f0`（修复：同步桌面版本锁文件，2026-07-31 17:16）做出与之完全相同的修改，即该缺陷在上游已闭环，只是尚未合并回 `daxia`。因此本条不需要新的修复动作，合并 `main` 即可消除。

影响仍值得记录：已提交的锁文件与 `Cargo.toml` 声明版本不符时，任何干净检出的 Rust 构建都会先重写锁文件，锁文件不再是发布制品的可信版本证据。核对 `.github/workflows/` 后确认 cargo 步骤未使用 `--locked`，因此不会导致 CI 失败；只有 pnpm 侧使用了 `--frozen-lockfile`。

建议把 `src-tauri/Cargo.lock` 纳入发布版本一致性检查清单，与现有三处并列，避免同类遗漏重复发生。

## 结论

自动化门禁全绿，IPC 契约、配置路径单一来源、凭据边界与版本一致性等硬约束经交叉核对确认无漂移，工程质量基线扎实。

未达标的是三类：Emoji 禁令在 23 个文件中系统性失效且规则本身缺少必要例外（FIND-01）；安装流程变更未按规范同步预览流程图（FIND-02）；IPC 适配层与凭据 command 的边界收紧未完成（FIND-03、FIND-04）。FIND-05 与 FIND-06 是记录精度与在办进度问题。FIND-07 已在 `main` 侧闭环，合并即可消除。

建议处理顺序：FIND-02 与 FIND-04 影响用户可见行为与安全边界，优先；FIND-01 需要先补规范例外再批量清理，否则清理动作会与协议解析冲突；FIND-03 可随 IPC 相关改动逐步收敛。

## 合并后复核

审查提交后，`main` 的 4 个 commit 已合并进 `daxia`（合并提交 `b31ea3a`，无冲突）。在合并结果上重新执行验证，并修正了基线记录中的一处失效结论：

| 命令 | 结果 |
| --- | --- |
| `node scripts/check-boundaries.mjs` | 通过，668 个文件，无违规 |
| `pnpm exec tsc --noEmit`（TypeScript 5.9.3） | 通过，退出码 0，无输出 |
| `src` 测试套件 | 2009 项，2008 通过、1 失败（该失败见 FIND-08，已在本轮修复，修复后 2009 项全通过） |
| `scripts` 测试套件 | 224 项全部通过 |

复核期间发现工作区的 `node_modules` 已不存在，`pnpm lint` 因此只报出「Linter process terminated abnormally」而没有真正执行 `tsc`。执行 `pnpm install --frozen-lockfile` 恢复依赖后，上表结果才是真实的。基线上那次 `npx tsc --noEmit` 属于同一原因导致的假阳性。

### FIND-08 · `main` 侧 i18n 迁移使守护测试失效

严重度：中；引入来源：`main@10518b4`，非本次合并

`src/pages/AgentWorkspace/worktreeForget.test.ts` 的用例 `forget action explicitly does not claim directory deletion` 失败：

```
AssertionError: The input did not match the regular expression /从工作台移除（不删除目录）/
```

该测试直接读取 `src/pages/AgentWorkspace/index.tsx` 源码，断言「从工作台移除」按钮的文案显式声明不删除目录。`main@10518b4`（优化：统一工作区导航与会话首屏体验）把该按钮改为 `WorkspaceChrome` 的 `IconButton`，文案迁移到 i18n key `agentWorkspace.forgetWorkspace`，其值为「从工作台移除 {{name}}」，「（不删除目录）」限定语在迁移中丢失，但守护测试未同步。

核实结论：该字符串在 `main` 与合并结果中计数均为 0，在合并前的 `daxia@07b7bae` 中计数为 2，且该测试文件在 `main` 上同样存在。因此这是 `main` 自身已存在的红灯，合并只是把它带入 `daxia`，不是合并冲突或本次改动引入。

用户仍会在确认弹窗看到该保证：`src/locales/zh.json` 的 `removeProjectConfirm` 为「确定从工作台移除“{{name}}”吗？不会删除本地项目目录。」丢失的只是按钮 tooltip 上的即时提示。

处理结果：已修复。采用恢复原有安全提示的方案，理由是限定语的丢失是 i18n 迁移的附带损失而非产品决定，恢复迁移前的行为比追认回归更保守。

- 三份 locale 的 `agentWorkspace.forgetWorkspace` 补回限定语：`zh` 为「从工作台移除 {{name}}（不删除目录）」，`zh-TW` 为「從工作臺移除 {{name}}（不刪除目錄）」，`en` 为 `Remove {{name}} from workspace (the folder is not deleted)`
- 守护测试改为核对 i18n 契约而非源码字面量：断言 `index.tsx` 通过 `t('agentWorkspace.forgetWorkspace')` 绑定文案，并逐一断言三份 locale 的该键都声明不删除目录；`delete_worktree|remove_dir|delete_path` 与侧栏结构断言保持不变

这样测试不再因为文案从源码迁到 locale 而失效，同时守住了原本要守的承诺。已用两组反证确认该测试可失败：把任一 locale 的限定语删掉，或把按钮改回不走 i18n key，测试都会失败。

## 未验证边界

- 未执行 `pnpm build`、`pnpm collab:test` 及协作 Gateway 冒烟与行为验证，构建产物层面的结论不在本次覆盖范围
- 合并结果上未重跑 Rust 验证。`main` 的 4 个 commit 只改动前端与文档，未触及 `src-tauri/src/`，但这是基于 diff 范围的推断，不是实测
- 未执行 `pnpm tauri build`，未做任何签名、公证或安装包验证
- 未在 Windows NSIS/UAC/凭据管理器、Docker Desktop 冷启动、macOS Keychain 环境做真机验收
- 未使用真实 Gateway、真实 provider 凭据或真实渠道账号做端到端人工测试
- Native 与 Docker 运行时绑定规则只做了静默回退的关键词与回归测试检索，未做全路径追踪
- FIND-04 的判定基于全仓文本检索。若存在通过运行期字符串拼接构造 command 名的调用方，本方法无法发现
