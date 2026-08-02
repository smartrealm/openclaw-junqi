# JunQi Desktop Agent Guide

本文件是 Codex 及其他兼容 `AGENTS.md` 的编码代理在本仓库中的根级规范。规则适用于整个仓库；若子目录以后增加更具体的 `AGENTS.md`，以更接近目标文件的规则为补充或覆盖。

## 项目定位

JunQi Desktop 是基于 Tauri 2、Rust、React 18、TypeScript、Vite 6 和 OpenClaw Gateway 的跨平台桌面 AI 工作台。

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

## 文档先行

- 修改代码、配置、构建或部署流程前，先查阅相关 README、ADR、spec、plan、审计记录、验证记录、测试和当前实现。不得根据界面现象、模型记忆或路径名称直接推断行为。
- 涉及 OpenClaw、Tauri、Docker、操作系统或渠道插件时，进一步查阅对应版本的官方文档、官方仓库源码或协议定义。非官方文章只能作为检索线索，不能作为实现契约。
- 外部依赖行为必须按项目实际安装版本核对；上游 `main` 只能用于评估未来兼容性，不能替代当前版本契约。
- 文档、源码和运行结果冲突时，以可复现的源码和运行证据为准，并在相关 Markdown 中记录差异和结论，不能静默选择一种解释。
- 无法取得权威依据或复现证据时，标记为“待验证”并停止推断性修改。不得虚构返回字段、状态转换、兼容逻辑或成功条件。
- 每次行为变更都要在对应 Markdown 中记录依据、当前行为、目标行为、验证结果和未验证边界。较大或跨模块改动使用 `docs/` + `specs/` + `plans/` 三层记录。
- 安装或首次启动流程变化时，同时检查并更新 `docs/previews/junqi-first-run-flow.html`。线上流程图当前不是自动部署产物，不得声称已同步，除非已验证线上响应。

## 工程边界

- 遵守 `scripts/check-boundaries.mjs`：`services/` 不依赖 `stores/` 或 `theme/`；`components/` 不直接依赖 `services/`；`pages/` 不跨过服务与 IPC 边界访问后端状态。
- Tauri IPC 必须跨文件核对：前端 command 名、参数外层、参数大小写和返回类型要与 `src-tauri/src/lib.rs` 注册项及对应 `#[tauri::command]` 完全一致。
- Rust `serde(rename_all = ...)` 是前端字段命名的契约。禁止用 `any`、强制断言或静默默认值掩盖 IPC 契约漂移。
- Native 与 Docker 是用户明确选择并持久化的运行方式。失败时不得静默切换到另一运行时；恢复、探测、凭据和配置路径都必须绑定当前选定 runtime。
- Gateway 健康不等于身份、配置和授权正确。完成条件必须保留 selected config、runtime identity、credential scope、official-service handoff 和真实模型探测门禁。
- OpenClaw Wizard、渠道设置和二维码流程由官方 Runtime/插件拥有。JunQi 负责忠实呈现结构化步骤、终端输出和状态轮询，不得屏蔽、改写或猜测第三方插件结果。
- Secret、Gateway token、Provider key 和设备凭据只存在于最小必要边界。不得写入日志、Markdown、测试快照、前端持久存储或提交记录；系统凭据库不可用时必须保留明确的 session-only/unsupported 语义。
- 保持 dirty worktree 中非本任务改动。不得回滚、覆盖或格式化与任务无关的用户修改。
- 修复保持最小范围。除非现有重复或边界确实要求，不增加抽象、依赖或顺手重构。

## 实现完整性与运行环境约束

- 禁止以硬编码的展示文案、业务状态、命令、版本、文件路径、平台名称或测试数据代替真实契约、运行时输入或配置。常量仅可表达稳定协议值、受类型约束的枚举或经文档证明的不变量；其来源和适用边界必须清楚。
- 不得写死客户端、Gateway、工作区、安装器、资源或配置路径。路径必须由已验证的运行时身份、用户明确选择、受控应用资源解析或平台 API 提供，并在使用点保留所属 runtime/target 的绑定。
- 不得把当前开发机、当前 Desktop 所在操作系统、当前登录用户、当前网络、当前 Gateway 或本机已有配置当作任意目标环境的默认条件。目标平台、所有权、能力和管理方式未知时必须明确显示为未知或待确认，不能猜测或生成平台专属操作。
- 禁止 demo、placeholder、伪实现、伪成功、伪数据、猜测性 fallback 或仅为通过测试而存在的业务代码。无法由权威契约或可复现证据支撑的行为必须标记为待验证并停止推断性实现。
- 修改、优化或新增代码前，必须全局审视相关业务链路：领域模型、调用方、状态管理、IPC/协议、持久化、权限边界、国际化、测试、文档和目标平台行为。不得断章取义地只修局部 UI 或单一文件。
- 报告、代码和文档必须基于已查阅源码、测试、运行结果和权威资料。禁止臆测、虚构、夸大验证结果或把未验证推论描述为事实。
- 涉及 OpenClaw 的功能、命令、字段、事件、插件、配置、生命周期或兼容性前，必须先核对项目实际安装版本对应的官方文档、官方源码或正式协议。无法取得官方依据时，不得伪造命令、字段、状态、兼容逻辑或用户操作说明。

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
