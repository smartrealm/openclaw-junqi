# 全量代码审查（2026-07-29）

状态：原始只读审查完成；2026-07-30 分批修复进行中。实施契约见 `specs/quality/2026-07-30-full-codebase-audit-remediation.md` 与 `plans/quality/2026-07-30-full-codebase-audit-remediation.md`。

分级进度（以代码复核为准，不以批次声明为准）：

| 分级 | 条目 |
| --- | --- |
| 已闭环并有守护测试 | FCA-01、FCA-02、FCA-03、FCA-04、FCA-06、FCA-08、FCA-09、FCA-10、FCA-11、FCA-12、FCA-13 |
| 已分类，保留有理由的例外 | FCA-05、FCA-07 |
| 分域拆分进行中 | FCA-14（wire contract 已提取，其余子域待迁移） |

前一版状态行把 FCA-02 与 FCA-11 记为「已自动化验证」，但当时 `collaboration_bootstrap.rs`、`system.rs` 仍有 4 个 Native 配置路径构造点，三份 locale 仍各有一份 Memory API 端点副本，且两项都没有守护测试。该表述已按代码事实更正，两项已在 2026-07-30 第二阶段真正闭环。

## 审计契约

本次审查针对以下五项要求全量扫描 `src/`（923 个 TS/TSX）与 `src-tauri/src/`（116 个 Rust），约 25 万行：

1. 不得存在硬编码路径、目录、端口与配置；
2. OpenClaw 相关路径、目录与配置必须来自官方契约或经版本审查的兼容契约；
3. UI 易用且统一；
4. 不得存在 demo / 验证性代码进入生产；
5. 必须封装、抽象、多态，组件必须复用。

以下不计入违规：

- OpenClaw CLI、Gateway RPC、容器协议本身的字段与路径；
- 测试夹具、locale 文案、不参与写配置的示例数据；
- provider catalog 一类有官方来源与回归测试的数据表；
- 主题预览组件中用于渲染色板本身的色值。

## 基线

审查开始时仓库状态：

- `node scripts/check-boundaries.mjs`：通过，609 个模块边界干净。
- `npx tsc --noEmit`：无错误。
- 全仓库无 `TODO` / `FIXME` / `HACK` / `mockData` / `dummyData` 标记。

因此本文件记录的全部是结构性问题，不是编译期或边界期问题。

## 当前代码复核（`f44c630`）

复核时间：2026-07-30。复核方式为逐项读取定义、调用方、生成脚本与固定版本依赖，并重新执行只读统计；本节保留原始审计快照，同时记录当前代码与原文之间的差异。状态中的“确认”表示问题仍存在，不表示已经修复。

当前基线：

- `src/` 中 TS/TSX 已由原审计的 923 个增长到 938 个，`src-tauri/src/` 仍为 116 个 Rust 文件；
- `node scripts/check-boundaries.mjs`：通过，当前检查 618 个模块；
- `pnpm exec tsc --noEmit --pretty false`：通过；
- 生产源码仍无 `TODO` / `FIXME` / `HACK` / `mockData` / `dummyData` 标记。

| 条目 | 当前状态 | 复核结果 |
| --- | --- | --- |
| BUG-FCA-01 | 确认，统计修正 | `DynamicIslandRuntime.tsx` 虽已使用 `useTranslation()` 生成会话标题，但独立窗口中的 `DynamicIsland.tsx` 仍直接读取 `navigator.language`，现有 `chinese ?` 分支为 45 处而非 40 处，三份 locale 仍无该窗口完整文案契约。应用内语言与繁体中文问题均成立。 |
| BUG-FCA-02 | 确认，原统计口径错误 | Native 配置文件名仍未形成单一常量，`paths.rs`、`runtime_identity.rs`、`state_dir_probe.rs`、collaboration staging 等生产路径仍直接构造 `openclaw.json`。原文“10 个文件、71 处生产硬编码”不准确：当前 Rust 树共 132 个文本命中，其中 98 个位于各文件 `#[cfg(test)]` 测试段；剩余 34 个还包含注释、错误文案、Docker 协议常量和 `original-openclaw.json` 备份名，不能全部算作 Native 路径硬编码。问题成立，但修复前应以路径构造点而非字符串总数建立回归清单。BUG-OCA-06 的“已完成”结论仍与 Native 重复事实冲突。 |
| BUG-FCA-03 | 确认 | 12 个 `ui/` 组件的消费者关系基本与原文一致：8 个纯样式组件仍仅被 `UIShowcase` 使用；生产侧仍使用 dialog、select、dropdown-menu、tooltip，且 popover 仍被直接消费。dropdown-menu 当前另有 `FileViewerToolbar` 消费者，生产消费者不再只有原文列出的 ResultCards。原生 `<button>` 仍精确为 838 处、147 个文件；Aegis shared button/badge/alert/copy-button 的 import 消费者仍分别为 3/3/4/1；`shadcn-tokens.css` 仍由全局样式加载。 |
| BUG-FCA-04 | 确认，消费者描述修正 | 四套共享状态呈现仍并存，两个不同模块仍各自导出 `StatusDot`。但 `StatusBadge.tsx` 已不是“无外部消费者”：当前由 `AgentRunView.tsx` 与 `ActivityCenter.tsx` 使用；`StatusIcon` 的消费者也已扩展。应继续收敛，但迁移计划不能再按死代码删除 `StatusBadge`。 |
| BUG-FCA-05 | 确认 | `ui/switch.tsx`、`SettingsSwitch.tsx`、Config Manager 的 `ToggleSwitch` 与 `ThemePicker.tsx` 内联 `role="switch"` 均仍存在。生产代码有 3 处显式 `role="switch"`，Radix Switch 仅由 `ui/switch.tsx` 引用且该组件仅供 showcase 使用。 |
| BUG-FCA-06 | 确认，统计轻微漂移 | 非测试生产源码中 `LoadingIndicator` 符号出现在 11 个文件；`Loader2` 与 `animate-spin` 同一 JSX 元素当前为 110 处、45 个文件，而非原文的 109 处、48 个文件。仍未发现手写 border spinner class。收敛问题与 reduced-motion / live-region 风险成立。 |
| BUG-FCA-07 | 确认，表述细化 | 仍不存在共享 `EmptyState` 原语；但仓库并非没有任何 EmptyState：`CodeInterpreter.tsx`、`FileManager.tsx` 等页面存在局部实现，另有 `WorkspaceEmptyState`、`EmptySection`、`EmptyOrWaiting`。问题应表述为“多处局部实现但无共享契约”，而非单纯依赖文件名搜索。 |
| BUG-FCA-08 | 确认，原总数不可直接沿用 | 当前非测试 TSX 中十六进制字面量原始命中为 113 处、31 个文件，高于原文的 95/26；其中包含主题预览、宠物/SVG 固有配色、终端搜索标记色、注释中的 issue 编号等合理或需分类项，不能把 113 全部判为违规。`TerminalNotificationPanel.tsx` 的深色背景/前景、`StatusDot.tsx` 的 sleeping 色、Git diff 色值及多处控件色仍明确绕过 Aegis token，问题成立，修复前需逐项划分“产品 UI token”与“内容/画布固有颜色”。 |
| BUG-FCA-09 | 确认 | `UIShowcase.tsx` 仍由 `AppRouteTree.tsx` 懒加载，`/ui-showcase` 仍无 `FeatureRoute`；`tab-utils.ts` 还把它归入 settings tab。8 个纯样式 `ui/` 组件仍只有该页面一个消费者，因此生产 demo 与连带死依赖判断成立。 |
| BUG-FCA-10 | 确认 | `settingsStore.ts` 仍直接回退到 `ws://127.0.0.1:18789`，`credentialProvider.ts` 仍定义同值的 `DEFAULT_GATEWAY_URL`；两处均绕过 `runtimeDefaults.ts`。测试目前只禁止 `SettingsPage.tsx` 出现该字面量，未覆盖这两个事实消费者。 |
| BUG-FCA-11 | 确认 | `settingsStore.ts` 与 `MemoryExplorer.tsx` 仍各自写死 `http://localhost:3040`；三份 locale 还重复同一 placeholder。`runtime-defaults.json` 仍只包含 Gateway host/port。应先明确 Memory API 是否属于产品默认运行时契约，再将运行默认值与纯展示 placeholder 分层。 |
| BUG-FCA-12 | 已复现，不再“待验证” | 仓库 `mediaCatalog.generated.ts` 仍为空，Providers 页选项确实退化为“catalog + 当前值”。生成脚本已经实现 media 分支；在隔离临时目录中以当前安装的 OpenClaw 2026.7.1 系列包执行，成功生成 18 个图片模型和 56 个视频模型。根因边界也已确认：仓库没有 bundled OpenClaw package root 时脚本会保留既有 media 文件，而 `pnpm build` 不调用 `generate:provider-catalog`；该空文件自初始提交起存在且没有生成回归测试。具体修复仍需定义可复现的构建输入，不能依赖开发机全局 OpenClaw。 |
| BUG-FCA-13 | 确认 | `README.md` 仍写 1.4.14；`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 仍一致为 1.4.18。 |
| BUG-FCA-14 | 确认，统计口径修正 | 文件当前总长 8787 行，`#[cfg(test)]` 从第 7001 行开始，因此生产段仍为 7000 行。全文件 206 个函数，但生产段为 149 个；生产段有 28 个 struct/enum、8 个 Tauri command。原文“2 个 impl”只计算了两个领域类型的顶层 impl，生产段另有一个函数内局部 `Drop` impl。当前第二大 Rust 文件已是 `storage.rs`（4465 行），不再是原文所述 `system.rs`。单体拆分结论仍成立。 |

复核后的总体结论：14 个问题方向在 `f44c630` 基线均成立；其中 BUG-FCA-12 已取得可复现证据，BUG-FCA-02、04、06、07、08、14 的原始统计或描述需要按上表修正。2026-07-30 后续修复进度以本文件顶部状态及对应 spec/plan 为准。

### 2026-07-30 第一阶段实施结果

已完成并验证：

- FCA-01：灵动岛全部窗口文案接入应用 i18n，删除 `navigator.language` 与中英文三元分支，补齐三种语言；
- FCA-02：`paths.rs` 导出 Native 配置文件名及构造函数，Native/Docker host 路径调用方统一消费，容器协议路径与 collaboration 备份名保持独立；
- FCA-03/FCA-09：删除生产 `/ui-showcase`、tab 映射、8 个 showcase-only 组件及 5 个无消费者依赖；保留的 Radix 行为原语改为直接映射 Aegis token，删除 `shadcn-tokens.css`；
- FCA-10/FCA-11/FCA-13：Gateway 与 Memory API 默认值收敛到 `runtimeDefaults`，README 版本同步到 1.4.18；
- FCA-12：生成器从 workspace 锁定的 OpenClaw 包解析，不再依赖开发机全局安装；媒体产物现含 18 个图片模型与 56 个视频模型，并有非空回归；
- FCA-05/FCA-07 基础：新增共享 `Switch` 与 `EmptyState`，迁移 Settings、Config Manager 及两个页面局部空状态；剩余消费者尚未全部迁移；
- FCA-06 首批：`StatusBadge` 的 running spinner 已改用 `LoadingIndicator`，剩余 `Loader2 + animate-spin` 为 109 处。

自动化结果：`pnpm lint`、`pnpm build`、完整前端 1875 项、脚本 224 项、Rust 652 项（3 项既有环境测试 ignored）、collaboration 368 项、plugin package validation、55 个官方 OpenClaw 链接、`cargo fmt -- --check`、`cargo check --lib` 与 `git diff --check` 均通过。四主题视觉验收和目标平台真机验收尚未执行。

### 2026-07-30 第二阶段实施结果

本阶段起点是对第一阶段结论的逐项代码复核，因此先修正了两处被高估的状态。

**FCA-02 真正闭环。** 第一阶段建立了 `paths::OPENCLAW_CONFIG_FILE_NAME`，但四个构造点仍绕过它：`collaboration_bootstrap.rs` 的两处 `.unwrap_or("openclaw.json")` 与备份目标路径、`system.rs` 的 smoke 探测配置路径。现在前者消费共享常量，备份名提升为模块级 `CONFIG_BACKUP_FILE_NAME` 并注明它是 collaboration 拥有的产物名（恢复走 journal 记录的 `original_config_backup_path`，不重建此名），`system.rs` 改用 `paths::native_config_path`。新增 `paths.rs` 的 `native_config_authority_tests`：除行为断言外，扫描 `paths.rs`、`system.rs`、`state_dir_probe.rs`、`runtime_identity.rs`、`collaboration_bootstrap.rs` 的生产段，只允许 `const` 声明拼写该文件名。该测试已验证可在修复前失败，并精确指向 `system.rs:1720`。

**FCA-11 真正闭环。** 三份 locale 的 `memoryApiPlaceholder` 是端点副本且无任何消费者（无静态引用，也无动态键拼接），已删除。新增 `BUG-FCA-11` 回归，禁止任何 locale 重述 Gateway 或 Memory API 端点。

**FCA-04 收敛完成。** 新增 `src/components/shared/status/statusTone.ts` 作为唯一状态语义域：9 个无同义的规范 tone、一张把三套历史词汇与跨层任务/启动/聊天/看板词汇归一化的别名表、以及唯一的 token 取色表。三种呈现形态保留（点、图标、徽章）——它们是真实不同的 UI 需求——但都改为消费该语义域：

- 删除 `shared/StatusDot.tsx`（重复实现，且含硬编码 `#424242`）；两个消费者改用共享 `StatusDot`；
- `shared/StatusBadge.tsx` 内的第三个同名 `StatusDot` 无外部消费者，改为从共享原语再导出；
- `badge/Badge.tsx` 的 `StatusDot` 成为唯一实现，支持数字直径以覆盖原 A 的用法，颜色/发光经 CSS 变量注入，`badge.module.css` 因此不再维护第二张颜色表，并新增 `prefers-reduced-motion` 降级；
- `StatusIcon.tsx` 的长 switch 改为「形状查表 + 统一取色」，消除 `var(--success)` / `var(--danger)` / `--aegis-primary` 混用；
- 新增 `--aegis-status-dormant` 到四个主题（替代原硬编码灰），并补 `status.*` 三语词条 9 键。

有意的视觉统一：`review` 原为蓝色而语义相同的 `awaiting_review` 为琥珀色，现统一为 attention；`detached` 保留原琥珀色读法（映射到 warning 而非 neutral）。这两项需要四主题视觉验收确认。

**FCA-05 与 FCA-07 分类完成，保留有理由的例外。**

- `ThemePicker.tsx` 的 `role="switch"` 不是重复的开关控件，而是整张可点击卡片（48×28 大号轨道、22px 图标 knob、状态 pill），a11y 语义完整。机械替换为共享 `Switch` 会破坏该 UI，判定为形态例外。其 knob 的 `#ffffff` 需要一个「始终浅色、承载彩色图标」的语义 token；现有四个候选都不匹配（`--control-knob-bg` 在 light/eyecare 下解析为深色，`--aegis-btn-primary-text` 在 dark/midnight 下是深色），按 plan guardrail 留待设计决策，未机械替换。
- `CollaborationDetails.tsx` 的 `EmptySection` 是行内单行提示（`py-2`、11px），与区域级空状态形态不同，判定为例外。
- `EmptyState` 新增 `iconStyle`（`framed` / `bare`）与 `density`（`comfortable` / `compact`）两个变体，使共享原语能容纳次级表面而不强制统一外观；`WelcomePage` 的 `WorkspaceEmptyState` 已迁移为其包装。`ToolCallHistoryPopover` 的 `EmptyOrWaiting` 含 waiting/empty 双语义，迁移留待 Batch F 与加载状态一并处理。

自动化结果：`pnpm lint`、`pnpm build`、前端 1884 项、脚本 224 项、Rust 655 项（3 项既有环境测试 ignored）、collaboration 368 项、plugin package validation、55 个官方 OpenClaw 链接、`cargo fmt -- --check`、`cargo check --lib`、`git diff --check` 全部通过。生产 CSS 产物已确认四个主题的 `--aegis-status-dormant` 均生成。

未执行的验证：四主题（含 light / eyecare）视觉走查，因此上述有意的颜色统一与 dormant 取值仍属未验收边界；目标平台真机验收未执行。

### 2026-07-30 第三阶段实施结果

**FCA-06 闭环。** 生产 TS/TSX 不再渲染 Lucide `Loader2`；通用加载状态统一消费 `LoadingIndicator`，Button 内置 loading 契约保持不变。刷新操作自身的 `RefreshCw` / `RotateCcw` 旋转继续保留，因为它表达的是用户触发动作而不是另一套加载原语。新增 `LoadingIndicator.contract.test.ts`，扫描生产源码阻止 `Loader2` 回流，并验证共享组件独占 `role=status` / `aria-live` / decorative `aria-hidden` 与 reduced-motion 样式契约。顶层 lazy fallback 也收敛为共享 `AppLoadingFallback`，删除两份手写 border spinner。

**FCA-08 闭环。** 明确属于产品 chrome 的启动页、终端通知面板、TopBar 状态灯、设置流程按钮、文件告警、Gateway 错误页、语音波形、日志菜单和终端主按钮均改为 Aegis 语义 token。新增 `productChromeColors.test.ts`：生产 TS/TSX/CSS 的十六进制色值默认禁止，仅允许经逐文件说明的内容色域，包括主题 token 定义、ANSI/xterm、终端搜索、Git diff、主题预览、QR bitmap、文件类型、数据可视化和宠物/SVG 绘图。该白名单是语义边界，不以“清零文本命中”为目标。

**FCA-14 分域拆分持续进行。** 请求/响应 DTO 和序列化 enum 已位于 `src-tauri/src/commands/collaboration_bootstrap/contract.rs`；`target.rs` 已迁移目标分类、身份比对、所有权/持久化门禁和 CLI target 构造；`agent_policy.rs` 已迁移 Agent ID 规范化、`agents.list` 解析、显式白名单和 coordinator policy 求值；`package.rs` 已迁移归档和 bundled metadata 校验。父模块仍公开原有 re-export，八个 command 名称、注册路径、签名外形和 wire casing 均不变。协作启动定向测试继续覆盖这些边界。journal/plugin、recovery 子域仍待迁移，因此 FCA-14 保持“进行中”。实现依据和未验证边界见 [`Collaboration Bootstrap Target 子域拆分`](collaboration-bootstrap-target-slice-2026-08-03.md)、[`Collaboration Bootstrap Agent Policy 子域拆分`](collaboration-bootstrap-agent-policy-slice-2026-08-03.md) 与 [`Collaboration Bootstrap Package 子域拆分`](collaboration-bootstrap-package-slice-2026-08-03.md)。

本阶段当前自动化结果：`pnpm lint`（612 模块）、前端1887项、脚本224项、Rust658项（3项既有环境测试 ignored）、collaboration 368项、plugin package validation、55个官方 OpenClaw 链接、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib` 与 `git diff --check` 通过。四主题视觉走查与目标平台真机验收仍未执行。

## 符合契约的部分

以下实现经核查符合要求，不应在后续修复中回退：

| 领域 | 依据 |
| --- | --- |
| OpenClaw 路径契约 | `src-tauri/src/paths.rs` 完整消费官方环境变量 `OPENCLAW_HOME`、`OPENCLAW_STATE_DIR`、`OPENCLAW_CONFIG_PATH`、`OPENCLAW_GIT_DIR`、`OPENCLAW_PROFILE`，并对不支持的 `OPENCLAW_PROFILE` 显式报错而非猜测降级 |
| Gateway 服务层抽象 | `src/services/gateway/` 拆分出 `GatewayStateMachine`、`ConnectionRetryPolicy`、`SingleFlight`、`LifecycleEpoch`、`SessionRunFence`，职责边界清晰 |
| 配置权威源 | `openclaw-config-authority-audit-2026-07-29.md` 已将 Agent / Tools 枚举改为当前 Runtime schema 驱动，schema 不可用时 fail closed |
| 运行时默认值抽象 | `src/config/runtimeDefaults.ts` 以 JSON + 校验 + 构造函数形式提供 Gateway 默认端点单一事实源，并有测试禁止 `SettingsPage.tsx` 出现端口字面量 |
| 模块边界 | `scripts/check-boundaries.mjs` 的矩阵是单一事实源，`services/` ↛ `stores/`、`components/` ↛ `services/`、`pages/` ↛ `state/` 全部干净 |

---

## P0 · 真实功能缺陷

### [critical] BUG-FCA-01 · 灵动岛绕过 i18n，并无视用户在应用内选择的语言

**位置**：`src/dynamic-island/DynamicIsland.tsx`

**当前行为**：第 85 行以 `navigator.language.toLowerCase().startsWith('zh')` 推导语言，全文件 40 处 `chinese ? '中文' : 'English'` 三元表达式。这是仓库中唯一绕过 i18n 系统的模块，`zh.json` / `en.json` / `zh-TW.json` 中不存在任何 `dynamicIsland.*` 键位。

**影响**：

- 用户在设置中选择 English（持久化于 `aegis-language`，见 `src/i18n/languages.ts`）后，灵动岛仍按操作系统语言渲染中文，应用内语言设置对该模块完全无效；
- 项目声明支持 `['en', 'zh', 'zh-TW']`，繁体中文用户在灵动岛看到简体文案；
- 该模块的文案无法由 locale 文件覆盖，也无法进入既有 i18n 回归测试。

**目标行为**：文案迁入三份 locale 文件，组件通过 `useTranslation()` 读取，语言来源统一为应用内语言状态而非 `navigator.language`。

### [critical] BUG-FCA-02 · `openclaw.json` 在生产 Rust 代码中硬编码 71 处

**位置**：跨 10 个文件

```
23  src-tauri/src/paths.rs
22  src-tauri/src/commands/storage.rs
11  src-tauri/src/commands/collaboration_bootstrap.rs
 4  src-tauri/src/commands/system.rs
 3  src-tauri/src/commands/gateway_service.rs
 2  src-tauri/src/commands/runtime_identity.rs
 2  src-tauri/src/commands/gateway.rs
 2  src-tauri/src/commands/docker.rs
 1  src-tauri/src/commands/state_dir_probe.rs
 1  src-tauri/src/commands/config.rs
```

（统计已排除 `#[cfg(test)]` 内的夹具。）

**当前行为**：`openclaw-config-authority-audit-2026-07-29.md` 的 BUG-OCA-06 将此项标记为「已完成已确认的生产重复」，但实际闭环的只有容器侧常量（`OPENCLAW_CONTAINER_CONFIG_PATH` 等）。Native 侧的配置文件名从未提取为常量，作为路径权威源的 `paths.rs` 自身内部就重复 23 次。

**影响**：审计文档结论与代码事实不符。按 `AGENTS.md` 的记录要求，此处必须以代码事实为准，BUG-OCA-06 的「已完成」结论需要修正，或补完 Native 侧提取。

**目标行为**：在 `paths.rs` 导出 Native 配置文件名常量，其余模块引用；同时修正 BUG-OCA-06 的状态描述。

---

## P1 · 设计系统碎片化（UI 不统一与组件不复用的共同根因）

### [critical] BUG-FCA-03 · 三套并行设计系统，事实上的主力是「没有体系」

| 体系 | 技术栈 | 生产消费者 |
| --- | --- | --- |
| shadcn/ui `src/components/ui/*` | Tailwind + CVA + Radix | 12 个组件中 8 个的唯一消费者是 demo 页 |
| Aegis DS `src/components/shared/{button,badge,alert,copy-button}/` | CSS Modules | button 3、badge 3、alert 4、copy-button 1 |
| 散装内联 | Tailwind 原子类 | 838 个原生 `<button>`，分布 147 个文件 |

逐组件消费者实测：

```
ui/badge      1  仅 UIShowcase        ui/label      1  仅 UIShowcase
ui/button     1  仅 UIShowcase        ui/separator  1  仅 UIShowcase
ui/card       1  仅 UIShowcase        ui/skeleton   1  仅 UIShowcase
ui/input      1  仅 UIShowcase        ui/switch     1  仅 UIShowcase
ui/dialog     2  ui/select 2  ui/dropdown-menu 2  ui/tooltip 4
```

**影响**：`package.json` 为此保留 8 个 `@radix-ui/*` 加 `class-variance-authority`、`tailwind-merge` 作为生产依赖，实际主要服务于一个验证页。同一产品内三种视觉语言并存。

#### 附加证据：两套 token 是手工维护的副本关系

`src/styles/themes/shadcn-tokens.css` 文件头自述：

```
junqi accent HSL (computed from hex):
  #5d7cff → 229 100% 68%   (light)
  #7f9aff → 227 100% 75%   (dark)
  #b07b3e →  32  48% 47%   (eyecare brown)
```

| | Aegis token | shadcn token |
| --- | --- | --- |
| 每主题 token 数 | 79 | 21 |
| 四主题合计 | 316 | 84 |
| 与另一套的关系 | 原始定义 | 由 hex 手工换算的 HSL 副本 |
| 在四个 `aegis-*.css` 中被覆盖的次数 | — | 0 |

即：修改一次品牌色需人工重算 HSL 并同步到第二个文件，否则两套 UI 渲染不同的强调色。该同步无编译期或测试期约束，属于样式层的重复事实源。

#### 结论：保留 Aegis DS 作为唯一视觉体系，保留 4 个 Radix 行为原语

两套体系的价值不在同一层，因此不作纯二选一处理。

**选择 Aegis DS 作为视觉体系的依据**：

1. **单一事实源**。Aegis 组件直接消费 `rgb(var(--aegis-primary))`、`var(--aegis-control-md)`、`var(--aegis-r-md)`、`var(--aegis-duration-fast)`，零转换；保留 shadcn 等于永久保留上述手工同步链路。
2. **表达能力更宽**。Aegis 为 `variant`(5) × `tone`(5) 二维共 25 组合，尺寸走 `var(--aegis-control-*)`；shadcn 为一维 6 variant，尺寸是写死的 `h-9` / `h-10` / `h-11`。现存 838 个原生 button 形态分散，一维模型吸收不了，迁移时会退回 `className` 覆盖，等于未统一。
3. **已内建当前缺失的能力**。`Button` 的 `loading` prop 内置 `LoadingIndicator` 与 `aria-busy`，可直接闭环 BUG-FCA-06 的 109 处手写 `Loader2`；`IconButton` 的类型签名要求 `'aria-label': string` 必填，在类型层面强制无障碍。shadcn 版本两者皆无。
4. **Tauri 桌面特有需求**。`button.module.css` 含 `-webkit-app-region: no-drag`，按钮位于可拖拽标题栏区域时必需，shadcn 版本缺失。
5. **迁移成本打平**。838 个原生 button 迁向任一体系都需重写 props，成本相当；选 Aegis 可顺带解决第 3、4 点。

**保留 Radix 原语的依据**：Radix 提供的是焦点陷阱、ESC、滚动锁、键盘导航、typeahead、悬停意图延迟等行为与无障碍能力，不是样式，自行实现成本高且易错。实测每个 `@radix-ui/*` 包仅被对应的单个 `ui/*.tsx` 引用，故去留可精确到组件。

保留（有行为价值且有生产消费者）：

| 组件 | 生产消费者 |
| --- | --- |
| `ui/dialog.tsx` | CollaborationSetupDialog |
| `ui/select.tsx` | CollaborationSetupDialog |
| `ui/dropdown-menu.tsx` | Chat/ResultCards |
| `ui/tooltip.tsx` | main.tsx、ChatTabs、ResultCards |
| `@radix-ui/react-popover` | FontSelector（直接使用，不经 `ui/` 包装） |

这 4 个 `ui/` 组件应改为消费 `--aegis-*` token，之后即可整体删除 `shadcn-tokens.css`。

删除（纯样式包装，唯一消费者为 demo 页）：

```
ui/button.tsx   ui/card.tsx       ui/input.tsx     ui/label.tsx
ui/badge.tsx    ui/separator.tsx  ui/skeleton.tsx  ui/switch.tsx
```

连带可移出生产依赖：`@radix-ui/react-label`、`@radix-ui/react-separator`、`@radix-ui/react-slot`（仅被 `ui/button.tsx` 使用）、`@radix-ui/react-switch`。

**未决前提**：`components/shared/{button,badge,alert}/` 的文件头注明 "Adapted from Hermes shared-ui"。若 Hermes 是仍在维护并需保持同步的内部设计系统，本结论进一步增强；若 Hermes 已废弃、此处仅为一次性移植，结论不变，但需接受 Aegis 体系后续由本项目自行维护。该前提不影响推荐方向，仅影响长期维护归属。

### [critical] BUG-FCA-04 · 四套状态指示器，语义模型互不兼容且两者同名

| 位置 | Props 模型 | 上色方式 | 消费者 |
| --- | --- | --- | --- |
| `src/components/shared/StatusDot.tsx:34` | `status: active \| idle \| sleeping \| error \| paused` | Tailwind class | AgentHub、SettingsPage |
| `src/components/shared/badge/Badge.tsx:81` | `tone` + `size: sm \| md \| lg` + `live` | CSS Modules | StatusBar、SessionManager、Dashboard |
| `src/components/shared/StatusBadge.tsx:86` | `state: idle \| running \| attention \| failed \| ended` | CSS 变量 | 无外部消费者（死代码） |
| `src/components/shared/StatusIcon.tsx:65` | `status` | — | MessageBubble、AgentRunView、Workshop、SecretsTab |

**当前行为**：前两者同名 `StatusDot`，`src/pages/AgentHub/index.tsx:18` 与 `src/components/Layout/StatusBar.tsx:15` 分别 import 不同实现。四者表达的都是同一语义（运行状态），但状态集合、尺寸单位与颜色来源三者皆不同。

**目标行为**：收敛为单一状态指示器组件，状态集合取并集后由一处定义，颜色统一走主题 token。

### [medium] BUG-FCA-05 · 三套开关实现加一处内联

**位置**：`src/components/ui/switch.tsx`、`src/components/settings/SettingsSwitch.tsx:10`、`src/pages/ConfigManager/components.tsx:510`（`ToggleSwitch`），以及 `src/components/settings/ThemePicker.tsx:300` 手写的第四个 `role="switch"`。

**目标行为**：按 BUG-FCA-03 结论，`ui/switch.tsx` 属删除清单；需在 Aegis DS 下新建单一 `Switch`。`SettingsSwitch.tsx` 已实现正确的 `role="switch"` 语义，可作为新组件的行为基线，因此不必为此保留 `@radix-ui/react-switch` 依赖。

### [medium] BUG-FCA-06 · LoadingIndicator 收敛远未完成

**位置**：48 个文件

**当前行为**：`loading-indicator-convergence-2026-07-29.md` 约定「新加载状态应复用 `LoadingIndicator` 或已有 `Button loading`，不得新增手写 border spinner」。实测：

- `LoadingIndicator` 消费者：10 个文件；
- `Loader2` 配合 `animate-spin` 手写：109 处，48 个文件（`ChannelsCenter/index.tsx` 11、`SkillsPage/index.tsx` 8、`AgentHub/index.tsx` 7、`AgentHub/AgentSettingsPanel.tsx` 6 等）；
- 手写 border spinner：0 处。

**影响**：手写 border spinner 一路已收敛，Lucide `Loader2` 一路未收敛。该文档承诺的 `prefers-reduced-motion: reduce` 降级与 `role=status` live region 语义，在这 109 处全部缺失。

**注**：文档明确保留刷新操作旋转 `RefreshCw` 图标的语义，该部分不在收敛范围内，上述统计已排除。

### [medium] BUG-FCA-07 · 缺少共享空状态组件

**位置**：17 个文件各自手写空状态。`find src -iname '*empty*'` 无结果。

### [medium] BUG-FCA-08 · 95 处硬编码色值绕过四主题 token

**位置**：26 个 tsx 文件

```
11  src/components/settings/ThemePicker.tsx          （合理：渲染主题色板本身）
11  src/components/Layout/TerminalNotificationPanel.tsx
 7  src/pet/skins/index.tsx
 6  src/components/setup/SetupFlowPanels.tsx
 5  src/pages/SetupPage/shared.tsx
 5  src/components/shared/StatusDot.tsx
 4  src/components/Git/DiffFileBlock.tsx
 4  src/components/Chat/VoiceRecorder.tsx
```

**当前行为**：项目提供 `aegis-dark`、`aegis-midnight`、`aegis-light`、`aegis-eyecare` 四主题及 `src/styles/themes/` 下的 token 定义，但上述位置直接写死十六进制色值。

**影响**：这些位置在 light 与 eyecare 主题下不跟随主题。`TerminalNotificationPanel.tsx` 将深色面板底色 `#22252c` 与前景 `#efeff1` 全部写死，在浅色主题下构成对比度问题。`DiffFileBlock.tsx:281` 与 `:339` 在同一 style 对象内混用写死色值与 `var(--aegis-text-dim)`，最能说明当前缺少约束。

**目标行为**：除主题预览组件外，全部改为主题 token；补 light / eyecare 真机视觉走查。

---

## P2 · demo 代码与硬编码

### [critical] BUG-FCA-09 · 验证用 demo 页随生产构建发布且无 feature 门禁

**位置**：`src/pages/UIShowcase.tsx`、`src/AppRouteTree.tsx:73`

**当前行为**：该文件自身注释（第 6 行）声明「no nav entry, no FeatureRoute gate — it's a verification page」。`/ui-showcase` 是 `AppRouteTree.tsx` 中唯一不带 `FeatureRoute` 门禁的业务路由，`scripts/vite-chunk-strategy.mjs` 未将其排除，最终用户可通过 URL 直接访问。

**影响**：验证性代码进入生产制品。它同时是 8 个 shadcn 组件的唯一消费者，移除后那些组件与相关 Radix 依赖立即成为死代码——这一依赖关系应作为 BUG-FCA-03 决策的输入。

### [medium] BUG-FCA-10 · `runtimeDefaults` 单一事实源被两处绕过

**位置**：

- `src/stores/settingsStore.ts:289` — `get().gatewayUrl || 'ws://127.0.0.1:18789'`
- `src/services/gateway/credentialProvider.ts:20` — `const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:18789'`

**当前行为**：`src/config/runtimeDefaults.ts` 已提供 `defaultGatewayWsUrl()`，仓库内 16 处正确消费，`runtimeDefaults.test.ts` 甚至断言 `SettingsPage.tsx` 不得出现 `127.0.0.1:18789` 字面量，但上述两处漏网。

**影响**：`credentialProvider.ts` 的常量参与 Gateway 凭据 runtime key 推导。默认端口若与 `runtime-defaults.json` 漂移，凭据将写入错误的 key。

### [medium] BUG-FCA-11 · Memory API 地址双份硬编码

**位置**：`src/stores/settingsStore.ts:191`、`src/pages/MemoryExplorer.tsx:694`，均为 `'http://localhost:3040'`。端口 3040 未纳入 `src/config/runtime-defaults.json`。

### [medium] BUG-FCA-12 · 媒体模型 catalog 为空，导致选择器空转

**位置**：`src/generated/mediaCatalog.generated.ts`、`src/pages/ConfigManager/ProvidersTab.tsx:3364-3377`

**当前行为**：

```ts
export const GENERATED_IMAGE_GENERATION_MODELS: GeneratedMediaCatalogModel[] = [] as const;
export const GENERATED_VIDEO_GENERATION_MODELS: GeneratedMediaCatalogModel[] = [] as const;
```

`ProvidersTab.tsx` 以 `Array.from(new Set([...catalog, ...(已配置值 ? [已配置值] : [])]))` 构建选项。catalog 为空时，选项集合退化为「仅当前已配置值」，用户无法从下拉中选到任何新模型。

**待验证**：需确认 `pnpm generate:provider-catalog`（`scripts/generate-provider-catalog.js:450`）是否覆盖 media 分支且本机执行时有数据源，还是该功能本就未落地。在确认前不应推断修复方式。

### [low] BUG-FCA-13 · README 版本号落后

**位置**：`README.md:7` 写 `1.4.14`。

`package.json`、`src-tauri/Cargo.toml:3`、`src-tauri/tauri.conf.json:5` 三处一致为 `1.4.18`，符合 `AGENTS.md` 的三处一致要求，仅 README 漏更。

---

## P3 · 封装与抽象

### [medium] BUG-FCA-14 · `collaboration_bootstrap.rs` 是 7000 行单体

**位置**：`src-tauri/src/commands/collaboration_bootstrap.rs`

```
生产代码        7000 行（另有 1787 行测试）
函数            206 个
struct / enum   28 个
impl 块          2 个
#[tauri::command] 8 个
```

对比：第二大文件 `src-tauri/src/commands/system.rs` 生产代码 2303 行。

**当前行为**：206 个函数仅配 2 个 `impl` 块，绝大多数逻辑是自由函数在裸数据结构上操作，而非类型的方法。8 个对外 command 对应 7000 行实现，说明内部存在多个未拆出的子域——从仅有的两个 impl（`DescriptorProbeFailure`、`DescriptorDirectory`，位于第 1967 与 2099 行）可辨认出 descriptor 探测与目录管理两条边界。

**目标行为**：按子域拆分为独立模块，行为归拢到类型的 impl。此项改动面大，建议单独立 spec 与 plan。

---

## 建议修复顺序

设计体系方向已按 BUG-FCA-03 的结论确定，后续批次据此展开。

| 批次 | 内容 | 前置条件 | 风险 |
| --- | --- | --- | --- |
| 1 | BUG-FCA-01 灵动岛 i18n | — | 低，纯前端，可回归测试 |
| 2 | BUG-FCA-09 删除 `UIShowcase.tsx` 与 `/ui-showcase` 路由，连带删除随之成为死代码的 8 个纯样式 shadcn 组件及 4 个 Radix 依赖 | — | 低，删除项均已确认无其他消费者 |
| 3 | 保留的 4 个 `ui/` 组件改为消费 `--aegis-*` token，删除 `src/styles/themes/shadcn-tokens.css` | 批次 2 | 中，闭环双份 token 事实源 |
| 4 | Aegis DS 补齐缺失原语：`Switch`、`Input`、`EmptyState`、统一后的状态指示器（BUG-FCA-04 / 05 / 07） | 批次 3 | 中 |
| 5 | BUG-FCA-06 迁移 109 处 `Loader2` 至 `Button loading` 或 `LoadingIndicator`；按页面分批迁移 838 个原生 button，优先 `Loader2` 密集的 48 个文件 | 批次 4 | 中，触及文件多但改动机械 |
| 6 | BUG-FCA-08 色值 token 化 | 批次 3 | 中，需四主题真机走查 |
| 7 | BUG-FCA-02 / 10 / 11 硬编码提取 | — | 低，Rust 侧需 `cargo test --lib` |
| 8 | BUG-FCA-12 媒体 catalog | 需先验证生成链路 | 未知 |
| 9 | BUG-FCA-14 Rust 单体拆分 | — | 高，建议单独立 spec + plan |
| — | BUG-FCA-13 README 版本 | — | 无 |

批次 7 与 8 不依赖设计体系决策，可与前序批次并行。

## 验证边界

本次审查已执行：

- `node scripts/check-boundaries.mjs`：通过（609 个模块）。
- `npx tsc --noEmit`：通过。
- 基于 `grep` / `wc` 的静态取证，统计口径均已在各条目中说明，且已排除 `#[cfg(test)]` 与 `*.test.*`。

本次审查**未**执行：

- `pnpm test`、`pnpm test:rust`、`pnpm build`——本次为只读审查，未修改源码，不构成回归风险；
- Tauri 桌面真机走查，因此 BUG-FCA-08 的四主题对比度影响为静态推断，未经视觉验收；
- OpenClaw 官方文档的联网核对。BUG-FCA-02 的判断依据是仓库内既有审计文档 `openclaw-config-authority-audit-2026-07-29.md` 与代码事实的比对，未重新核对上游 schema；
- BUG-FCA-12 的生成链路验证，该条目状态为待验证。
