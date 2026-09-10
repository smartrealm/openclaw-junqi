# 钉钉 DWS 工作流扩展计划

## 实施顺序

1. 已为写后核验增加回归测试，覆盖 DWS 统一信封、稳定 ID、官方 Shortcut 证明、审批同一对象读回、失败和禁止重放。
2. 已在 `junqi-dingtalk` 内实现统一写后核验协调器，复用现有 DWS runner、schema registry 和固定工具规格。
3. 已扩展工具输出与桌面活动状态，区分 `verified`、`succeeded_unverified` 和 `unknown`。
4. 已升级钉钉插件源码版本，并在完整验证后重建固定归档和两份生成元数据。
5. 已接入日常助理、会议、听记、文档知识、日报、邮件和消息的只读底座，以及经 DWS 核验的日程、待办和审批同意写入口。
6. 已增加 81 个业务工具的目标 DWS 全量契约审计入口，核验 `availability=available` 与既有路径、安全契约，失败时返回逐工具结构化错误。
7. 已实现实时事件长进程生命周期、精确 Profile、正式 ready、Schema 准入、NDJSON、有界缓冲、稳定 ID 去重、健康失败和 stdin 优雅退出，不与一次性工具混装。
8. 已为 AI 表格、合同、招聘和目标管理接入 17 个最小只读工具；DWS 官方主线标记为不可用的 4 个 HRbrain Shortcut 已从注册面移除，所有高敏写入保持关闭。
9. 已为事件配置增加钉钉接入工作区专用表单，使用正式配置哈希、精确数组替换、写后重读、运行目标围栏和统一 Gateway 重启。
10. 已增加插件工作流 Skill 与正式听记搜索工具，约束每日助理、会议创建、指定听记选择、听记转待办和草稿链路只使用固定工具，并守住唯一目标、精确 Profile、部分成功和禁止未知写重放。
11. 已增加显式目标 DWS 路径、Profile 和范围驱动的只读预检。`core` 运行每日助理核心五项读取；`extended` 在此基础上增加听记、知识库、日报周报、邮件、消息、招聘和目标管理七项读取。两档都丢弃业务 payload，并保持核心写入门禁不依赖扩展域权限。
12. 已补齐日报周报的模板搜索、模板字段、日志详情和提交工具；提交前由 Skill 要求人工核对完整草稿和接收人，提交后按返回 reportId 独立读取同一日志详情。由于正式详情契约不能证明全部字段和接收人，当前只进入 `succeeded_unverified`。
13. 已接入当前用户聊天窄发送、异步状态查询和按消息 ID 精确读取。调用前只允许稳定单目标、文本和必填幂等键，OpenClaw 审批展示完整草稿；异步未完成或读回不一致保持 `unknown`，精确 ID 读回保持 `succeeded_unverified`，不自动重发。
14. 已把聊天精确读取升级为 DWS 官方 `chat +messages-mget` 完整性投影，并严格核对消息集合完整性、计数、失败清单、精确消息 ID 和群会话 ID；同时修复所有 DWS 字符串列表参数被错误编码成 JSON 文本的问题。
15. 已接入 DWS 官方 `calendar +cancel-event`，并把 `destructive` 纳入与 `write` 相同的副作用未知结果、审批和核验边界，补齐会议创建、变更与取消生命周期。
16. 已补齐更新、完成、重开和取消类 Shortcut 的请求 ID 与回执 ID 围栏，并增加受控日程创建、更新、取消，以及自分配待办创建、更新、完成、重开、再次完成的验收入口；未知结果立即停止，不自动重试或继续写入。
17. 已增加审批模板只读预检入口。它在业务调用前核验表单 Schema、流程预测、发起、详情和撤销五个契约，只执行表单与预测两项读取，并明确要求后续人工检查自选审批节点；当前不提供无法安全清理的通用审批写入验收。
18. 已增加日报模板只读预检入口。它在业务调用前核验模板搜索、模板定义、提交和详情四个契约，校验内容五字段与接收人，要求唯一精确模板并读取定义；当前不提供无法安全清理的自动日报提交验收。
19. 已把 DWS `availability` 纳入所有业务工具与事件消费的准入和摘要契约；官方主线审计发现 4 个 HRbrain Shortcut 为 `unavailable` 后，已从插件与桌面域列表移除。
20. 每阶段先执行定向测试，再执行插件校验、前端测试、lint、生产构建和差异检查。
21. 已以 DWS 官方主线叶子 Schema 确认扩展只读预检的七个新增工具均为可用、低风险、无需确认、幂等且无必填业务参数。
22. 已增加 AI 表格、合同、招聘和目标管理 17 项高敏只读预检。入口要求固定确认串、精确 Profile 和完整受控 fixture，在任何业务读取前核验全部 Schema 与全部参数，限制分页和精确对象范围，合同分析请求经有界 stdin 传输，并丢弃所有业务 payload。
23. 已为 DWS runner 增加最多 1 MiB 的可选 stdin 输入边界，使正式支持 `--file -` 的合同分析请求不进入进程参数；无效类型和超限输入均在解析 DWS 路径前失败关闭。
24. 使用目标 Gateway、目标 DWS 与测试租户执行真实读写和事件消费；没有目标证据的项目保留为未验证。
25. 已增加全部 13 个注册副作用工具的显式核验策略注册表和执行前门禁；未来新增写入或破坏性工具如果没有同步核验策略，会在目标 Schema 读取和 DWS 启动前失败关闭。
26. 已增加全部 13 个副作用工具的显式审批摘要策略。OpenClaw 审批前先核验精确 Profile、当前叶子 Schema、参数类型和两类策略，摘要展示目标、实质改动与完整参数 SHA-256，并按正式长度边界隐藏高敏正文；日报正文改走有界标准输入，任意文件路径不进入插件写入面。
27. 已修正插件服务的 Gateway 事件命名：插件只发送正式局部名 `events_changed`，由 OpenClaw 生成线上的 `plugin.junqi-dingtalk.events_changed`。桌面端新增严格失效通知桥，按已核验 Gateway 连接隔离最近序号和事件类型，并在事件设置页明确显示为“有新事件可读”而不是业务完成状态。
28. 已依据 DWS 扁平事件正式 Schema 收紧 consumer 输出：只有非空且属于当前订阅的 `type` 才能进入缓存和通知。新增目标租户事件验收入口，显式确认后验证 consume Schema、ready、真实事件、序号与类型一致的局部通知和干净停机；无事件、协议不一致或停机未知均不通过。
29. 已按 OpenClaw 插件事件正式建议增加 `operator.read` 的 `junqi.dingtalk.events.snapshot` Gateway 方法。桌面进入事件页或收到新 revision 后通过当前连接围栏自动重读闭合的无业务载荷投影，并提供就地失败和手动重试；不再要求操作员用 `tools.invoke` 才能确认事件缓存可读。
30. 已把事件快照请求从页面内数字计数提升为可测试的连接与配置协调器。配置读取绑定来源 connectionId，快照发布前核对已保存 Profile、订阅组数量、EventKey 集合、请求游标和通知最低 revision；插件 RPC 显式声明 `profileAccess: required`，旧连接、旧配置和迟到结果全部失败关闭。
31. 已为每个事件服务实例增加运行代际 UUID，并对 Profile、缓冲区、每组 EventKey、成员或群目标和待办角色的完整规范化配置计算 SHA-256。通知、操作员快照和桌面本地重算结果必须一致；同一代际重复或倒退 revision、摘要漂移、旧代际和迟到请求均失败关闭，新代际才允许从 revision 1 重新开始。
32. 已增加固定钉钉归档的隔离真实 Gateway 基线验收脚本。它复用只读根文件系统、独立状态卷、安装期专用网络、运行期无出口内网、非默认端口、环境变量令牌和所有权围栏，且不读取宿主 OpenClaw 配置、不注入 DWS 路径、Profile 或事件订阅。脚本要求真实安装归档、校验配置、检查插件、调用关闭态快照 RPC、确认没有 DWS 子进程，并验证 Gateway 重启后运行代际变化。当前机器的真实执行在 Docker 预检因守护进程不可连接而停止，未进入插件安装，因此动态基线仍未通过。
33. 已把关闭态 RPC 从普通管理 CLI 调用收紧为显式 scope 探针。探针通过固定 OpenClaw `2026.8.1` 正式导出的 `callGatewayFromCli` 发起只读共享状态调用；仅 `operator.read` 必须成功，仅 `operator.write` 必须收到结构化 `FORBIDDEN`、`MISSING_SCOPE` 和精确 `operator.read` 缺权字段，否则验收失败。9 项脚本测试覆盖 scope 正反例、容器参数、令牌不进入宿主子进程环境、编排、失败脱敏和清理；认证 Profile 门禁仍保留为独立目标环境验收。
34. 已为 P0-B 增加目标 DWS 全量契约维护入口 `dingtalk:verify-target-contracts`。它只接受一个显式绝对 DWS 路径，以固定并发 4 复用插件同一 Schema registry、81 工具规格和审计器，输出仅含计数、工具名、canonical path 与稳定脱敏错误；缺参、相对路径、Profile 或其他额外参数在解析 DWS 前失败关闭。
35. 已把 P0-D 日程和待办写入验收从文档约定收紧为代码门禁。两个编排都先完成全部写契约与参数预校验，再以同一 DWS runner 和同一精确 Profile 内嵌执行 `core` 五项只读预检；任一读取失败时返回完整脱敏矩阵并保持零副作用，只有五项全通过才进入创建。
36. 已增加共享 DWS 成功信封判据，并用于目标普通只读、高敏只读、审批表单与流程预测、日报模板定义。即使目标进程以零退出返回，只要缺少 `ok=true`、`outcome=success` 或 `data`，也会以稳定 `DWS_RESULT_INVALID` 失败关闭；失败、等待和畸形信封不会计为权限或业务读取通过。
37. 已把同一成功信封判据下沉到 OpenClaw 实际业务只读工具执行路径。普通只读命令只有取得完整成功信封才返回成功；零退出的等待、失败或畸形结果直接以稳定错误结束工具调用，不再被外层包装成 `success=true`。长驻事件消费继续使用正式 ready 与扁平 NDJSON 契约，不套用一次性 JSON 信封。
38. 已把 DWS 参数准入从基础类型扩展为完整叶子契约校验。Schema registry 改读完整叶子并只保留调用所需字段；枚举、`date`、`date-time`、`json`、`cli_required`、`anyOf` 格式分支、数值与对象类型，以及 `mutually_exclusive`、`require_one_of`、`require_together` 均在审批和 DWS 启动前验证。隐藏兼容参数按 DWS 正式投影规则过滤，接口数组的 CSV 枚举逐成员校验；自然语言 `required_when` 只保留证据，不做猜测性解释。
39. 已接入 DWS 正式 `minutes +transcript` 完整逐字稿 Shortcut。插件只允许显式稳定 taskUuid，拒绝自动选择最新、关键词选择、续页游标和单页模式；成功结果还必须证明同一 taskUuid、`complete=true`、有效页数、段落计数和对象段落列表，才可进入听记转待办或周报草稿。
40. 已增加目标租户听记只读验收入口。它要求固定确认串，并从标准输入接收受控 query 与稳定 taskUuid；任何业务读取前先核验搜索、详情、逐字稿和行动项四个叶子 Schema 与全部参数，再按同一 ID 串行执行。搜索必须唯一且完整，详情与逐字稿必须证明同一任务及完整性，行动项必须返回正式显式数组；输出只保留阶段和计数。
41. 已增加确定性隔离 Gateway 插件调用链验收。它先创建无 Agent run 的隔离 Session，以 `tools.effective` 核对当前用户工具的最终投影，再以 `tools.invoke` 经插件 Schema registry 和统一 runner 启动只接受两条精确命令的只读测试执行器。只读挂载、插件归属、Schema 摘要、结果信封、详情一致性、进程退出和证据脱敏都纳入失败关闭；该结果不替代正式 DWS 与租户验收。
42. 已为 P0-B 增加目标 Gateway 当前用户读取入口 `dingtalk:gateway:target-read`。它从显式 OpenClaw 包根解析官方 Gateway 客户端，令牌只走环境变量，Session、Agent 和 Profile 只走闭合标准输入；先用 `operator.read` 证明 Session 工具投影，再用 `operator.write` 调用当前用户工具，并只输出不含令牌、Session、Profile 与业务 payload 的结构性证据。
43. 已增加目标 Gateway 核心五项与扩展十二项只读权限矩阵 `dingtalk:gateway:target-readonly`。它一次性证明范围内全部工具的 Session 投影，再按固定顺序串行通过 `tools.invoke` 读取；投影缺失时零调用，单项读取失败时继续完成权限矩阵，证据只保留工具、canonical path、Schema 摘要和稳定错误码。
44. 已修复合同分析在 OpenClaw 插件调用边界无法安全传递正文的问题。工具只接受字段闭合、可序列化且不超过 1 MiB 的内联 JSON 对象，插件规范化后经 DWS 正式 `--file -` 标准输入执行；同时新增固定 17 项高敏只读目标 Gateway 矩阵，在任何业务读取前核对内部 Schema 工具与全部业务工具投影、逐项读取 Schema 并预校验全部参数，失败时保持零业务读取。
45. 已为 P0-D 增加目标 Gateway 日历创建、更新和取消验收。入口先核对内部 Schema、核心五项读取和三个日历写入的最终工具投影，再完成全部 Schema 与参数预检；三个不带 `confirm` 的调用必须只报告审批边界，核心五项全部执行后才允许三个带 `confirm=true` 的独立审批写入。每步要求同一 eventId、统一成功信封和 `verified` 读回，拒绝与未知结果立即停止且不自动重放，证据只保留必要恢复标识或最终删除 ID 的摘要。
46. 已为 P0-D 增加目标 Gateway 待办创建、更新、首次完成、重开和最终完成验收。入口先核对内部 Schema、核心五项读取和四个待办写入的最终工具投影，再完成全部 Schema 与参数预检；四个不带 `confirm` 的调用必须只报告审批边界，核心五项全部执行后才允许五个带 `confirm=true` 的独立审批写入。每步要求同一 taskId、统一成功信封和 `verified` 读回，拒绝、未知结果与资源 ID 漂移立即停止且不自动重放，完整成功只保留 ID 摘要。

## 第一阶段文件范围

- `packages/junqi-dingtalk/src/types.ts`
- `packages/junqi-dingtalk/src/read-result.ts`
- `packages/junqi-dingtalk/src/tool-specs.ts`
- `packages/junqi-dingtalk/src/write-reconciliation.ts`
- `packages/junqi-dingtalk/src/invocation-policy.ts`
- `packages/junqi-dingtalk/src/contract-audit.ts`
- `packages/junqi-dingtalk/src/event-runtime.ts`
- `packages/junqi-dingtalk/src/event-rpc.ts`
- `packages/junqi-dingtalk/src/index.ts`
- `packages/junqi-dingtalk/src/target-readonly-smoke.ts`
- `packages/junqi-dingtalk/src/target-calendar-smoke.ts`
- `packages/junqi-dingtalk/src/target-event-smoke.ts`
- `packages/junqi-dingtalk/src/target-todo-smoke.ts`
- `packages/junqi-dingtalk/src/target-approval-preflight.ts`
- `packages/junqi-dingtalk/src/target-report-preflight.ts`
- `packages/junqi-dingtalk/src/target-sensitive-readonly-preflight.ts`
- `packages/junqi-dingtalk/src/target-minutes-preflight.ts`
- `scripts/verify-dingtalk-target-gateway-calendar.mjs`
- `packages/junqi-dingtalk/skills/junqi-dingtalk-workflows/SKILL.md`
- `src/business-applications/activityStore.ts`
- `src/business-applications/dingtalkTools.ts`
- `src/services/gateway/dingTalkEventBridge.ts`
- `src/services/gateway/OpenClawDingTalkEventClient.ts`
- `src/pages/BusinessApplicationsPage.tsx`
- `src/components/BusinessApplications/`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `src/locales/en.json`
- 对应测试、插件清单、固定包元数据和当前文档

## 第一阶段验证

- 钉钉插件定向与完整测试。
- 活动状态、证据解析、摘要和展示定向测试。
- `pnpm dingtalk:validate`。
- `pnpm lint`、`pnpm test`、`pnpm build`。
- `git diff --check`。
- 修改文件完整 Emoji 扫描。
- 目标租户真实写入与写后读取单独记录；没有执行时不得描述为已验证。

## 当前剩余顺序

1. P0-A：在 Docker 守护进程可用的受控测试机依次运行 `corepack pnpm dingtalk:gateway:smoke` 与 `corepack pnpm dingtalk:gateway:chain-smoke`。前者完成固定 `0.27.0` 归档安装、配置校验、插件检查、关闭态 scope 和重启代际验收；后者完成 Session、实际工具投影、`tools.invoke`、插件、Schema、DWS 子进程和结果投影链路。两项都不证明认证 Profile、正式 DWS、租户权限或线上事件。
2. P0-B：先对目标 DWS 绝对路径运行 `corepack pnpm dingtalk:verify-target-contracts -- --dws-path <absolute-path>`；然后设置仅进入环境的 `OPENCLAW_GATEWAY_TOKEN`，把 `agentId`、`sessionKey` 和 Profile 作为闭合 JSON 标准输入传给 `corepack pnpm dingtalk:gateway:target-read -- --gateway-url <ws-or-wss-root> --openclaw-package <absolute-openclaw-package-json> --acknowledge-target-read JUNQI_DINGTALK_TARGET_GATEWAY_CURRENT_USER_READ`，完成正式 DWS 与受控租户的最小 Gateway 当前用户读取。通过后对同一连接先后运行 `dingtalk:gateway:target-readonly` 的 `core` 和 `extended` 范围，确认串为 `JUNQI_DINGTALK_TARGET_GATEWAY_READONLY_MATRIX`；最后在真实带身份同步的客户端核对 `profileAccess: required` 门禁，纯令牌 CLI 结果不得冒充该证明。
3. P0-C：先使用受控 Profile 和真实 fixture 执行 DWS 直连 17 项高敏只读预检，再通过同一 Agent、Session、Profile 和 fixture 执行 `dingtalk:gateway:target-sensitive-readonly`，逐域核对 AI 表格、合同、招聘和目标管理的 Gateway 投影、Schema、参数、权限、对象存在性、敏感字段和最小数据范围；最后用带身份同步的真实客户端单独验收 Profile 门禁。持续跟踪 HRbrain 上游可用性，但不可用期间不接入。
4. P0-D：先使用已内嵌同 Profile 核心只读门禁的 DWS 直连接口执行受控日程创建、同 ID 更新和同 ID 取消；通过后在同一目标通过 `dingtalk:gateway:target-calendar` 验证最终工具投影、报告式审批边界、三个独立所有人审批、同 ID 读回和禁止未知写重放。随后先运行待办 DWS 直连验收，再通过 `dingtalk:gateway:target-todo` 对同一自分配待办执行创建、同 ID 更新、首次完成、重开和最终完成，核对四个报告式审批边界、五个独立所有人审批和禁止未知写重放；成功后目标租户会保留一条已完成的合成待办记录。
5. P0-E：使用审批只读预检核对目标模板字段和流程预测，并使用日报模板预检唯一定位模板、读取字段定义和校验计划内容与接收人；由人工分别确认模板、审批人、接收人和留痕方案后，再按审批、日报周报和当前用户文本消息顺序执行真实写入、读回和人工确认。
6. P0-F：先用显式确认的目标事件验收入口验证单一最小事件的 Schema、ready、类型约束、事件到达、局部通知和干净停机，再通过专用表单验证真实 Gateway 前缀广播、`operator.read` scope、认证 Profile 门禁、桌面连接绑定、快照重读、去重、Gateway 重启、断线和退出退订。
7. P1：先用受控 query 与稳定 taskUuid 执行同任务听记四阶段验收，再以真实 OpenClaw 会话验证每日助理、会议闭环、听记转待办和草稿链路的部分成功语义。
8. P1：完成亮色、暗色、窄窗口、键盘焦点、加载、失败和空配置的真实 Tauri 窗口验收。
9. P2：只有获得正式确认、幂等和写后核验依据后，才评估聊天 Bot、Webhook、批量、富媒体、邮件和高敏域写入。
