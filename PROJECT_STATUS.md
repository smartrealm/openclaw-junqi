# 项目交接状态

更新时间：2026-08-09

## 当前目标

以最新版 OpenClaw 官方源码为权威，收敛 JunQi Gateway 原生协议、插件扩展、Tauri 本地能力和前端投影
之间的权限、事件、终态、凭据与模块边界。当前代码已完成直接协议错误和已确认循环整改，正在等待真实
Gateway、三平台真机和剩余契约测试迁移。

## 已完成内容

- 将规划、自主排障、完整验证、错误复盘、根因修复和端到端负责固化为仓库级代理工作规范。
- 使用 OpenClaw 官方 `origin/main` 提交 `7a8eee4a363b6fd097a40d221aedcff14e61cc8c` 核对方法、
  动态会话权限、Wizard、Chat 事件、事件目录和插件注册 API。
- 重写模块边界扫描器，生产与测试复用同一实现；别名、相对路径、类型、动态和再导出使用同一路径语义。
- 将 130 个已发现边界违规收敛为零，拆除 `Connection/gatewayDataStore` 和
  `chatStore/gateway/ChatHandler` 循环。
- 二维码登录的 `web.login.start/wait` 只走管理员连接，渠道状态读取走普通连接。
- Chat 支持官方 `deltaText`、累计快照、`replace` 和启动 phase；发送协调器与 store、Gateway facade
  完成依赖倒置。
- Wizard 不再从本地配置、超时、标题或消息文本推断完成与失败语义；会话丢失只通过官方流程恢复。
- 会话模型 patch 使用普通写连接；管理员运行参数保持原权限边界。
- 删除非官方 Gateway 顶层 session、agent 和 task 事件分支。
- 删除 `gateway-config` token 事件、旧配置 resolver、写死供应商 OAuth 和六个无消费者的供应商密钥
  command；系统凭据库只保留 Gateway 设备凭据实际使用的窄接口。
- 按职责迁移组件、运行时、副作用、纯投影、状态与类型文件；旧路径和无消费者包装一并删除。
- 新增审计、规格、计划和验证记录：
  - `docs/quality/gateway-native-extension-consistency-audit-2026-08-09.md`
  - `docs/quality/gateway-native-extension-consistency-validation-2026-08-09.md`
  - `specs/quality/2026-08-09-gateway-native-extension-consistency-remediation.md`
  - `plans/quality/2026-08-09-gateway-native-extension-consistency-remediation.md`

## 关键技术决策

- OpenClaw 核心 RPC、事件、Wizard、Chat、会话和工具语义只由最新版官方源码、协议和真实回执定义。
- 普通、管理员和本地 Tauri 能力通过窄端口在组合根注入；业务状态机不能自行选择更高权限连接。
- transport 不持有 store，store 不导入含运行时副作用的总 facade；纯投影进入 `processing`，副作用组合进入
  `runtime`，稳定值类型进入 `types`。
- Wizard outcome、配置存在、Gateway 身份和模型验证是独立事实，任何一个都不能替代官方终态。
- 通用供应商 OAuth 和明文 API Key 读取不属于 JunQi 的 OpenClaw 客户端边界，已直接删除而非保留兼容层。

## 核心文件

- `scripts/check-boundaries.mjs`、`scripts/check-boundaries.test.mjs`：唯一模块边界扫描实现与行为测试。
- `src/services/gateway/OpenClawChannelQrLoginClient.ts`：二维码管理员请求端口。
- `src/processing/openClawChatEvent.ts`、`src/runtime/OpenClawChatEventRuntime.ts`：Chat 解码与运行投影。
- `src/hooks/useSetupFlow/useWizardSession.ts`、`src/services/openclawWizard.ts`：官方 Wizard 会话与恢复。
- `src/stores/chatGatewayOperations.ts`、`src/runtime/chatSendCoordinator.ts`：store 与发送副作用的组合边界。
- `src/stores/gatewayDataStore.ts`：官方 Gateway 数据投影。
- `src-tauri/src/commands/secret_store.rs`、`src-tauri/src/commands/gateway_credentials.rs`：系统凭据库窄接口。

## 测试与验证

- `pnpm lint` 通过；边界扫描检查 920 个生产文件，零违规。
- `pnpm test` 通过：前端 2849 项、脚本 234 项。
- `cargo fmt -- --check`、`cargo check --lib` 通过。
- `cargo test --lib` 通过：687 项通过、2 项明确忽略。
- `pnpm build` 通过，包括协作和钉钉资源打包、TypeScript 与 Vite 生产构建。
- `pnpm collab:test && pnpm collab:validate` 通过：368 项与插件包契约。
- `pnpm dingtalk:test && pnpm dingtalk:validate` 通过：12 项与插件包契约。
- `pnpm verify:openclaw-docs` 通过。
- `git diff --check` 和全部修改后文件的 Unicode Emoji 扫描通过。

## 已知问题

- Agent stream 尚未完成与 Chat 同等级的严格判别解码。
- 全部 Tauri command 尚未生成 WebView、Rust 内部、插件和测试消费者矩阵；未证明的项没有删除。
- `src/api/tauriCommandsContract.test.ts` 等历史测试仍存在源码文本断言，需要逐步迁移为可执行契约。
- `src/runtime/OpenClawChatEventRuntime.ts` 与 `src/pages/ChatView.tsx` 仍偏大，后续应按事件协调和历史视图
  继续拆分，但本轮不为缩短文件引入无消费者抽象。
- 尚未在最新版真实 Gateway 验证二维码、Chat、Wizard、协作插件和钉钉插件。
- 尚未完成 macOS、Windows、Linux 真机、安装包、正式签名、公证和 Release 验证。

## 下一步顺序

1. 为 Agent stream 建立官方判别联合，并让畸形事件在解码边界失败关闭。
2. 生成完整 Tauri command 消费者矩阵，逐项删除经运行入口证明无消费者的 command。
3. 将高风险源码文本守护迁移为解析器、序列化 fixture 或真实 handler 测试。
4. 在受控最新版 Gateway 回放二维码、Chat、Wizard、协作和钉钉插件。
5. 在 macOS、Windows、Linux 完成凭据库、WebView、窗口和真实 UI 验收。
