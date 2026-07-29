# OpenClaw 配置权威源审计（2026-07-29）

## 审计契约

OpenClaw 配置字段、枚举、默认值、约束、渠道/provider/plugin 能力和文件位置必须来自当前选定 Runtime 的官方 schema、catalog、capability、Wizard、selected config identity 或项目中经版本审查的兼容契约。JunQi 不得把某一 OpenClaw 版本的完整配置知识复制成独立的可写 schema。

以下不属于违规硬编码：

- OpenClaw CLI、Gateway RPC 和 config path 本身的协议字段；
- selected runtime 的受审 Docker 容器契约；
- 用户明确选择后的最小 bootstrap 字段；
- 有测试与版本边界的 legacy migration；
- UI 文案、测试夹具和不参与写配置的示例。

审查依据为仓库锁定的 `openclaw@2026.7.1`、本机安装的 `OpenClaw 2026.7.1-2` 及其 `openclaw config schema` 输出。

## 🔴 BUG-OCA-01 · Agent 配置枚举与约束由 JunQi 静态维护且已经漂移

**位置**：`src/pages/ConfigManager/AgentsTab.tsx`

当前页面静态维护 `THINKING_OPTIONS`、`COMPACTION_MODE_OPTIONS`、`PRUNING_MODE_OPTIONS` 和 `maxConcurrent` 上限。其中 compaction 写入 `rolling/full/off`、pruning 写入 `adaptive`，但当前官方 schema 的枚举分别是 `default/safeguard` 和 `off/cache-ttl`；thinking 又遗漏当前 Runtime 支持的值。用户可以从 JunQi UI 生成当前 OpenClaw 不接受的配置。

**修复结果**：已完成。Agent 高级字段从当前 Runtime schema 解析 enum、minimum、maximum；schema 不可用时保留现有值并禁用受约束写入，不猜默认值。

## 🔴 BUG-OCA-02 · Tools/provider/plugin 配置能力被整套硬编码

**位置**：`src/pages/ConfigManager/ToolsTab.tsx`、`src/pages/ConfigManager/toolsProviderDetection.ts`、`src/pages/ConfigManager/toolsProviderMutation.ts`、`src/pages/ConfigManager/index.tsx`

页面静态维护 Web Search provider 集合、plugin ID、认证复用映射、环境变量名、API Key/Base URL 要求及配置落点，并在保存前自动选择 provider。这些事实会随 OpenClaw 内置工具和插件 schema 漂移，且当前 `tools.web.search.provider` 官方 schema 只是动态字符串，不授权 JunQi 维护 provider 全集。

**修复结果**：已完成普通 Tools 配置面。删除静态 provider/plugin/env 写入映射与自动 provider 选择；Tools 编辑器改为当前 Runtime schema 驱动。schema 不可用时 fail closed，并引导使用 raw editor/官方 Wizard。

## 🔴 BUG-OCA-03 · 本地 TypeScript/Rust 校验复制了不完整 OpenClaw schema

**位置**：`src/pages/ConfigManager/types.ts`、`src/types/openclawApiProtocol.ts`、`src-tauri/src/commands/config.rs`

前端维护大份手写 `OpenClawConfig`，Rust `validate_openclaw_config_shape` 只校验少数字段。类型和校验均可能给调用方“已经符合 OpenClaw schema”的错误保证。`openclawApiProtocol.ts` 的注释还错误声称 JunQi 是 OpenClaw 可接受值的权威源。

**修复结果**：已完成核心边界。手写类型已明确降级为保留未知字段的非权威 UI projection；API protocol 不再维护 JunQi 白名单，现有/未来 Runtime 字符串原样保留，仅迁移一个经审查 legacy 值；写盘仍由官方 config validation 门禁。

## 🟡 BUG-OCA-04 · Schema 读取只服务 provider advanced editor

**位置**：`src/services/openclawConfigSchema.ts`

已经有官方 `openclaw config schema` IPC，但解析器硬编码到 `models.providers.additionalProperties`，仅 provider advanced editor 使用。Agent、Gateway、Tools、Commands 等仍使用手写 UI 契约。

**修复结果**：已完成 resolver 与首批迁移。新增通用 schema path resolver，支持本地 `$ref`、`properties`、`additionalProperties`、array items 和 `anyOf/oneOf` 枚举；Agent、Tools 与 provider API protocol 已消费同一 Runtime schema snapshot。其余面板的逐步迁移保留为后续范围。

## 🟡 BUG-OCA-05 · Config Manager 保存路径会主动规范化未编辑领域

**位置**：`src/pages/ConfigManager/index.tsx`

`normalizeConfig`、`normalizeConfigForDisk` 和 web provider 自动选择在整份配置保存时主动改写多个领域。即使最终官方验证能拒绝错误值，也可能删除或重排 JunQi 不认识的新字段语义。

**修复结果**：部分完成。现有 `smartMerge` 继续在最新磁盘配置上合并用户变更；已删除保存时基于静态凭据映射自动选择 Tools provider 的副作用。Provider/Agent 历史 normalization 仍需按迁移契约继续拆分，属于未完成边界。

## 🟡 BUG-OCA-06 · 配置文件名和 Docker 路径存在重复协议常量

**位置**：`src-tauri/src/paths.rs`、`src-tauri/src/commands/docker.rs`、`src-tauri/src/commands/runtime_identity.rs`、`src-tauri/src/commands/collaboration_bootstrap.rs`

`openclaw.json` 与 `/home/node/.openclaw` 在多个生产模块重复。它们当前属于受审 Runtime/容器协议，不应删除，但重复定义容易漂移。

**修复结果**：已完成已确认的生产重复。`runtime_identity` 与 collaboration bootstrap 已统一引用 `commands::docker` 的容器状态/配置路径常量；Native 路径继续由 selected layout/环境解析。测试夹具和备份文件名不属于运行时路径权威。

## 验收边界

- [x] 生产 UI 不再包含会写入当前 Runtime schema 枚举之外值的 Agent/Tools/Commands/provider protocol 静态选项。
- [x] 任意 Config Manager 写盘候选都经过当前选定 Runtime 的官方 validation。
- [x] schema 不可用时 fail closed，不用 JunQi 静态全集代替。
- [x] 未知字段在读取、编辑无关字段和保存后保持不变，并有 `configMerge.test.ts` 回归。
- [x] Tools provider/plugin 能力不由 JunQi 静态全集决定；旧映射和 mutation 已删除。
- [x] Gateway rescue 不再从 provider template 猜 API/base URL，只消费 selected config 显式值。
- [x] Docker/Native selected config identity 和专用 collaboration/update 事务保持不变。

## 验证结果

- `pnpm lint`：通过，检查 584 个模块边界。
- `pnpm test`：前端 1791/1791、脚本 223/223。
- `pnpm build`：collaboration bundle、TypeScript 与 Vite production build 通过。
- `cargo fmt -- --check`、`cargo check --lib`：通过。
- `cargo test --lib`：651 passed、3 ignored。
- Runtime schema/Config Manager/Gateway rescue 定向回归：通过。
- `git diff --check`：通过。

未执行 Windows/macOS/Docker 真机配置编辑、官方 Wizard 和 Gateway rescue 循环；这些仍属于目标平台验收边界。
