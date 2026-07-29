# 无引用与废弃代码清理验证（2026-07-29）

## 依据

项目根级 `AGENTS.md` 要求行为或工程变更记录依据、当前行为、目标行为、验证结果和未验证边界。本轮以 TypeScript `noUnusedLocals` / `noUnusedParameters` 诊断、全仓引用检索和实际构建入口为依据，逐项处理高置信度死代码，不批量删除兼容迁移逻辑。

## 当前行为

清理前 `tsconfig.json` 未启用未使用声明门禁，因此普通 `pnpm lint` 不报告所有无引用局部声明。审查时临时启用门禁发现 188 条候选；完成核对和清理后已正式启用这两项门禁。

## 目标行为

- 每次只处理一个已核实的候选；
- 先增加能在清理前失败的回归断言，再删除实现；
- 不删除仍承担历史升级、跨平台或协议兼容职责的代码；
- 每项完成后运行最小相关测试、lint 和差异检查。

## 已处理项目

### 1. AudioPlayer 无入口 replay 实现

- 文件：`src/components/Chat/AudioPlayer.tsx`
- 依据：`replay` 回调及其 `RotateCcw` 图标没有 JSX、事件或其他代码引用；播放器现有重播能力可通过进度条定位和原生播放状态实现，界面中不存在 replay 控件。
- 变更：删除未调用的 `replay` 回调和仅由它引入的 `RotateCcw` import。
- 回归测试：`src/services/voice/voiceAuditRegression.test.ts` 明确禁止重新引入无入口 replay 实现。

### 2. ChatView 未挂载的 Virtuoso Header

- 文件：`src/components/Chat/ChatView.tsx`
- 依据：`Header` 回调未被 JSX 调用，且 `Virtuoso` 的 `components` 只传入了 `Footer`；因此加载提示和“对话起始”分隔线从未渲染。
- 变更：删除未挂载的 `Header` 回调。历史分页仍由 `startReached={handleStartReached}`、`historyMetaBySession` 和 `isLoadingOlderRef` 驱动，不改变分页行为。
- 回归测试：`src/components/Chat/chatProductionHardening.test.ts` 禁止保留无挂载的 Header 实现。

### 3. Provider picker 被替代的 ProviderCard

- 文件：`src/pages/ConfigManager/ProvidersTab.tsx`
- 依据：`ProviderCard` 没有调用方；当前选择器只通过 `CatalogCard` 渲染 `ProviderCatalogEntry`，设计测试也以该选择器为现行界面契约。
- 变更：删除旧 `ProviderCard` 组件，并将设计测试的选择器切片边界改为现行 `ProviderConfigOverride` 声明。
- 回归测试：`src/pages/ConfigManager/ProvidersTab.design.test.ts` 禁止重新保留该旧组件。

### 4. Workshop 未渲染的 ActivityTimeline

- 文件：`src/pages/Workshop.tsx`
- 依据：`ActivityTimeline` 没有 JSX 调用方；页面虽然从 store 解构 `activities`，但该值也从未使用。
- 变更：删除未渲染的 timeline、专用格式化函数和相关 imports，并停止无意义地订阅 `activities`。
- 边界：store 仍保留活动记录写入行为，本项只清理不可达的页面展示实现，不改变任务操作和持久化。
- 回归测试：`src/pages/maintenancePages.design.test.ts` 禁止重新引入未渲染 timeline。

### 5. Collaboration service 未引用声明

- 文件：`packages/junqi-collab/src/service.ts`
- 依据：严格 TypeScript 检查报告 `ACTIVE_RUN_STATUSES_SQL`、`scheduleActiveRunReconciliation` 和文件末尾的 `readStringArray` 仅有声明、无调用；全包引用检索确认同名的 `domain.ts` helper 是独立且仍在使用的实现。
- 变更：删除这三个未引用声明，不修改实际运行中的 `reconcileActiveRuns`、逐 Run reconciliation 或 domain 输入校验链路；并在 collaboration 包的 `tsconfig.json` 启用同样的 unused 门禁。
- 验证：collaboration 包严格 TypeScript 检查通过，完整 collaboration 测试 368/368 通过。

### 6. 根前端严格 unused 清理

- 范围：严格 TypeScript 检查报告的未使用 imports、局部声明、解构项和内部参数，涉及 Chat、Git、Layout、Setup、Calendar、ConfigManager、Gateway、stores 等模块。
- 依据：仅应用 TypeScript 对 `TS6133`、`TS6192`、`TS6196` 提供的 unused declaration 删除修复；对公开签名或接口实现仍需保留的参数改用 `_` 前缀，不删除动态入口或兼容 API。
- 结果：根项目 `noUnusedLocals` 和 `noUnusedParameters` 从 188 条诊断降为 0 条，并在 `tsconfig.json` 中正式设为 `true`，防止回归。
- 契约修正：`parseDiff` 的未使用 `projectPath` 参数同步从唯一调用方移除；`getDirection` 等仍有消费者传参的稳定签名保留可选参数。

### 7. 未引用 package 与 Cargo 依赖

- `package.json` / `pnpm-lock.yaml`：删除仓库源码和脚本均无引用的 `@types/dompurify`、`@xterm/addon-web-links`、`date-fns`、`dotenv`、`rehype-raw`、`ws`、`@types/three`、`@types/ws`。其中 `dompurify` 本体仍由 Skills 页面使用并保留；Tauri CLI 和 TypeScript/React 类型等构建依赖也保留。
- `src-tauri/Cargo.toml` / `Cargo.lock`：删除 Rust 源码无引用的 `serde_yaml`；内置 skill 的 `.yaml` 路径是文件名契约，不需要 serde YAML parser。
- 验证：重新安装锁文件后执行完整测试、构建、collaboration package 校验和 `cargo check --lib`。

### 8. 第二轮入口图与静态资源清理

- 依据：在 unused 编译门禁之外解析生产源码的静态与动态 import 图，并逐一通过符号检索、路由入口和 Git 历史核对候选。
- 删除从未接入或已被现行实现替代的旧模块：Gateway HTTP history 分页尝试、`ContentParser` facade、旧终端工具 registry、旧 About/Shortcuts 面板、旧 Provider 多账户内存原型、旧 `TitleBar`、旧 sidebar footer、旧 Workspace renderer、未挂载的 OpenClaw 启动地图、重复 xterm 私有类型、无人消费的 barrel 和设计系统原型。
- 删除只服务于这些孤儿实现的测试与 helper：旧 file-preview state helper、OpenClaw 启动地图 state/runtime helper、agent skill wrapper、storage maintenance policy wrapper 和旧 agent workspace localStorage preferences。
- 删除已被当前 `JunQiLogo` 的大侠集团品牌资源取代且全仓无生产引用的 `junqi-company-logo.png`、`junqi-emblem.svg`、`junqi-logo-full.png`。
- 保留边界：`hostAdapter.ts` 和 `providerClaimClient.ts` 当前由 Workbench 目标架构及跨 TypeScript/Rust 契约测试覆盖，不能仅因尚未挂载到当前 UI 就视作可删除。

### 9. ExternalFileChangeBanner 断链修复与旧预览链收敛

- 发现：`ExternalFileChangeBanner.tsx` 本身无引用，但新版 `EditorDocumentManager` 会产生 `conflicted` 状态；这是冲突解决 UI 漏接，不是无用组件。
- 修复：将 banner 接回 `FilePreviewPane`，提供“从磁盘重新加载”和“保留本地编辑”两条显式解决路径，并为 controller 增加对应状态转换。
- 数据安全：旧 `useFilePreviewDocument` 虽已不可达，却仍是 `write_file_content_if_unchanged` 的唯一前端消费者。删除前先把 compare-and-swap 写入及失败后的磁盘内容回读迁移到现行 `localEditorDocuments` / `EditorDocumentManager`，避免新版编辑器静默覆盖外部修改。
- 结果：迁移后删除旧 preview hook、watch hook 和旧 state helper；Tauri CAS command、注册项与 Rust 行为测试继续保留。
- 回归：`editorDocumentManager.test.ts` 覆盖 CAS 拒绝、冲突状态、接受磁盘内容和保留本地草稿；文件预览契约测试改为约束现行链路。

## 验证结果

- `pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false`：通过，0 条 unused 诊断。
- `pnpm --dir packages/junqi-collab exec tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false`：通过。
- 定向 Chat、voice、provider、workshop 回归：38/38 通过。
- `pnpm lint`：通过。
- `pnpm test`：第二轮清理后前端 1794/1794、脚本 223/223 通过；数量下降来自删除只覆盖孤儿实现的测试。
- `pnpm collab:test`：368/368 通过。
- `pnpm collab:validate`：通过。
- `pnpm build`：第二轮清理后通过；Vite 转换 8928 个模块，collaboration bundle 仍与 metadata 一致。
- `cargo check --lib`：通过。
- `cargo test --lib`：651 通过、3 ignored、0 失败。
- `git diff --check`：通过。
- 自动化验证不代表音频播放或目标平台真机验收。

## 未验证边界

- 未进行 macOS、Windows 或 Linux 真机音频播放验收；
- 第二轮已补充生产 import 图、符号引用、静态资源和 Git 历史核对。当前入口图只剩 `src/workbench/adapters/hostAdapter.ts` 与 `src/workbench/provider/providerClaimClient.ts` 两个尚未挂载到生产 UI 的候选；它们分别承担 host revision fail-closed 契约和 TypeScript/Rust Provider claim IPC 契约，已有目标架构及跨边界测试，因此保留。
- Tauri 注册表中未出现前端字符串消费者的 command 还包括系统托盘、原生菜单、内嵌 console、运行时内部调用及尚未接入的 secure provider OAuth 等入口；反射式文件路径、外部插件公共 API 与目标平台条件编译也不能仅靠静态入口图证明，未作推断性删除。
