# OpenClaw 功能清单与 JunQi 代码对照审计

日期：2026-08-07

## 结论

`docs/openclaw-features.md` 适合作为历史功能线索，不适合作为 JunQi 的当前能力契约。JunQi 已经覆盖
Gateway 连接身份、配置 CAS、动态命令、运行时渠道、Gateway Skills、工具、浏览器、Task Ledger、审批和审计等
主链路；不需要按文档中的数量重新补齐静态命令、渠道或工具清单。

本轮已完成三项 P0 的第一阶段实现：能力证据已进入 `Connection`，欢迎页不再从本地 Skill Hub 读取技能，Cron
列表、详情和运行记录已共用严格解析器。插件目录、Nodes/Canvas 和聚合安全姿态仍保持未接入，后续继续按官方协议增量接入。

## 证据范围

- 本地线索：`docs/openclaw-features.md`。该文件已标明是本地 OpenClaw 源码快照，不是最新版官方契约。
- 官方协议：
  - Gateway WebSocket、握手、方法发现、节点和插件 RPC：<https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md>
  - Automations：<https://github.com/openclaw/openclaw/blob/main/docs/automation/cron-jobs.md>
  - Plugins：<https://github.com/openclaw/openclaw/blob/main/docs/tools/plugin.md>
  - Security：<https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md>
- 本机 OpenClaw 主线源码用于复现 schema、handler 和当前运行结果，不作为 JunQi 的版本门禁。

## 对照矩阵

| 功能线 | JunQi 当前实现 | 结论 | 优化方向 |
| --- | --- | --- | --- |
| Gateway 与配置 | `Connection` 严格校验 `hello-ok`、角色、scope、运行时身份和连接围栏；`ConfigManager` 使用 `config.get` 的 `exists`、`valid`、`config`、`hash`，写入携带原始 `baseHash`。 | 已对齐，属于当前强项。 | 把已观测的 methods、events、scope 和结构化错误集中为能力证据，不让各页面各自推断。 |
| CLI 与 Slash 命令 | `OpenClawCommandsClient` 调用官方 `commands.list`，按当前 Agent、scope 和参数动态读取；页面没有静态 67 条命令表。 | 已按正确方向实现。 | 保持动态目录，不根据文档数量新增静态命令或本地别名。 |
| 渠道 | `openclawChannelRuntime` 从选定 runtime 读取官方 catalog、capabilities、status、logs；安装能力只开放经过审查的插件，安装后再次读取官方 catalog。 | 已对齐，数量不是契约。 | 后续只在官方 RPC 或 CLI 证据明确时增加 resolve、死信或重试视图。 |
| Tools、Models、Browser | 工具目录、effective tools、invoke、模型目录与探测、Browser Control 均走 Gateway；浏览器请求有路径和 URL 校验，不使用本地 WebView 伪 fallback。 | 已覆盖主要能力。 | 继续保持 Gateway 权威，显示 scope、审批和未知状态。 |
| Gateway Skills | `openclawSkillsRuntime` 使用 `skills.status/search/detail/securityVerdicts/skillCard/install` 及 curator、proposal 读取；页面有安全 verdict 和连接状态。 | Gateway Skills 已覆盖。 | 订阅或按官方事件刷新 `skills.changed`；不要把本地目录扫描结果混入 Gateway Skills。 |
| 本地 Skill Hub | `/skill-hub`、`skillHubRuntime` 和 Rust `commands/skills.rs` 扫描任意目录的 `SKILL.md`，并把链接写入项目的 `.claude/skills` 或 `.codex/skills`；欢迎页已改用 `useSkillsStore` 读取 Gateway `skills.status`。 | 本地能力与 OpenClaw Gateway Skills 已明确分离；本地页不再冒充 Gateway 目录或权限来源。 | 保留为明确的本地开发 Skill 链接管理；后续若收紧产品范围，必须连同路由、Tauri command、测试和持久化引用一起评估。 |
| Plugins | 当前有插件审批、故障恢复和渠道插件安装，但没有通用插件目录页。当前 OpenClaw 主线已提供 `plugins.list/search/install/setEnabled/uninstall`，并要求区分 read/admin scope 与重启结果。 | 文档所说的插件系统有官方依据，但 JunQi 还没有完整的运行时投影。 | P1 增加只读插件目录；再按官方返回的 `mutationAllowed`、`restartRequired`、诊断和 trust warning 开放最小写操作，不走任意 npm spec。 |
| Automations | `CronMonitor` 通过 `cron.list/status/get/add/update/remove/run/runs` 工作；`cronRuns.ts` 现在是 `cron.list`、`cron.get` 和 `cron.runs` 的唯一读取解析入口，覆盖 `at/every/cron/on-exit/stream`、pacing、delivery、failureAlert、command/script/heartbeat、运行状态、auto-disable/stream 状态和 usage。 | 主链路和读取契约已收敛；创建编辑器仍有意只开放已确认的 agentTurn 最小写操作。 | 继续补齐官方 diagnostics、model/fallbacks/tools policy 的安全只读投影；写操作保持最小 patch、回读和待核验，不能因页面需要而扩展本地 scheduler。 |
| Tasks、Hooks | Task Ledger 已有 `tasks.list/get/cancel/retry/dismiss` 的严格客户端和状态投影；Hooks 有状态读取。 | 已有可用基础。 | 不把 Task Ledger 扩展成 JunQi 自己的 scheduler、依赖图或完成条件；所有图形只做 Gateway 事件的派生视图。 |
| Nodes、Canvas、Camera、Screen | 全局搜索未发现 JunQi 的 `node.list/describe/invoke`、Canvas 或节点命令适配；现有 `node_runtime` 是 Node.js 运行时安装器，不是 OpenClaw node。 | 文档能力在 JunQi 中尚未落地，不能用本地 WebView 或本地命令伪造。 | P1 先做节点只读清单和 paired/connected/offline/unknown 状态，再按 `caps`、`commands`、`permissions`、pairing approval 接入 `node.invoke`；Canvas 只使用官方 plugin surface URL 和 `canvas.*`，不把 URL 打开当作成功。 |
| Security、Approvals、Audit | 有 Gateway approvals、approval history、audit ledger、runtime identity 和工具策略；但没有一个聚合的 Gateway security posture。 | 基础能力已有，安全事实分散。 | P1 增加只读安全姿态卡，展示 runtime identity、endpoint、auth mode、negotiated scopes、pairing、sandbox、tool policy、plugin/skill/browser/node audit facts；Gateway 健康不能替代安全结论。 |
| Telemetry | 当前主要是 `usage.cost`、`sessions.usage` 等 Gateway usage；未证实文档所称通用匿名使用、错误和性能遥测是 OpenClaw 必备能力。 | 文档表述超出已证实契约。 | 不新增通用遥测、埋点或退出开关；可选 OpenTelemetry/Prometheus 插件只能显示为未配置、已配置或未知。 |

## 实施顺序

### P0：先收敛边界和事实来源

1. [已完成] 为 Gateway 增加集中能力证据投影，来源只包括 `hello-ok` 的 methods/events、协商 role/scope、运行时身份、
   最近一次结构化 RPC 结果和当前连接围栏。`hello-ok.features.methods` 是保守发现，不得因为列表没有某方法
   就直接判定不可用；应在认证完成后调用官方方法，并按结构化错误区分未知、未授权、连接失效、返回无效和待核验。
2. [已完成] 处理 `/skill-hub` 的边界：保留真实本地目录链接能力，但入口和欢迎页明确区分 Gateway Skills，避免第二套
   安装和统计来源。
3. [已完成] 把 Cron 契约收敛为唯一类型和解析入口，删除 `gatewayDataStore`、`CronMonitor` 的 Cron `any` 及重复运行记录
   解析；写操作保持最小 patch，成功后重新读取 Gateway 记录，轮询超时保留待核验。

## 本轮实现与验证

- `GatewayCapabilityRegistry` 记录 hello 的保守发现和最近一次 RPC 证据；能力快照只保留 method、状态、连接身份、时间、错误码和缺失 scope，不保留原始错误详情。
- `WelcomePage` 通过 `useSkillsStore` 读取当前 Gateway 的 `skills.status` 投影；`SkillHubManager` 的本地目录和项目链接能力保留为独立 JunQi 增强，并在页面内联显示边界。
- `cronRuns.ts` 作为唯一 Cron 读取解析入口；`OpenClawCronRunClient` 不再维护第二套 run parser，并使用官方 `cron.runs` 分页 envelope 和 `scope: job` 参数。
- 运行等待超过展示上限时，页面写入“待核验”状态并禁止再次运行；未把超时转换为 Gateway 失败，也未自动重放未知副作用。
- 已执行：`pnpm exec tsc --noEmit`、Gateway 能力/连接安全、Cron contract/parser/run/store、Skill Hub 边界和 Welcome 结构回归测试、`pnpm lint`、完整 `pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check`。
- 未执行：本轮桌面 `.app` 重建、亮暗主题与窄窗口真机验收、Windows/macOS/Linux 目标平台验证、插件冷重启和 Nodes/Canvas 实机验证。

### P1：补齐官方已有但 JunQi 缺失的控制面

1. 插件目录和安全信息：先只读 `plugins.list`，确认当前 Gateway 的 catalog、diagnostics 和 mutationAllowed；
   写操作必须显示 admin scope、风险确认、重启要求和回读结果。
2. Nodes 页面：先做 `node.list/node.describe/system-presence` 的只读投影，记录 pairing 和 capability claims；
   `node.invoke` 仅允许 Gateway 返回的命令，并保留审批和结果待核验语义。
3. Canvas 页面：只有已配对节点声明 Canvas 且 Gateway 提供当前 scoped surface URL 时才展示操作；present、navigate、
   eval、snapshot 的每一步都以官方结果为准。
4. 安全姿态卡：复用现有 approvals、audit、runtime identity 和工具策略组件，不新增未经官方证明的 security RPC。

### P2：低优先级和明确不做

- 不按“67 个命令、40+ 渠道、67 个工具、59 个插件”补静态页面。
- 不实现 JunQi 自有 scheduler、Standing orders、Task Flow 或跨模型任务完成语义。
- 不把本地 Skill Hub、浏览器 WebView、Node.js runtime 或 Tauri 通知包装成 OpenClaw node/canvas 能力。
- 不基于文档中的匿名遥测描述新增网络上报。

## 验收门槛

- 亮色、暗色、窄窗口和键盘焦点下，所有新增状态至少区分 disconnected、loading、unsupported、unauthorized、
  invalid response、pending verification、success 和 error。
- 每个 OpenClaw 写操作都记录 selected runtime、connection identity、session/job/node identity、revision 或 runId，
  并在成功回执后重新读取官方状态；超时和断线保留未知，不自动重放。
- 至少执行相关 TypeScript 测试、`pnpm lint`、`pnpm build`、`git diff --check`；节点、Canvas、插件冷重启、
  Windows 凭据库和 macOS 真机视觉仍需单独记录是否验证。
