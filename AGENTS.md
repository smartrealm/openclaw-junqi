# JunQi Desktop Agent Guide

本文件是 Codex 及其他兼容 `AGENTS.md` 的编码代理在本仓库中的根级规范。规则适用于整个仓库；若子目录以后增加更具体的 `AGENTS.md`，以更接近目标文件的规则为补充或覆盖。

## 项目定位

JunQi Desktop 是基于 Tauri 2、Rust、React 18、TypeScript、Vite 6 和 OpenClaw Gateway 的跨平台桌面 AI 工作台。

### OpenClaw 客户端边界

- JunQi 只是 OpenClaw 的桌面客户端，不拥有独立于 OpenClaw 的 agent、任务、会话、工具、渠道、
  语音或运行时语义。OpenClaw 原生未定义或未支持的能力，JunQi 不得自行捏造、模拟成功、以本地
  fallback 替代，或在 UI 中暗示其可用。
- 所有加强、扩展、UI 设计和交互都必须以最新版 OpenClaw 官方文档、官方源码或正式协议中已存在的
  能力为依据。当前安装版本只能作为本地复现、构建和兼容性证据，不能把客户端永久绑定到该版本，
  也不能替代对最新版官方能力的核对。
- 官方依据不能证明时，界面和代码必须保留“不可用”或“待验证”的真实语义，并停止推断性实现；不得
  为填补产品体验而创造新的 RPC、状态机、持久化模型或跨平台行为。

- `src/`：React 前端、状态、服务和 Tauri IPC 适配。
- `src-tauri/`：Rust 后端、系统集成、安装器和 Tauri command。
- `packages/junqi-collab/`：OpenClaw 多智能体协作插件。
- `scripts/`：构建、边界、文档和发布验证脚本。
- `docs/`：设计、审计、验证记录与 HTML 预览。
- `specs/`：当前行为、目标行为和验收条件。
- `plans/`：实施顺序、文件范围和验证步骤。

开始工作前先读 `README.md` 和 `docs/README.md`。涉及持久化协作领域时还要读 `CONTEXT.md`，其中术语是规范定义。

## Emoji 禁止规则

- 严禁在回复、代码、注释、文档、配置、测试快照、提交信息和其他任何写入内容中使用 Emoji。
- 在写入任何文件前，必须扫描本次准备写入的全部内容是否包含 Emoji。发现 Emoji 时，必须先删除或替换为纯文本，确认不存在 Emoji 后才能写入。
- 在输出最终结果前，必须扫描准备输出的全部内容是否包含 Emoji。发现 Emoji 时，必须先删除或替换为纯文本，确认不存在 Emoji 后才能输出。
- 修改既有文件时，还要扫描修改后的完整文件；不得只检查新增行。
- Emoji 检测至少覆盖 Unicode 扩展象形字符和常见符号码段，不能只搜索少量示例字符。

## 代码注释语言

- 新增或修改的代码注释必须使用中文，说明设计约束、协议依据或非直观逻辑；不得新增英文代码注释。
- 既有英文注释仅在本次修改直接涉及其语义时一并改为中文；不得为语言统一进行与任务无关的批量改写。

## 文档先行

- 修改代码、配置、构建或部署流程前，先查阅相关 README、ADR、spec、plan、审计记录、验证记录、测试和当前实现。不得根据界面现象、模型记忆或路径名称直接推断行为。
- 涉及 OpenClaw 时，先查阅最新版官方文档、官方仓库源码或正式协议；当前安装包只用于复现和记录兼容差异，不得据此把能力固定为版本门禁。涉及 Tauri、Docker、操作系统或渠道插件时，查阅其与项目实际依赖相符的官方文档、官方仓库源码或协议定义。非官方文章只能作为检索线索，不能作为实现契约。
- 外部依赖行为必须以对应官方文档、官方源码、协议 schema 和 handler 为契约；项目实际安装版本只用于复现当前运行环境、记录验证范围和发现兼容差异，不得把版本号当作能力开关。上游主线变化必须重新核对后再调整客户端。
- 文档、源码和运行结果冲突时，以可复现的源码和运行证据为准，并在相关 Markdown 中记录差异和结论，不能静默选择一种解释。
- 无法取得权威依据或复现证据时，标记为“待验证”并停止推断性修改。不得虚构返回字段、状态转换、兼容逻辑或成功条件。
- 每次行为变更都要在对应 Markdown 中记录依据、当前行为、目标行为、验证结果和未验证边界。较大或跨模块改动使用 `docs/` + `specs/` + `plans/` 三层记录。
- 安装或首次启动流程变化时，同时检查并更新 `docs/previews/junqi-first-run-flow.html`。线上流程图当前不是自动部署产物，不得声称已同步，除非已验证线上响应。

## 工程边界

- 代码注释必须使用中文。新增注释一律使用中文；修改现有注释的语义时必须同步改为中文。不得为翻译注释进行与当前任务无关的批量重构。
- 遵守 `scripts/check-boundaries.mjs`：`services/` 不依赖 `stores/` 或 `theme/`；`components/` 不直接依赖 `services/`；`pages/` 不跨过服务与 IPC 边界访问后端状态。
- Tauri IPC 必须跨文件核对：前端 command 名、参数外层、参数大小写和返回类型要与 `src-tauri/src/lib.rs` 注册项及对应 `#[tauri::command]` 完全一致。
- Rust `serde(rename_all = ...)` 是前端字段命名的契约。禁止用 `any`、强制断言或静默默认值掩盖 IPC 契约漂移。
- Native 与 Docker 是用户明确选择并持久化的运行方式。失败时不得静默切换到另一运行时；恢复、探测、凭据和配置路径都必须绑定当前选定 runtime。
- Gateway 健康不等于身份、配置和授权正确。完成条件必须保留 selected config、runtime identity、credential scope、official-service handoff 和真实模型探测门禁。
- OpenClaw Wizard、渠道设置和二维码流程由官方 Runtime/插件拥有。JunQi 负责忠实呈现结构化步骤、终端输出和状态轮询，不得屏蔽、改写或猜测第三方插件结果。
- 合并本地或远端分支前，必须以共同祖先逐项审查进入改动的 OpenClaw 契约、调用图和目标平台假设。第三方 CLI、独立应用、固定平台门禁或演示 UI 不得因分支已有实现而自动成为 JunQi 功能；缺少 OpenClaw 官方依据时必须删除或标记为待验证，不能保留为可用入口。
- Secret、Gateway token、Provider key 和设备凭据只存在于最小必要边界。不得写入日志、Markdown、测试快照、前端持久存储或提交记录；系统凭据库不可用时必须保留明确的 session-only/unsupported 语义。
- 保持 dirty worktree 中非本任务改动。不得回滚、覆盖或格式化与任务无关的用户修改。
- 修复保持最小范围。除非现有重复或边界确实要求，不增加抽象、依赖或顺手重构。

## 遗弃、旧代码与无引用代码

- 从任务开始到提交前持续审查遗弃实现、历史兼容分支、无引用代码和仅为旧架构保留的包装层；本规则适用于当前任务的全部代码、测试、配置、文档和生成物来源。
- 删除前必须以全局引用图证明目标没有运行时入口或有效消费者，并核对静态导入、动态导入、Tauri command 注册、事件名、字符串反射、插件清单、构建脚本、测试、配置、国际化和文档链接。不得仅凭文件名、注释、表面搜索结果或主观判断删除。
- 已证明无引用的实现必须与其专属测试、导出、配置、文档和生成物来源一并删除；不得保留无消费者的兼容层、空包装、伪 fallback 或死代码来维持表面兼容。
- 历史迁移代码仅可在存在当前运行时入口、明确迁移对象和可验证完成条件时保留；缺少这些证据时视为遗弃代码并删除。保留时必须在相关文档记录依据、适用边界和移除条件。
- 每次新增、替换或收紧实现时，都必须审查被其取代的代码是否仍有真实消费者；证据充分时在同一变更中删除，证据不足时记录为待验证，不得臆断删除或继续扩散旧接口。

## UI 主题与交互一致性

- 新增或修改任何 UI 前，必须先审阅目标页面、相邻页面、共享组件、全局样式和当前主题变量，确认现有视觉语言后再实现。不得以个人偏好、通用模板或截图中的孤立现象重写产品风格。
- 页面和组件必须使用现有语义化主题 token，例如 `aegis-bg`、`aegis-surface`、`aegis-card`、`aegis-border`、`aegis-text`、`aegis-primary` 及其状态色。禁止在业务组件中写死仅适用于亮色或暗色主题的颜色，也不得新增绕过主题系统的平行配色。
- 优先复用 `src/components/ui/`、`src/components/shared/` 和已有业务组件中的输入框、选择器、对话框、按钮、状态、加载与空状态交互。只有现有组件无法表达已确认的产品契约时才新增组件；新增后应沉淀为可复用实现，不得在同一流程复制多套交互。
- 同一页面及同一业务流程中的字体层级、控件高度、圆角、边框、间距、图标尺寸、悬停、按下、禁用、加载、成功和失败反馈必须与周边界面一致。不得引入与当前桌面工作台密度不一致的营销页式大留白、夸张阴影、渐变、动效或卡片堆叠。
- 所有交互必须提供完整状态：默认、hover、active、focus-visible、disabled、loading、empty 和 error；异步操作不得伪成功、静默失败或让控件显示与服务端状态不一致。错误优先在操作附近内联呈现，不使用 `window.alert()`。
- 所有交互必须支持键盘操作和可访问名称。对话框需要正确的 dialog 语义、焦点管理、Escape 关闭和遮罩行为；表单控件需要关联 label 或 `aria-label`；不能只靠颜色传达状态。
- 布局必须适应桌面窗口缩放和窄窗口，不以当前开发机尺寸为固定画布。优先使用现有响应式断点、弹性宽度和可滚动边界；不得让主要操作、错误反馈或提交按钮在窄窗口中不可达。
- 动效只用于解释状态变化，并遵循现有时长和 easing；优先使用 `transform` 与 `opacity`，同时尊重系统减少动态效果偏好。不得为了视觉效果延迟真实状态反馈。
- UI 行为变更的验收至少覆盖当前亮色和暗色主题、键盘焦点、窄窗口、加载、失败及空数据边界。自动化只能证明契约和结构时，必须把未完成的真实视觉验收明确记录为未验证。
- 涉及 UI 的最终说明必须列出复用的主题 token 或共享组件、实际执行的交互验证，以及尚未完成的主题或真机视觉验证。

## 实现完整性与运行环境约束

- 禁止以硬编码的展示文案、业务状态、命令、版本、文件路径、平台名称或测试数据代替真实契约、运行时输入或配置。常量仅可表达稳定协议值、受类型约束的枚举或经文档证明的不变量；其来源和适用边界必须清楚。
- 不得写死客户端、Gateway、工作区、安装器、资源或配置路径。路径必须由已验证的运行时身份、用户明确选择、受控应用资源解析或平台 API 提供，并在使用点保留所属 runtime/target 的绑定。
- 不得把当前开发机、当前 Desktop 所在操作系统、当前登录用户、当前网络、当前 Gateway 或本机已有配置当作任意目标环境的默认条件。目标平台、所有权、能力和管理方式未知时必须明确显示为未知或待确认，不能猜测或生成平台专属操作。
- 禁止 demo、placeholder、伪实现、伪成功、伪数据、猜测性 fallback 或仅为通过测试而存在的业务代码。无法由权威契约或可复现证据支撑的行为必须标记为待验证并停止推断性实现。
- 修改、优化或新增代码前，必须全局审视相关业务链路：领域模型、调用方、状态管理、IPC/协议、持久化、权限边界、国际化、测试、文档和目标平台行为。不得断章取义地只修局部 UI 或单一文件。
- 报告、代码和文档必须基于已查阅源码、测试、运行结果和权威资料。禁止臆测、虚构、夸大验证结果或把未验证推论描述为事实。
- 涉及 OpenClaw 的功能、命令、字段、事件、插件、配置、生命周期或兼容性前，必须先核对 OpenClaw 官方文档、官方源码或正式协议，并用项目实际安装版本复现实验和记录验证范围。无法取得官方依据时，不得伪造命令、字段、状态、兼容逻辑或用户操作说明。

### OpenClaw 对齐与 JunQi 增强边界

- JunQi 的产品定位是 OpenClaw 客户端和桌面二次开发层，不是另一套 Agent、Tool Calling、Task、Transcript 或 Runtime 实现。所有功能增强、跨平台适配、语音交互、任务图和 UI 设计都必须依托 OpenClaw 官方已支持的能力、协议和扩展点展开。
- OpenClaw 是 Chat、Agent、Tool Calling、Transcript、Task Ledger、会话生命周期和运行时协议的权威来源。只有当最新版 OpenClaw 已通过正式协议、官方扩展点或官方插件定义相应能力时，JunQi 才能在桌面侧增加对应的跨平台 UI、交互、可观测性或人工核验；这些实现不得重新定义、替代或补足上游语义。
- OpenClaw 原生不支持的功能不得在 JunQi 中伪造、包装成已支持或以乐观 UI 掩盖缺失。若需求超出官方能力，必须标记为不支持或待验证，只有在存在官方插件、协议扩展或明确的客户端层契约时才可实现。
- 禁止硬编码来模拟 OpenClaw 能力：不得把工具名称、工具副作用、参数结构、状态、命令、版本、会话身份、任务结果或平台能力写成未经上游契约证明的业务常量。展示文案也不能用来掩盖未知、未授权、未连接或未核验状态。
- 每个新增 OpenClaw 集成必须先依据 OpenClaw 官方文档、官方源码、协议 schema、Gateway handler 或可复现 RPC/capability 结果确认“是否支持以及如何支持”。`package.json`、lockfile 和实际安装版本只用于确认当前运行环境、复现实验和记录验证范围，不得把版本号写成能力开关、字段契约或实现分支。上游未来版本、其他项目的实现和模型常识只能作为检索线索，不能作为当前实现契约。
- OpenClaw 配置控制面必须先按当前官方 `config.get` envelope 验证 `exists`、`valid`、`config` 和
  `hash`；配置文件存在时，写入必须将该 `hash` 原样作为 `baseHash`。不得把裸配置、`baseHash`
  响应字段、`resolved`、`sourceConfig` 或其他未证明别名当作兼容 fallback。涉及按 id 的配置数组时，
  优先提交最小条目 patch；只有明确且经协议允许的整段替换或删除才使用 `replacePaths`。
- 上游没有提供的字段、状态转换、能力声明、工具结果或恢复结论必须保留为未知或待核验。JunQi 不得从 UI 事件、超时、空结果、文本内容或本地乐观状态推断 Gateway 已成功、工具已执行、工具未执行或副作用已回滚。
- JunQi 的本地增强必须是可追溯的派生状态，并保留对应的 OpenClaw 引用、runtime identity、session identity、revision 和证据来源。任何本地 checkpoint、缓存、任务图或 UI 投影都不能向 OpenClaw transcript 伪造消息、Tool Result、审批结果或完成状态。
- 当 OpenClaw 协议不支持某项需求时，优先通过官方扩展点、插件协议或明确的 JunQi 本地层实现，并在 `docs/`、`specs/` 或 `plans/` 中记录“上游契约、JunQi 增强、验证证据和未验证边界”。无法证明兼容性时停止推断性修改，不添加猜测性 fallback。

### 运行中断、任务投影与工具副作用

- 一个 OpenClaw Task 对应一个稳定的 `sessionId`。Stop 只中断当前一次 run 或输出，绝不把 Stop 实现为清空会话、删除 transcript 或丢弃该 Task 的上下文；恢复必须以同一 `sessionId` 和 Gateway 可核验的会话历史为准。
- 对支持取消的官方操作，网络层使用对应的取消/中止请求；在发起远端中止前，JunQi 的本地派生 checkpoint 必须已持久化并绑定 runtime identity、session identity、run identity 与 revision。连接恢复、应用冷启动或模型切换后，只能通过 OpenClaw 的历史、运行状态和事件重新核验，不能把本地快照当作 Gateway 成功事实。
- 若中断发生在 Tool Call 已产生但结果尚未回传，JunQi 不得向 OpenClaw transcript 伪造 Tool Result、System 消息或完成状态。只能将本地投影标记为待核验，并在官方 transcript、审计或任务账本给出终态后收敛；无法核验时保留未知状态。
- 任务图、步骤图和并发视图只能是 OpenClaw Task Ledger、会话事件、运行事件和审计记录的派生投影。图可随官方事件变化，并可持久化其 UI 视图和核验 checkpoint；不得自行定义任务依赖、调度、重试、完成条件或跨模型迁移语义。
- 对有副作用的官方写操作，调用方必须遵守协议要求的幂等键、权限和结果核验。客户端不得因超时、断线或重启自动重放未知结果的写操作；必须显示待核验，并由用户或官方恢复流程决定后续操作。

### 桌面与协议适配

- JunQi 的运行目标是 Tauri 桌面应用。核心能力必须通过 Tauri、Rust、系统 API 或 OpenClaw Gateway 的桌面可用契约实现；浏览器/WebView API 只能作为非权威展示层或经验证的降级信息来源，不能成为语音唤醒、窗口控制、凭据、路径、进程、设备身份或后台常驻能力的唯一实现。
- 任何平台能力都必须至少按 macOS、Windows 和 Linux 的发行版差异审查。不得将当前机器、浏览器 user agent、单一窗口管理器、单一音频设备或单一安装方式推断为其他平台可用；未知平台能力必须明确为未知或不可用。
- Gateway `hello-ok.features.methods` 是保守发现信息，不是完整可调用方法清单。不得仅因该列表未列出某方法而隐藏、拒绝或伪报不支持；应在已完成身份与权限校验后按官方请求契约调用，并仅根据该次结构化 Gateway 响应判定实际不支持、未授权、失败或待重试。

## 常用命令

环境版本由 `.tool-versions`、`package.json#packageManager` 和 `rust-toolchain.toml` 锁定。

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

按改动范围选择验证：

```bash
pnpm lint                  # TypeScript + 模块边界
pnpm test                  # 前端与脚本完整测试
pnpm test:rust             # Rust library tests
pnpm build                 # collaboration bundle + tsc + Vite production build
pnpm verify:openclaw-docs  # OpenClaw 官方命令链接
pnpm collab:test           # collaboration package
pnpm collab:validate       # collaboration plugin package contract
git diff --check
```

Rust 源码改动至少补充：

```bash
cd src-tauri
cargo fmt -- --check
cargo check --lib
cargo test --lib
```

不要把 `pnpm tauri build` 当成普通快速检查。打包依赖平台工具、签名和 updater 私钥；缺少发布私钥时不得伪造签名或把 ad-hoc 包描述为正式发布包。

## 测试与验证

- Bug 修复必须有能在修复前失败的回归测试。优先测试行为和跨边界契约，不只做源码字符串匹配。
- 守护测试断言契约，不断言实现的书写形式。禁止断言具体表达式文本、变量名或函数定义在文件中的偏移；确需跨语言守护时，断言可执行的语义（导出的谓词、注册表、协议字段），并按语法边界而非相邻定义名截取代码范围。判据一旦被抽取或重命名即失效的断言，说明它守的是写法而不是行为。
- 先运行最小相关测试，再根据影响范围运行完整 TypeScript、Rust、脚本和构建验证。
- 修改 Tauri command 时同时验证 command 注册、Rust 签名、前端 wrapper、调用方和序列化字段。
- 修改 generated collaboration bundle 的来源后运行 `pnpm collab:bundle`，并确认生成的前端 metadata 与 `src-tauri/resources/collaboration` 一致。
- 自动化通过不等于真机验收。Windows NSIS/UAC/Scheduled Task/Credential Manager、Docker Desktop 冷启动、macOS Keychain/签名/公证等必须明确记录是否真实验证。
- 不得把本机既有配置、凭据或运行状态当成其他用户环境的默认条件。

## Git 与发布

- 未经明确要求不要提交、推送、创建 tag、发布 Release 或修改远端系统。
- 提交信息的标题和正文必须使用中文，并遵守全局 Emoji 禁止规则。
- 版本发布必须保持 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 三处版本一致。
- 不修改或泄露签名私钥、token、证书和 CI secret。发布结论以 `.github/workflows/` 的不可变源码与制品校验为准。
- 报告结果时区分：代码完成、自动化通过、本机实测、目标平台实测、正式签名/公证、线上部署。不得合并成模糊的“已完成”。

## 完成标准

任务只有在以下条件满足后才可声明完成：

- 实现与已查阅的本地和官方契约一致；
- 相关 Markdown 已同步，假设和未验证边界已标明；
- 相关回归测试和静态检查通过；
- 跨 TypeScript/Rust/插件/运行时边界的字段与状态已核对；
- `git diff --check` 通过，且没有覆盖用户既有改动；
- 最终说明列出实际执行的验证以及没有执行的验证。

## 规范依据

- Codex `AGENTS.md`：https://learn.chatgpt.com/docs/agent-configuration/agents-md
- Claude Code 项目记忆：https://code.claude.com/docs/en/memory
