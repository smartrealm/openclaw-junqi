# 项目交接状态

更新时间：2026-08-09

## 当前目标

以最新版 OpenClaw 官方源码和协议为权威，保持 JunQi 作为桌面客户端的边界。当前阶段已将
`Blues-Code/Jarvis` 的 Provider 认证、配置 Schema 和钉钉业务工作台变更并入 `main`，同时保留 `main` 已完成的
Gateway 权限、事件、凭据、模块边界与工程执行规范收敛。

## 已完成内容

- 将规划、自主排障、完整验证、错误复盘、根因修复和端到端负责固化为仓库级代理工作规范。
- 使用 OpenClaw 官方 `origin/main` 提交核对 Gateway 方法、权限、Wizard、Chat 事件、会话和插件注册契约。
- 模块边界扫描器由生产与测试复用同一实现，别名、相对路径、类型、动态导入和再导出使用同一路径语义；已发现的边界违规与循环依赖已收敛。
- 二维码登录、会话模型写入、运行参数和配置 Schema 分别使用与官方方法一致的权限连接，不再从方法广告、文本或本地状态推断成功。
- Chat 支持官方 `deltaText`、累计快照、`replace` 和启动 phase；Wizard 只呈现官方结构化步骤，不从标题、消息、超时或本地配置推断终态。
- 删除 `gateway-config` token 事件、旧配置 resolver、写死供应商 OAuth、无消费者供应商密钥 command 和被替代的旧模块路径。
- Provider 官方认证健康、到期信息、实时验证和受控注销收敛到对应 Provider 卡片；独立认证面板及其专属测试已删除。
- `config.schema` 严格解析包含 `schema`、`uiHints`、`version` 和 `generatedAt` 的官方响应信封，缓存绑定当前已认证 Gateway 连接，连接切换后的迟到结果失败关闭。
- 钉钉业务工作台统一为“有效工具”“操作审计”“接入与授权”三个稳定入口；能力只从当前 Session 的 `tools.effective` 投影，调用经 `tools.invoke` 和插件审批边界执行。
- 钉钉就绪状态保留插件安装、Agent 授权、Gateway 重启、DWS 安装与设备授权的真实未就绪和失败语义，不以本地状态推断成功。
- 工具表格按当前有效工具返回的真实业务域分组；工具页将请求失败、Runtime 未公开字段和空数据分别呈现。

## 关键技术决策

- OpenClaw 是 Agent、会话、工具、Transcript、任务、配置和运行时状态的唯一权威；JunQi 只保存绑定运行时身份的派生投影。
- OpenClaw 核心 RPC、事件和响应字段由最新版官方源码、协议 Schema 和真实回执定义，安装版本仅用于复现兼容差异。
- 普通、管理员和本地 Tauri 能力通过窄端口注入；业务状态机不能自行选择更高权限连接。
- DWS 认证、Profile、token 与业务执行属于 DWS 和 OpenClaw 插件；桌面侧不读取 token、不写入 Transcript，也不重放未知副作用。
- `config.schema` 只接受官方响应信封；不接受裸 Schema、别名字段、版本 fallback 或方法广告门禁。

## 核心文件

- `scripts/check-boundaries.mjs`、`scripts/check-boundaries.test.mjs`：模块边界扫描与行为测试。
- `src/services/gateway/OpenClawChannelQrLoginClient.ts`：二维码管理员请求端口。
- `src/processing/openClawChatEvent.ts`、`src/runtime/OpenClawChatEventRuntime.ts`：Chat 解码与运行投影。
- `src/hooks/useSetupFlow/useWizardSession.ts`、`src/services/openclawWizard.ts`：官方 Wizard 会话与恢复。
- `src/pages/ConfigManager/ProvidersTab.tsx`、`src/services/openclawConfigSchema.ts`：Provider 认证投影和官方 Schema 信封解析。
- `src/pages/BusinessApplicationsPage.tsx`、`src/components/BusinessApplications/`、`src/business-applications/`：钉钉工作台与能力投影。
- `packages/junqi-dingtalk/`、`src-tauri/src/commands/dingtalk_plugin.rs`、`src-tauri/src/commands/dws_operation.rs`：钉钉插件和 DWS 运行时边界。

## 测试与验证

- `main` 合并前已通过 `pnpm lint`、`pnpm test`、`pnpm build`、Rust 格式检查、库检查、库测试、协作与钉钉插件验证及 OpenClaw 文档链接验证。
- `Blues-Code/Jarvis` 分支在合并前记录了 Provider 认证、配置 Schema、钉钉工作台的定向测试、完整前端测试、lint 和生产构建通过。
- 当前 `main` 合并结果已通过 22 项定向回归、`pnpm lint`、完整 `pnpm test` 和 `pnpm build`；边界扫描检查 920 个生产文件且零违规，生产构建同时重新打包并验证协作与钉钉插件资源。

## 已知问题

- Agent stream 尚未完成与 Chat 同等级的严格判别解码。
- 全部 Tauri command 尚未生成 WebView、Rust 内部、插件和测试消费者矩阵；未证明的项没有删除。
- 尚未在最新版真实 Gateway 验证二维码、Chat、Wizard、Provider 认证、配置 Schema、协作和钉钉插件。
- 尚未在真实租户验证钉钉插件安装、`tools.effective`、`tools.invoke`、插件审批、DWS 授权和业务响应。
- 尚未完成 macOS、Windows、Linux 的凭据库、WebView、窗口、安装包、正式签名、公证和真实 UI 验收。

## 尝试过但未采用的方案

- 未直接选择钉钉工作台冲突任一侧的实现；只保留单侧会丢失真实 DWS 操作或三个稳定工作区，因此合并为单一调用链，不保留双轨入口。
- 不接受 `config.schema` 裸对象或本地兼容别名；这些路径会掩盖 Gateway 协议漂移。

## 下一步顺序

1. 为 Agent stream 建立官方判别联合，并让畸形事件在解码边界失败关闭。
2. 生成完整 Tauri command 消费者矩阵，逐项删除经运行入口证明无消费者的 command。
3. 在受控最新版 Gateway 回放二维码、Chat、Wizard、Provider、协作和钉钉插件。
4. 在 macOS、Windows、Linux 完成真实运行、视觉、安装与发布验收。
