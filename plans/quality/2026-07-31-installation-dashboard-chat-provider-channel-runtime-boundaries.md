# 安装、仪表盘、聊天、模型与渠道运行时边界实施计划

## 已完成步骤

1. 将 OpenClaw 配置 JSON5 解析、形状校验、selected-runtime 路径和 revision 比较收敛到 Rust command 边界。
2. 移除前端完整配置备份和可编辑路径，建立共享配置类型与 revision-aware Tauri 适配接口。
3. 建立渠道配置分区三方合并，保护元数据、未编辑配置和路由绑定，并补充冲突重试测试。
4. 移除跨 runtime 的提供商目录缓存和静态目录回退；将候选验证文件限制在私有临时目录。
5. 将 Setup 进度绑定到 native operation ID，并让前端协调器拒绝过期进度。
6. 为 Gateway 数据组建立连接和请求双重栅栏，集中连接开始时间供 Dashboard 使用。
7. 提取工具生命周期投影，统一 live event、agent item 和历史 transcript 的状态、错误和输出截断处理。
8. 将 Chat 文件卡片归属到共享 Markdown 渲染器，增加历史结构化工具结果与文件分类职责回归测试。
9. 执行 lint、完整前端测试、Rust 格式/编译/库测试、生产构建和 diff 检查。

## 文件边界

- 配置：`src-tauri/src/commands/config.rs`、`src/api/tauri-adapter.ts`、`src/types/openclawConfig.ts`、`src/pages/ConfigManager/`。
- 渠道与模型：`src/services/channelConfig*.ts`、`src/services/openclawProviderRuntime.ts`、`src/pages/ChannelsCenter/`、`src/pages/ConfigManager/ProvidersTab.tsx`。
- 安装与仪表盘：`src-tauri/src/commands/setup_progress.rs`、`src/hooks/useSetupFlow/`、`src/stores/gatewayDataStore.ts`、`src/pages/Dashboard/useGatewayUptime.ts`。
- Chat：`src/processing/toolExecutionProjection.ts`、`src/processing/normalize*Message.ts`、`src/services/gateway/ChatHandler.ts`、`src/components/Chat/`。

## 验证和人工后续

- 自动化验证已覆盖配置 revision、渠道并发保存、提供商 runtime 切换、安装过期事件、连接迟到响应、结构化工具结果和文件分类归属。
- 后续人工验收应使用隔离测试环境分别验证 Native、Docker、Windows、macOS、真实 Gateway、真实 provider 和真实渠道账号；不得把开发机现有凭据或服务状态作为通过依据。
