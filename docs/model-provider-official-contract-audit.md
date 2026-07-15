# 模型供应商官方契约审计

审计基线：本机 OpenClaw `2026.7.1 (2d2ddc4)` 的 `openclaw config schema`、CLI 帮助与随包官方文档。范围覆盖供应商选择、认证、模型目录、编辑、保存、验证、重启与失败反馈。

## 修复状态（2026-07-15）

下述八项问题已全部修复。供应商配置现在以当前 OpenClaw CLI 为权威来源：目录和 schema 可运行时读取，候选配置在写盘前由官方命令校验，连接测试通过官方 probe，OAuth 通过终端执行官方认证流程；SecretRef、高级 provider/model 字段、目录模式、通配符和认证顺序均有独立可视化入口。

验证结果：前端与脚本测试全部通过，Rust 288 项测试通过（2 项按预期忽略），生产构建、Rust 格式与 diff 检查通过。OpenClaw 2026.7.1 实测能接受完整候选配置，并能对无效 adapter 和缺少模型名称返回精确字段路径。

## 审计时结论

修复前 UI 不是 OpenClaw 官方供应商配置的完整可视化实现。API Key、Base URL、API adapter、显式模型、默认模型和图片模型的基本链路可用，保存时也会保留未知高级字段；但 OAuth、官方探测、完整 schema 验证、动态官方目录、SecretRef 与高级供应商/模型字段仍缺失或绕开官方实现。以下问题描述保留为审计依据。

## 严重问题

### BUG-MP-01 · CRITICAL — OAuth 选项没有执行官方认证流程

**位置**：`src/types/providerAuthMode.ts:11`、`src/pages/ConfigManager/ProvidersTab.tsx:196`、`src/pages/ConfigManager/ProvidersTab.tsx:2364`

UI 定义了浏览器和设备 OAuth 能力，但供应商表单只据此隐藏 API Key 输入，提交时直接生成 `mode: oauth` 元数据。生产前端没有调用 `openclaw models auth login`，Tauri 中手写的 `start_provider_oauth` 也没有调用点，且其结果不写入 OpenClaw 官方 auth store。

**影响**：界面会显示供应商已添加，但 OpenClaw 没有可用 OAuth 凭据；GitHub Copilot 等 OAuth-only 入口必然不可用。

**修复**：统一调用当前 OpenClaw 的 provider plugin auth flow；完成后读取 `models auth list --json` 刷新 UI，失败不得创建伪认证档案。

### BUG-MP-02 · CRITICAL — 写盘只做浅层结构检查

**位置**：`src-tauri/src/commands/config.rs:162`

后端只验证根对象、少量对象字段和 Gateway 端口，没有验证官方 schema 的枚举、必填字段、范围或 `additionalProperties: false`。

**影响**：导入或 UI 漂移可把无效 `api`、缺少 `name` 的模型或未知字段写入正式配置，随后 Gateway 重启失败并影响所有频道。

**修复**：写盘前使用当前已安装 OpenClaw 的 `config validate --json` 对临时候选配置做权威验证；仅验证成功后备份并原子替换。

### BUG-MP-03 · CRITICAL — 连接测试绕过 OpenClaw 运行时

**位置**：`src/pages/ConfigManager/providerConnectionTest.ts:37`、`src/pages/ConfigManager/ProvidersTab.tsx:1203`

当前测试由 WebView 直接请求 `/models` 或 `/chat/completions`，手工拼认证头。它不经过 OpenClaw 的 provider plugin、SecretRef、auth order、OAuth、API adapter、运行时选择及请求兼容层。

**影响**：可能把可用官方配置判为失败，也可能把 OpenClaw 实际不可用的配置判为成功；CORS 与供应商非标准 `/models` 行为会进一步制造假故障。

**修复**：保存候选配置后在隔离路径调用官方 `models status --probe --json`，使用稳定 reason code 显示认证、限流、计费、超时和无模型原因。

### BUG-MP-04 · HIGH — 供应商与模型目录已落后于当前官方版本

**位置**：`src/pages/ConfigManager/providerTemplates.ts:65`、`src/generated/providerCatalog.generated.ts:7`

例如 UI 仍推荐 `openai/gpt-4o`、`openai/gpt-5.4` 和旧 Anthropic/xAI 型号；OpenClaw 2026.7.1 新安装默认已是 `openai/gpt-5.6` / `openai/gpt-5.6-sol`，并包含 Claude Sonnet 5、Grok 4.3 等目录。

**影响**：新用户被引导到旧或账户不可见模型；供应商官方插件更新后，桌面端目录不会同步。

**修复**：运行时从 `openclaw models list --all --json` 获取目录并缓存，静态模板只保存 UI 元数据与离线兜底，不再充当官方模型真相源。

## 中等问题

### BUG-MP-05 · MEDIUM — 生成脚本实际只复制手写模板

**位置**：`scripts/generate-provider-catalog.js:13`、`scripts/generate-provider-catalog.js:55`

脚本只在仓库 `resources/node-*` 找 bundled OpenClaw；当前源码树没有该资源，最终生成数据来自 `providerTemplates.ts` 自身，因此“generated catalog”并未校验官方包。

**修复**：显式接收 OpenClaw package/binary 路径，生成时记录版本与提交；缺少官方源时失败而不是静默回退成自我复制。

### BUG-MP-06 · MEDIUM — 官方供应商高级字段没有可视化入口

**位置**：`src/pages/ConfigManager/ProviderModelEditor.tsx:9`、`src/pages/ConfigManager/types.ts:313`

官方 provider schema 还包含 `auth`、`timeoutSeconds`、`contextWindow`、`contextTokens`、`maxTokens`、`region`、`headers`、`request`、`params`、`agentRuntime`、`localService` 等；模型条目还包含 reasoning、cost、compat、runtime、headers、mediaInput 等。当前模型编辑器只支持别名和图片输入。

**修复**：建立 schema 驱动的分组表单。常用字段直接展示，嵌套对象使用可验证的键值/结构化编辑器；未知未来字段仍可无损保留。

### BUG-MP-07 · MEDIUM — SecretRef 只能识别，不能从供应商 UI 创建

**位置**：`src/pages/ConfigManager/providerSecretResolver.ts:92`

当前能识别官方 SecretRef 对象，却主要把新密钥明文放入 `env.vars`，自定义供应商再写 `${ENV_KEY}`。没有 env/file/exec SecretRef 的可视化创建流程。

**修复**：密钥来源改为“系统环境 / SecretRef / 临时输入”显式选择；默认推荐 SecretRef 或系统环境，不回显真实密钥。

### BUG-MP-08 · MEDIUM — 官方目录模式、通配符与认证顺序不可管理

**位置**：`src/pages/ConfigManager/types.ts:347`、`src/pages/ConfigManager/ProviderModelEditor.tsx:67`

UI 未覆盖 `models.mode`、`provider/*` allowlist 与 `auth.order`。把 `*` 当普通模型添加还会同时生成 `models.providers.<id>.models[{id:"*"}]`，不符合官方通配符只属于 `agents.defaults.models` 的语义。

**修复**：增加 merge/replace、动态发现开关和多档案优先级控件；通配符使用专用 mutation，不进入 provider model rows。

## 已验证的良好基础

- 保存前重新读取磁盘并做三方合并，可保留外部 CLI 修改。
- 写盘使用备份和原子替换。
- `auth.profiles` 写盘前会收敛到官方允许的 provider/mode/email/displayName。
- provider/model mutation 会同步默认模型引用并清理删除后的悬空引用。
- 归一化层会保留多数未知 provider/model 高级字段，便于渐进扩展。
