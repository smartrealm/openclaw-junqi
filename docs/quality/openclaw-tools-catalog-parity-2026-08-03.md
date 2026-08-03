# OpenClaw tools.catalog 能力对齐

## 依据

- 本机安装版本：`OpenClaw 2026.7.1-2 (0790d9f)`。
- 官方随包 `dist/schema-BuOFpc7K.js`：`ToolsCatalogParamsSchema` 只有可选 `agentId` 和 `includePlugins`；结果返回 `agentId`、profiles 和分组工具目录。目录项包含 `id`、`label`、`description`、`source`、可选 plugin/risk/tags，以及 `defaultProfiles`。
- 官方随包 `dist/tools-catalog-BKVZCAYn.js`：Gateway 从当前 Runtime 构建 core/plugin 目录，插件目录受实际插件注册表和 agent workspace 影响；不存在静态 provider/plugin 全集的客户端契约。
- 官方协议与 WebChat 文档：`tools.catalog` 是 `operator.read` 的配置目录视图；它不代表某个会话已经拥有这些工具，实际可用性由 `tools.effective` 返回。

## 当前行为

ConfigManager 的 Tools 页保留 Runtime schema 驱动的写入编辑器，并增加一个只读工具目录面板。面板调用 `tools.catalog`，展示默认 agent、profiles、core/plugin 分组、可选标记、风险和默认 profile。schema 不可用时，目录仍可独立展示；目录请求失败只显示可重试错误，不伪造空目录。

## 边界

- 目录只读，不在 JunQi 维护工具、插件、provider、环境变量或认证映射静态全集。
- 目录与会话实际可用工具明确分开：配置页看 `tools.catalog`，聊天上下文看 `tools.effective`。
- 未接入 `tools.invoke`。该方法可能触发外部副作用，必须先有工具确认、权限、审计和幂等策略，不能从只读目录入口直接执行。

## 实现

- `src/services/gateway/toolsCatalog.ts`：严格构造参数并解析官方返回结构。
- `src/services/gateway/index.ts`：增加 `gateway.getToolsCatalog` 只读出口。
- `src/hooks/useToolsCatalog.ts`：处理请求取消、旧响应隔离、加载和错误状态。
- `src/pages/ConfigManager/ToolsCatalogPanel.tsx`：展示 Runtime 权威目录；`ToolsTab.tsx` 保留原有 schema 写入边界。

## 验证

- `toolsCatalog.test.ts` 覆盖官方可选参数、core/plugin provenance、profiles、risk、optional 和严格字段失败。
- `pnpm exec tsc --noEmit` 通过。
- 已核对本机 OpenClaw 版本的 schema、handler、权限描述和控制台文档。

## 未验证边界

- 当前主机为 macOS，未在 Windows/Linux 真机和真实 Gateway 插件注册表中执行目录请求并取得线上响应样本。
- 插件目录是否包含某一具体工具由当前 Runtime、workspace 和插件状态决定，JunQi 不作静态保证。
