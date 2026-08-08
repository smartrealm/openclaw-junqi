# 项目交接状态

更新时间：2026-08-08

## 当前目标

完成 JunQi Desktop 作为 OpenClaw 客户端的跨平台桌面交付：保持 Gateway、会话、模型、Cron 与首次启动链路的
官方契约；钉钉业务工作台通过受控 OpenClaw 插件呈现 DWS 的真实能力，不在桌面侧重定义 Agent、工具或业务状态。
钉钉单平台业务工作台 UI 已迁移到生产页面，当前目标是完成插件运行时与真实业务契约验收。实现采用独立 OpenClaw 钉钉插件包装 DWS，业务页与 Chat 共用
`tools.effective`、`tools.invoke` 和插件审批；Tauri 只负责经过 Runtime Identity 围栏的插件安装与启用，不直接执行 DWS。
正式 DWS 发布包、真实 Gateway 审批往返和测试租户端到端仍是下一步门禁。

## 本阶段已完成

- 已完成 `packages/junqi-dingtalk` 插件、30 工具 manifest、schema 校验、DWS runner、审批 hook、打包资源和 Tauri 安装命令。
- 已完成专属 Agent 的双层授权实现和 DWS 当前用户/授权投影；`allowedAgentIds` 空配置失败关闭，工作台自动读取运行状态并展示用户、组织、profile 状态和安全头像地址。
- 已完成紧凑 DWS readiness 状态条；按实际运行结果引导插件安装、Gateway 重启、Agent 授权、DWS 官方安装交接、身份确认和重新检测，不自动安装 DWS 或伪造授权结果。
- 已完成钉钉业务活动的双层审计投影：优先展示当前 Gateway 跨 Session 的 OpenClaw metadata-only 钉钉工具账本，补充本窗口受控调用的 runtime、Session、Agent、Profile、审批和 DWS 关联元数据；无上游委派证据时不推断关系。
- 已完成 DWS 缺失安装交接弹层：按 Gateway 运行位置说明安装目标，提供官方 macOS/Linux、Windows、npm 入口、登录命令、复制、官方文档和重新检测；不执行远程脚本或读取 token。
- 已完成钉钉业务插件未就绪时的“在 JunQi 安装”入口；安装仍受当前 Gateway 身份验证和桌面变更权限约束，完成后必须重启 Gateway 并重新读取当前 Session 工具。
- 已完成插件安装阶段反馈与阻断原因投影：展示目标核对、等待 Gateway 安装与启用、结果和重启要求；外部或远程 Gateway、身份未核验、端点或路径不匹配均给出对应原因，不伪造 Gateway 进度。
- DWS runner 已收紧为最小环境白名单，不继承 Gateway token、DWS access token 或其他无关进程密钥。
- 环境白名单回归、插件重新打包和最新 `pnpm build` 已通过，桌面资源中的插件归档已核对包含该实现。
- 已完成业务页生产迁移：钉钉单平台、当前 Session 工具投影、左筛选/中表格/右详情三栏、拖拽和收起、参数 schema 展示、调用状态与脱敏活动投影。
- 已删除旧多平台目录、Chat bridge、静态 Journal 及其专属测试和无引用导出，不保留兼容双轨。
- 已通过 `pnpm test`、`pnpm lint`、`pnpm build`、`pnpm verify:openclaw-docs`、`pnpm check:boundaries`、Rust `cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`、插件测试/校验/打包和 `git diff --check`。

## 当前未验证

- 正式 DWS 发布包安装、真实钉钉租户权限和业务响应 envelope 尚未执行。
- 真实 Gateway 中插件加载、`tools.effective`、`tools.invoke`、`plugin.approval.*` 往返尚未执行。
- macOS、Windows、Linux、Docker Gateway 的安装、凭据库、重启和亮暗主题/键盘/窄窗口真机视觉验收尚未执行。
- 2026-08-08 本机 PATH 未发现 `dws`，当前 OpenClaw `2026.7.1-2` 的插件列表没有 `junqi-dingtalk`；本轮只读确认，未改变本机 Gateway 或认证状态。

## 已完成内容

- 首次启动完成门禁区分 `verified`、`failed` 和 `unavailable`；官方模型验证能力缺失时如实标记待核验，
  不伪报成功或失败。
- 默认主会话按 OpenClaw `agents.list.mainKey` 固定在最左侧；新会话创建确认保留空 leaf，避免新会话误加载历史。
- 会话组织操作采用最小 `operator.write` 权限；已删除无消费者的会话旁问、会话变更和会话文件入口。
- Cron 更新只在 Gateway 返回真实 `configRevision` 时传递 `expectedConfigRevision`，不生成客户端并发令牌。
- Provider 编辑页与会话模型选择器共用严格 `models.list` 投影，仅接受结构正确且 `available: true` 的当前运行时模型。
- 合并 `Blues-Code/dingtalk`：业务页收敛为钉钉单平台工作台，移除飞书、Google Workspace、旧 Chat bridge 和无引用目录。
- 新增 `junqi-dingtalk` OpenClaw 插件及受控 DWS 运行时投影。插件安装包随桌面资源分发，Tauri 在已验证 Runtime
  Identity 围栏内调用官方 `openclaw plugins install` 与 `enable`，并校验归档摘要、插件身份和加载状态。
- 钉钉工作台只读取当前 Session 的 `tools.effective` 并经 `tools.invoke` 调用；写操作保留确认、幂等键与待核验语义。
  DWS 缺失、授权未知、插件未加载和 Gateway 未提供工具时均如实呈现，不执行本地 fallback。

## 关键技术决策

- OpenClaw 是会话、Agent、工具、Transcript、任务和运行时状态的唯一权威；JunQi 仅保存绑定运行时身份的派生投影。
- DWS 不由 React 或 Tauri 直接执行。它只由已安装的 OpenClaw 钉钉插件调用，JunQi 通过官方工具协议观察和触发。
- 钉钉插件的 `allowedAgentIds` 为空时失败关闭；桌面不从页面、配置模板或历史记录猜测授权范围。
- `openclaw.setup.auth.start` 的 `authChoice` 必须来自 `openclaw.setup.detect`，不能由 Provider 模板或 profile 标识推导。
- Kun 的 Graph、Loop、调度与恢复属于 Kun 自有运行时语义；JunQi 只参考“前端投影真实宿主状态”的原则，不复制其能力或资源。

## 核心文件

- `src/pages/BusinessApplicationsPage.tsx`、`src/business-applications/dingtalkTools.ts`、
  `src/components/BusinessApplications/`：钉钉工作台的工具投影、调用与活动呈现。
- `packages/junqi-dingtalk/src/index.ts`、`dws-runner.ts`、`schema-contract.ts`：OpenClaw 插件、DWS 受控执行与契约校验。
- `scripts/build-dingtalk-plugin-bundle.mjs`、`src-tauri/resources/dingtalk/`、
  `src-tauri/src/commands/dingtalk_plugin.rs`：插件归档、摘要和 Runtime Identity 围栏安装。
- `src/services/gateway/modelCatalog.ts`、`src/pages/ConfigManager/providerGatewayCatalog.ts`、
  `src/pages/ConfigManager/ProvidersTab.tsx`：严格模型目录投影。
- `src/services/gateway/cronRuns.ts`、`src/services/gateway/OpenClawCronManagementClient.ts`、
  `src/pages/CronMonitor.tsx`：Cron 修订令牌传递与确认。
- `docs/adr/0002-openclaw-plugin-owned-dingtalk-business-runtime.md`、
  `docs/business/dingtalk-business-runtime-implementation-design-2026-08-08.md`、
  `specs/business/2026-08-08-dingtalk-business-runtime.md`：钉钉运行时依据、契约与实施顺序。

## 测试与验证

- 合并前模型目录修复已通过 3 项定向回归、`pnpm lint`、完整 `pnpm test`、`pnpm build`、
  `git diff --check` 与 Emoji 扫描。
- 合并后已通过 `pnpm lint`、完整 `pnpm test`、钉钉插件测试/校验/归档、`pnpm build`、
  Rust 格式检查和 Rust 库测试（697 通过，2 个 Keychain 测试按设计跳过）。
- 本机 macOS ARM64 已生成 `JunQi Desktop_2.2.11_aarch64.dmg` 和 updater 归档；DMG 的 `hdiutil verify`
  通过，包内钉钉插件归档与源码资源 SHA-256 一致。Tauri 因未配置发布私钥无法完成 updater 签名，
  所以该制品仅用于本地验收，不能作为正式发布包。
- 当前已核对 OpenClaw 官方源码提交 `3075acd549a5c76ad776cd8be5edff8ee6d47b55` 的模型、Wizard、会话和 Cron schema/handler。

## 已知问题

- 尚未在真实 Tauri 的 macOS、Windows、Ubuntu 或 CentOS 环境验收钉钉插件安装、Gateway 重启、DWS 授权、工具审批和业务响应。
- 当前开发机未使用真实 DWS 发布包与钉钉测试租户执行读写；源码与自动化不能替代这些验证。
- Windows Gateway 冷启动、新建会话首条消息和重启恢复仍需通过 Windows 安装包验收。
- 尚未在真实亮色、暗色和窄窗口中人工验收 Office、首次启动与钉钉工作台。

## 失败方案

- 不把 DWS 直接嵌入 Tauri、React 或本地终端，也不把 OpenClaw 钉钉聊天渠道等同于 DWS 业务授权。
- 不将模型目录、工具执行、插件加载或 DWS 授权用静态数据、本地 fallback 或超时推断伪装为成功。
- 不将 Provider 模板推导为 `openclaw.setup.auth.start` 的官方 `authChoice`。

## 下一步顺序

1. 在真实 Tauri 中验收钉钉插件安装、Gateway 重启、工具刷新、只读工具调用、写操作审批与错误恢复。
2. 在 Windows、macOS、Ubuntu 和 CentOS 分别验证安装、凭据、DWS 运行时与 Gateway 生命周期。
3. 配置正式发布私钥并完成签名、公证和 updater 验证前，不将本地验收包用于发布。
4. 继续按最新版 OpenClaw 官方协议审查剩余安装、模型、会话和任务投影；只修复具备官方依据和可复现证据的漂移。
