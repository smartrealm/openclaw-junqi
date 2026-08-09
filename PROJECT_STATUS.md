# 项目交接状态

更新时间：2026-08-09

## 当前目标

完成 JunQi Desktop 作为 OpenClaw 客户端的跨平台桌面交付：保持 Gateway、会话、模型、Cron 与首次启动链路的
官方契约；钉钉业务工作台通过受控 OpenClaw 插件呈现 DWS 的真实能力，不在桌面侧重定义 Agent、工具或业务状态。
钉钉单平台业务工作台 UI 已迁移到生产页面，当前目标是完成插件运行时与真实业务契约验收，并保持能力表格优先于本地筛选栏。实现采用独立 OpenClaw 钉钉插件包装 DWS，业务页与 Chat 共用
`tools.effective`、`tools.invoke` 和插件审批；Tauri 只在经过 Runtime Identity 围栏的本机或 Docker 运行时启动 DWS 官方安装和设备授权命令，业务调用仍只经 OpenClaw 插件工具。
正式 DWS 发布包、真实 Gateway 审批往返和测试租户端到端仍是下一步门禁。
智能体中心当前同步 Star Office 参照：默认入口呈现虚拟工位平面，网格仅作为智能体目录备用视图；工位状态仍只能来自 OpenClaw 协作 Run 证据。

## 本阶段已完成

- 已完成 `packages/junqi-dingtalk` 插件、30 工具 manifest、schema 校验、DWS runner、审批 hook、打包资源和 Tauri 安装命令。
- 已完成专属 Agent 的双层授权实现和 DWS 当前用户/授权投影；`allowedAgentIds` 空配置失败关闭，工作台自动读取运行状态并展示用户、组织、profile 状态和安全头像地址。
- 已完成紧凑 DWS readiness 状态条；按实际运行结果引导插件安装、Gateway 重启、Agent 授权、DWS 官方安装与设备授权、身份确认和重新检测，不伪造授权结果。
- 已完成钉钉业务活动的双层审计投影：优先展示当前 Gateway 跨 Session 的 OpenClaw metadata-only 钉钉工具账本，补充本窗口受控调用的 runtime、Session、Agent、Profile、审批和 DWS 关联元数据；无上游委派证据时不推断关系。
- 已完成 DWS 缺失安装交接弹层：按 Gateway 运行位置说明安装目标，提供官方 macOS/Linux、Windows、npm 入口、登录命令、复制、官方文档和重新检测；不执行远程脚本或读取 token。
- 已完成 DWS 安装与授权可视化：已验证 Native/Docker 运行时可执行官方 npm 安装和 `dws auth login --device`，桌面弹层实时展示限长且脱敏的 stdout/stderr，支持取消；结束后重新读取插件、Profile 和 Session 工具状态。
- 已完成钉钉业务插件未就绪时的“在 JunQi 安装”入口；DWS 安装与授权同样受当前 Gateway 身份验证和桌面变更权限约束，完成后必须重新读取当前 Session 工具。
- 已完成钉钉 Agent 未授权引导：工作台显示当前 Agent ID，并提供 OpenClaw Tools 策略与 `plugins.entries.junqi-dingtalk.config.allowedAgentIds` 两个配置入口；保存后必须回到工作台重新读取 `tools.effective`。
- 已完成插件安装阶段反馈与阻断原因投影：展示目标核对、等待 Gateway 安装与启用、结果和重启要求；外部或远程 Gateway、身份未核验、端点或路径不匹配均给出对应原因，不伪造 Gateway 进度。
- DWS runner 已收紧为最小环境白名单，不继承 Gateway token、DWS access token 或其他无关进程密钥。
- DWS 官方 CLI 操作输出仅通过 Tauri 事件短暂投影到当前窗口，不写入日志、持久化存储、transcript 或提交内容；取消状态由子进程终态核验后再展示。
- 环境白名单回归、插件重新打包和最新 `pnpm build` 已通过，桌面资源中的插件归档已核对包含该实现。
- 已完成业务页生产迁移：钉钉单平台、当前 Session 工具投影、左筛选/中表格/右详情三栏、拖拽和收起、参数 schema 展示、调用状态与脱敏活动投影。
- 已完成业务工作台空间收敛：左侧筛选默认收起为 40px 轨道，搜索、业务域与操作效果筛选移至能力表格顶部并可一键清除；删除重复的左侧租户身份输入，身份只保留在工具详情中作为一次调用参数。
- 已将智能体中心无 Run 时的配置席位从普通网格卡片改为协调席位和协作席位组成的虚拟工位平面；未允许参与仍只表示配置授权，不表示离线或失败。
- 已删除旧多平台目录、Chat bridge、静态 Journal 及其专属测试和无引用导出，不保留兼容双轨。
- 已通过 `pnpm test`、`pnpm lint`、`pnpm build`、`pnpm verify:openclaw-docs`、`pnpm check:boundaries`、Rust `cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`、插件测试/校验/打包和 `git diff --check`。

## 当前未验证

- 正式 DWS 发布包安装、真实钉钉租户权限和业务响应 envelope 尚未执行。
- 真实 Gateway 中插件加载、`tools.effective`、`tools.invoke`、`plugin.approval.*` 往返尚未执行。
- macOS、Windows、Linux、Docker Gateway 的安装、凭据库、重启和亮暗主题/键盘/窄窗口真机视觉验收尚未执行。
- Jarvis 已完成用户主动开启 Talk 的协议链路与自动化回归，但尚未完成真实 Gateway、实时语音提供方、麦克风扬声器及 Windows/Ubuntu/CentOS 真机端到端验收；当前不能宣称跨平台 24 小时后台唤醒闭环。
- 2026-08-08 只读探测当前 Gateway：Voice Wake 路由存在且指向已存在的 `jarvis` 智能体，但 `talk.catalog.realtime.ready` 为 `false`；实时 Talk 不能启动，外部提供方配置和真实音频设备验收仍是闭环前置条件。
- 2026-08-08 本机 PATH 未发现 `dws`，当前 OpenClaw `2026.7.1-2` 的插件列表没有 `junqi-dingtalk`；本轮只读确认，未改变本机 Gateway 或认证状态。
- 2026-08-08 业务闭环只读复核确认：当前 Gateway 仅加载原生 `dingtalk-connector` 和 `junqi-collab`，未加载 `junqi-dingtalk`；本机未发现 `dws` 可执行文件，未执行任何租户调用或改变 Gateway 配置。
- 本轮新增的 DWS 官方 CLI 可视化尚未在本机实际执行安装或授权，当前只完成编译、类型和边界验证；实际安装会改变选定运行时，需在验收环境明确发起。
- Jarvis 全链路审计确认：当前没有 Voice Wake 命中事件到桌面运行时的调用入口；设置页的 `voicewake.*` 只读写 Gateway 配置，不能证明 JunQi 已实现唤醒监听或 24 小时待命。
- 当前 Talk 手动链路覆盖全窗口遮罩、原生 PCM、官方中断和 Talk 工具中继；灵动岛在主窗口可见时按设计隐藏，主窗口最小化后才投影语音阶段。

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
- DWS 业务命令不由 React 或 Tauri 直接执行，只由已安装的 OpenClaw 钉钉插件调用；Tauri 仅负责在已验证 Native/Docker 运行时启动 DWS 官方安装与设备授权命令，并以回读状态作为业务门禁。
- 钉钉插件的 `allowedAgentIds` 为空时失败关闭；桌面不从页面、配置模板或历史记录猜测授权范围。
- `openclaw.setup.auth.start` 的 `authChoice` 必须来自 `openclaw.setup.detect`，不能由 Provider 模板或 profile 标识推导。
- Kun 的 Graph、Loop、调度与恢复属于 Kun 自有运行时语义；JunQi 只参考“前端投影真实宿主状态”的原则，不复制其能力或资源。

## 核心文件

- `src/pages/BusinessApplicationsPage.tsx`、`src/business-applications/dingtalkTools.ts`、
  `src/components/BusinessApplications/`：钉钉工作台的工具投影、调用与活动呈现。
- `src-tauri/src/commands/dws_operation.rs`、`src/api/tauri-commands.ts`：DWS 官方安装/设备授权进程、输出脱敏、取消和 Tauri 事件契约。
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
- 本次表格优先布局调整已通过 `pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check`。完整测试仍输出既有的 Radix SSR 与 Node 弃用警告，没有测试失败。
- 本机 macOS ARM64 已生成 `JunQi Desktop_2.2.11_aarch64.dmg` 和 updater 归档；DMG 的 `hdiutil verify`
  通过，包内钉钉插件归档与源码资源 SHA-256 一致。Tauri 因未配置发布私钥无法完成 updater 签名，
  所以该制品仅用于本地验收，不能作为正式发布包。
- 当前已核对 OpenClaw 官方源码提交 `3075acd549a5c76ad776cd8be5edff8ee6d47b55` 的模型、Wizard、会话和 Cron schema/handler。
- Jarvis Talk 目录状态已拆分为目录无效、实时提供方未就绪和原生 PCM 中继不兼容三类结构化失败原因，三语言界面均保持失败关闭。
- 本轮通过 `cargo fmt -- --check`、`cargo check --lib`、`pnpm lint` 和 TypeScript 类型检查；尚未执行真实 DWS 安装、授权、Gateway 重启或租户调用。
- 2026-08-09 全量审查追加通过 `pnpm lint`、前端测试（2838 通过）、脚本测试（243 通过）、`pnpm verify:openclaw-docs`、`git diff --check`、`cargo fmt -- --check`、`cargo check --lib` 和 Rust 库测试（698 通过、2 个按设计忽略）。测试输出仍有既有 Radix SSR `useLayoutEffect` 与 Node 弃用警告，但没有失败。
- 审查修正 Talk catalog 类型的可选兼容分支，并让 `realtime.ready=false` 显示为官方返回的不可用状态；刷新开始时清除旧的 Talk 状态，避免旧结果覆盖检查中语义。

## 已知问题

- 尚未在真实 Tauri 的 macOS、Windows、Ubuntu 或 CentOS 环境验收钉钉插件安装、Gateway 重启、DWS 授权、工具审批和业务响应。
- 当前开发机未使用真实 DWS 发布包与钉钉测试租户执行读写；源码与自动化不能替代这些验证。
- Windows Gateway 冷启动、新建会话首条消息和重启恢复仍需通过 Windows 安装包验收。
- 尚未在真实亮色、暗色和窄窗口中人工验收 Office、首次启动与钉钉工作台。
- 本次能力表格优先布局尚未在真实 Tauri 窗口人工核对亮色、暗色、窄窗口和键盘焦点；自动化已覆盖类型、边界和既有契约，但不替代视觉验收。
- Jarvis 不能宣称跨平台 24 小时语音唤醒：OpenClaw 官方当前只为 macOS、iOS、Android 客户端定义 Voice Wake 运行时，未提供 Windows、Ubuntu、CentOS 通用桌面唤醒事件契约。
- Voice Wake 路由中的 agent/session 目标尚未被 JunQi 的手动 Talk 消费；手动 Talk 始终使用当前活动 OpenClaw session。
- Jarvis 设置页已增加边界提示，明确 Gateway 唤醒词配置不会启动 JunQi 后台麦克风；该提示不改变 Gateway 配置或 Talk 协议。
- Jarvis 设置页已读取官方 `talk.catalog`，展示 realtime ready、当前提供方以及不可用/待核验状态；不以本地默认值推断语音可用。
- Jarvis 设置页已按相邻 TTS/Hook 面板统一标题、说明、刷新、状态、警告和窄窗口布局，未新增独立视觉体系。
- 当前审查未发现可由自动化复现的新增 P0/P1 缺陷；DWS 官方命令和 Docker 容器绑定仍需在真实选定运行时验证，不能由本机测试替代。

## 失败方案

- 不把 DWS 直接嵌入 Tauri、React 或本地终端，也不把 OpenClaw 钉钉聊天渠道等同于 DWS 业务授权。
- 不将模型目录、工具执行、插件加载或 DWS 授权用静态数据、本地 fallback 或超时推断伪装为成功。
- 不将 Provider 模板推导为 `openclaw.setup.auth.start` 的官方 `authChoice`。
- 不把 `talk.catalog.realtime.ready=false` 解释为客户端故障或自动切换到未声明的语音实现；真实 Talk 端到端必须等待官方 Gateway 提供方就绪。
- 不新增本地唤醒模型、后台采集 worker 或未定义 RPC；在官方桌面 Voice Wake 扩展点出现前，只完善手动 Talk 的真实状态呈现。

## 下一步顺序

1. 在真实 Tauri 中验收钉钉插件安装、Gateway 重启、工具刷新、只读工具调用、写操作审批与错误恢复。
2. 在 Windows、macOS、Ubuntu 和 CentOS 分别验证安装、凭据、DWS 运行时与 Gateway 生命周期。
3. 配置正式发布私钥并完成签名、公证和 updater 验证前，不将本地验收包用于发布。
4. 继续按最新版 OpenClaw 官方协议审查剩余安装、模型、会话和任务投影；只修复具备官方依据和可复现证据的漂移。
5. 按 `docs/quality/jarvis-full-chain-audit-2026-08-09.md` 的顺序完成真实 Talk 设备验收，并等待官方桌面 Voice Wake 扩展点后再实现唤醒适配；在此之前只保留真实的 Gateway 配置状态和手动 Talk 能力。
