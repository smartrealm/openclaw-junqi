# 钉钉 DWS 工作流扩展审计

## 当前结论

JunQi 当前通过 OpenClaw 插件 `junqi-dingtalk` 暴露固定白名单中的钉钉业务工具，调用链为：

`OpenClaw Session -> tools.effective -> tools.invoke -> junqi-dingtalk -> DWS -> 钉钉`

该边界继续有效。JunQi 不直接执行任意 DWS 命令，也不在桌面端复制 Agent、审批、任务或事件语义。

本轮已把固定白名单扩展为 15 个业务域、81 个业务工具，并完成写入可靠性、每日助理、会议创建变更与取消、实时事件、高敏域只读底座、日报周报安全提交和当前用户聊天窄发送入口。当前 13 个写入或破坏性工具全部进入显式核验与审批摘要策略注册表；OpenClaw 审批前先核验精确 Profile、完整目标 Schema、全部参数语义和两类策略，枚举、已知格式、接口数组、CLI 必填与三类跨参数约束都会在展示审批和启动 DWS 前失败关闭。审批摘要展示目标、实质改动及完整参数 SHA-256，超长或高敏正文不复制到通知。未来新增但未同步策略的副作用工具会失败关闭。日程创建、更新和取消、待办创建、更新、完成和重开、按关键词同意审批均使用 DWS 官方自带权威读回的 Shortcut；日报提交、聊天发送、发起审批、拒绝和撤销使用正式原子命令。聊天发送只允许稳定群 ID 或 openDingTalkId、文本和必填幂等键，异步任务先查询状态再按真实消息 ID 精确读回。日报和聊天因正式读取契约不能证明全部提交内容和接收人，拒绝和撤销因不能证明动作终态，均保留“写响应成功但终态未完全证明”。桌面活动记录已经区分 `verified`、`succeeded_unverified` 和 `unknown`。DWS 官方主线把本轮审阅的 4 个 HRbrain Shortcut 全部声明为 `availability=unavailable`，因此插件和桌面域列表不再暴露 HR 能力。

插件另有 4 个内部工具：运行状态、单工具 Schema、全量契约审计和事件快照。全量契约审计会以有界并发逐项读取目标 DWS 的 81 个叶子 Schema，要求每项明确为 `availability=available`，并返回完整失败清单。事件快照只读取当前 Gateway 生命周期内的有界内存，不把事件正文写入 JunQi 持久化。

仓库维护面新增 `corepack pnpm dingtalk:verify-target-contracts -- --dws-path <absolute-path>`，可在进入目标租户读取前直接对指定 DWS 二进制执行同一套 81 工具审计。该入口不读取宿主配置或 PATH，不接受 Profile 和可调并发，只输出计数、工具名、canonical path 与稳定脱敏错误；它证明目标二进制契约兼容，不证明租户登录或业务权限。

固定归档验收现在分为两层。`dingtalk:gateway:smoke` 保持无 DWS 的关闭态基线；`dingtalk:gateway:chain-smoke` 在同一隔离 Gateway 中只读挂载一个仓库测试执行器，先通过正式 `sessions.create` 建立无 Agent run 的测试 Session，再以 `tools.effective` 核对该 Session 实际投影的钉钉工具，最后以 `tools.invoke` 调用“当前用户”。测试执行器只接受精确 Schema 和精确业务读取两条命令，其他参数失败；验收同时检查插件归属、Schema 摘要、统一成功信封、结果闭合和子进程退出。证据不保留 Profile 与业务 payload。这一层证明 Gateway、最终工具策略、插件、DWS runner 和结果信封的进程链路，不证明正式 DWS 二进制、钉钉认证或租户权限。

P0-B 现已补充目标 Gateway 当前用户读取入口 `dingtalk:gateway:target-read`。该入口不复制 OpenClaw WebSocket 协议，而是从用户显式提供的 OpenClaw `package.json` 解析正式 `openclaw/plugin-sdk/gateway-runtime` 导出；Gateway 地址拒绝 URL 凭据、查询参数和非根路径，令牌只从环境变量读取，Session、Agent 和 Profile 只从闭合标准输入读取。它先以 `operator.read` 核对目标 Session 的最终工具投影，再以 `operator.write` 调用唯一的 `junqi_dingtalk_contact_me`，并验证插件归属、DWS canonical path、Schema 摘要、统一成功信封和文本详情一致性。输出只保留结构性证据，不保留令牌、Session、Profile 或业务 payload。代码入口已具备，仍需目标 Gateway、正式 DWS 和受控租户实际执行后才能判定动态通过。

目标 Gateway 读取现进一步扩展为 `dingtalk:gateway:target-readonly` 权限矩阵。`core` 固定五项，`extended` 固定十二项；矩阵先用一次 `tools.effective` 证明全部工具的 Session 可见性、插件归属、低风险与只读标签，任一投影缺失时保持零业务调用。投影通过后按固定顺序串行调用 `tools.invoke`，单项失败不会阻止其余只读权限检查，也不会自动重试。每项只接受工具名、canonical path、Profile、Schema 摘要、统一成功信封和文本详情全部一致的结果，输出丢弃业务数据和身份信息。该入口把 DWS 直连权限预检提升到完整 Gateway 调用链，但仍需目标环境执行。

P0-C 现已补充固定 17 项的目标 Gateway 高敏只读矩阵 `dingtalk:gateway:target-sensitive-readonly`。它从用户显式提供的 OpenClaw 与 JunQi 钉钉插件包根加载各自正式编译产物，先一次性核对内部 Schema 工具和全部业务工具的 Session 投影，再通过 `tools.invoke` 读取全部 17 个当前叶子 Schema，并在任何业务读取前使用同一插件参数校验器检查完整调用计划。投影、Schema 或参数任一失败都会保持零业务读取；全部预检通过后才按固定顺序串行读取，并要求预检与实际执行 Schema 摘要一致。合同分析的 OpenClaw 参数面只接受有界内联 JSON 对象，插件在执行边界规范化并转换为 DWS 正式 `--file -` 标准输入，不接受任意文件路径。证据只保留固定工具、canonical path、Schema 摘要、阶段、计数和稳定错误码，仍需目标 Gateway、正式 DWS、受控租户与带身份同步的真实客户端执行。

P0-D 现已补充目标 Gateway 日历全链路验收 `dingtalk:gateway:target-calendar`。它一次核对内部 Schema、核心五项读取和三个日历写入的最终 Session 投影，随后读取全部八个业务叶子 Schema 并使用插件同一参数校验器验证闭合 fixture。三个不带 `confirm` 的 `tools.invoke` 必须只返回 `requires_approval`，从而在核心读取和真实写入前证明 OpenClaw 审批边界没有执行工具；任一失败保持零业务调用。核心五项全部执行且通过后，创建、更新和取消分别使用 `confirm=true` 并等待三个独立所有人审批，每步都要求插件身份、统一成功信封、Schema 摘要、`verified` 核验和同一 eventId。拒绝与传输或核验不确定性会立即停止，既有写入只返回最小恢复 ID，完整成功只保留已删除 ID 的摘要，不自动重放任何写入。该入口仍需目标 Gateway、可处理审批的授权界面、正式 DWS 与受控租户真实执行。

P0-D 同时补充目标 Gateway 待办全生命周期验收 `dingtalk:gateway:target-todo`。它一次核对内部 Schema、核心五项读取和四个待办写入的最终 Session 投影，先完成九个业务叶子 Schema 与全部参数预检，再用四个不带 `confirm` 的调用证明报告式审批边界。核心五项全部执行且通过后，创建、更新、首次完成、重开和最终完成分别使用 `confirm=true` 等待五个独立所有人审批，每步要求统一成功信封、`verified` 核验和同一 taskId。执行人被限制为精确 Profile 的 userId；拒绝、传输异常、核验不确定性或资源 ID 漂移都会立即停止且不自动重放。完整成功只保留 taskId 摘要，但目标租户会保留一条最终完成的合成待办，因此仍需在受控租户明确接受留痕后执行。

维护者以 `corepack pnpm dingtalk:gateway:target-calendar -- --gateway-url <ws-or-wss-root> --openclaw-package <absolute-openclaw-package-json> --dingtalk-package <absolute-junqi-dingtalk-package-json> --acknowledge-calendar-writes JUNQI_DINGTALK_TARGET_GATEWAY_CALENDAR_CREATE_UPDATE_CANCEL < controlled-gateway-calendar-input.json` 执行。标准输入必须闭合为 `agentId`、`sessionKey`、`profile` 和日历 `fixture`，完整字段见同日规格；令牌只通过 `OPENCLAW_GATEWAY_TOKEN` 环境变量进入正式客户端。

待办验收使用 `corepack pnpm dingtalk:gateway:target-todo -- --gateway-url <ws-or-wss-root> --openclaw-package <absolute-openclaw-package-json> --dingtalk-package <absolute-junqi-dingtalk-package-json> --acknowledge-todo-writes JUNQI_DINGTALK_TARGET_GATEWAY_TODO_CREATE_UPDATE_COMPLETE_REOPEN_COMPLETE < controlled-gateway-todo-input.json`。标准输入闭合为 `agentId`、`sessionKey`、`profile` 和只含 `executor`、`title`、`updatedTitle` 的 fixture；令牌边界与日历验收相同。

同时纠正认证 Profile 边界：OpenClaw 主线的 `profileAccess: required` 并非让所有纯令牌客户端都必须携带 Profile。当前路由只在连接已经声明 `authenticatedGitHubIdentitySync`、但尚未解析出 `authenticatedUserProfile` 时等待同步，并在同步失败或仍无 Profile 时返回 `UNAVAILABLE`、`AUTHENTICATED_PROFILE_UNAVAILABLE`。纯令牌 CLI 没有身份同步句柄，因此不能用它证明认证 Profile 正向或负向门禁；这项验收必须保留给真实带身份同步的目标客户端。

插件现在还通过 OpenClaw 正式 `skills` 清单贡献一个工作流 Skill。它只引用已注册的 `junqi_dingtalk_*` 工具，要求每种业务工具首次调用前读取当前叶子 Schema，并固化精确 Profile、唯一目标、部分成功和未知写结果禁止重放等边界。指定标题或日期的会议听记改用 DWS 正式 `minutes.shortcut_search` 唯一定位；只有用户明确请求“最新听记”时才使用 latest Shortcut。逐字稿固定通过同一 taskUuid 读取，禁止自动选择最新、关键词选择、游标续拉和单页模式；只有同一 taskUuid、`complete=true`、有效页数与一致段落计数同时成立，才允许作为待办或周报草稿来源。

钉钉接入工作区现已提供事件专用配置表单。读取使用正式 `config.get` 信封；写入只修改三个事件字段，携带最新 `baseHash` 并对订阅数组使用精确 `replacePaths`。写后先重读确认，再经共享生命周期重启同一 Gateway 目标，重启后继续重读。无变化不写入、不重启；运行目标切换、重启失败或重读失败均保留明确的“已写入但未完成运行时应用”语义。

实时事件通知链路已补齐五类 P0 缺口。插件原先把带点的完整事件名传给 `gatewayEvents.emit`，而 OpenClaw 正式契约只接受局部事件名，这会让每条有效 DWS 事件在通知阶段抛错并被误计为协议坏行；consumer 也曾把任意 JSON 对象放入缓存，没有核对扁平输出的 `type` 是否属于该 consumer 请求的 EventKey；桌面虽然能收到失效通知，却没有通过正式 Gateway 读取面重读事件缓存；首次补上重读后，页面仍只按请求数字和 connectionId 拒绝迟到结果，没有证明返回快照属于该连接上已经保存的完整事件配置，也无法区分同一连接内替换后的事件服务代际。当前插件只发送 `events_changed`，由 OpenClaw 生成线上的 `plugin.junqi-dingtalk.events_changed`，并在缓存、去重和通知前要求非空且属于当前订阅的事件类型。通知失败与 DWS 行解析失败已经分离。插件新增显式要求 `operator.read` 和已认证 Profile 的 `junqi.dingtalk.events.snapshot`，只返回最多 20 条事件的序号、接收时间和类型以及运行计数，不返回事件 ID 和业务载荷；每个服务实例同时生成运行代际 UUID 和完整规范化配置 SHA-256。桌面配置绑定其来源 connectionId，本地重算摘要，并严格核对运行代际、完整配置、请求游标和通知最低 revision；同代际重复或倒退、摘要漂移、旧代际和迟到请求全部失败关闭。通知和快照仍不推断业务已经处理完成。仓库另有显式目标租户事件验收命令，只有 consume Schema、ready、真实事件、同序号同类型通知与干净停止同时成立才通过。

## 上游依据

本次核对以下最新版官方主线：

- OpenClaw 官方仓库提交 `66e4de2205e9995d5a26480da9218751c084133b`。
- OpenClaw 固定基线 `v2026.8.1` 的 [`gateway-runtime.ts`](https://github.com/openclaw/openclaw/blob/v2026.8.1/src/plugin-sdk/gateway-runtime.ts)、[`gateway-rpc.ts`](https://github.com/openclaw/openclaw/blob/v2026.8.1/src/cli/gateway-rpc.ts) 与 [`server-methods.ts`](https://github.com/openclaw/openclaw/blob/v2026.8.1/src/gateway/server-methods.ts)。
- DWS 官方仓库最新源码提交 `bea76da8ba5091154a31779e2850d652c212aef6`；81 工具动态 Schema 审计仍以已成功构建的官方提交 `d4098a72dbcbbf8bdb286dcca96994bc5a9f462f` 为可复现基线。

OpenClaw 的 `tools.invoke` 仍由 Gateway 统一执行工具并承载 `before_tool_call` 审批。插件只能在正式工具与 Hook 扩展点内增加钉钉能力。当前主线的 `requireApproval` Hook 只允许插件提交 `title`、`description`、范围、安全级别、超时和决策集合；Gateway 的插件审批视图、TUI、频道转发和移动推送均使用该 `description`，不会自动附带原始工具参数。`description` 的正式上限为 512 字符，`timeoutBehavior` 已标记废弃且未决审批始终失败关闭，因此插件不再提交该废弃字段。

当前主线的 `tools.invoke` 在 `confirm` 不是 `true` 时使用报告模式：插件要求审批会返回 `requires_approval`，不会创建审批请求，也不会执行工具。只有显式 `confirm=true` 才使用请求模式并等待插件审批；批准后才继续执行，拒绝在工具执行前终止。本轮核对到的工具注册表获取与取消跟踪调整没有改变上述审批语义。这一正式行为是目标 Gateway 日历和待办验收把“审批边界探针”与真实写入分离的依据。

OpenClaw 最新主线的插件清单继续正式支持 `skills` 路径数组并从插件根目录加载 Skill。加载器要求 Skill 路径位于插件根目录内、`SKILL.md` 是普通文件，并要求 frontmatter 包含非空 `name` 和 `description`。该扩展点只提供 Agent 工作流指令，不增加工具权限，也不改变 Gateway 工具执行和审批边界。本次刷新中与插件服务、工具和 Skill 加载相关的契约未发现破坏性变化。

DWS 最新主线提供以下可验证契约：

- 运行时 `dws schema <canonical-path>` 的完整叶子结果是 JunQi 核验可用性、参数、安全属性和结果 schema 的权威来源；插件只向 Agent 投影调用所需字段和约束。`availability` 缺失或不是 `available` 时不得调用。DWS 的 compact 视图仍适用于 Agent 展示，但不足以保留 JunQi 当前需要的 `interface_type` 和未来格式分支证据。
- DWS 最新主线增加了 Schema 时间格式迁移框架，字符串参数可用互斥的 `anyOf` 格式分支表达迁移窗口。当前 81 个已注册叶子尚未实际使用 `anyOf`；JunQi 已按正式结构失败关闭解析并支持已知格式分支，不把未来字段猜成现有业务能力。
- DWS 最新主线的 `contract review analysis` 正式接受 `--file -`，实现从命令标准输入读取 JSON 对象后调用合同分析，并由叶子 Schema 与官方测试共同覆盖该路径。JunQi 因此只在插件边界接受字段闭合的内联对象，规范化后使用标准输入执行，不把本地文件路径纳入 Agent 调用面。
- DWS 当前核验 Shortcut 使用 `ok/outcome/data` 统一信封，部分 OA 原子命令仍保留裸 MCP JSON；插件必须按已核对的命令类型严格分流，不能混用两种协议。
- `calendar +create` 与 `calendar +update` 在内部校验写回执、稳定 `eventId`、详情字段和参会人变更后才返回 `verified=true`。
- `todo +create`、`+update`、`+complete` 与 `+reopen` 在内部使用稳定 `taskId` 读回并比对预期字段后才返回 `verified=true`。
- `oa +approve-by` 唯一匹配实例和任务并在写后确认目标任务不再处于待处理集合，返回稳定实例、任务 ID 和 `verified=true`。
- `report +template-search` 具有正式结果 schema，可返回匹配数量、模板名称和稳定 templateId；`report template get` 提供模板字段读取，但没有声明结果 schema。`report entry submit` 要求非空接收人和包含 `key`、`sort`、`content`、`contentType`、`type` 的内容数组，提交后返回 reportId，插件再独立读取同一日志详情完成身份核验。详情正式契约不含完整接收人与逐提交字段后置条件，因此当前结果只能进入 `succeeded_unverified`，目标租户预检也必须停在人工模板复核前。
- OpenClaw 最新主线继续从 `openclaw/plugin-sdk/gateway-runtime` 正式导出 `callGatewayFromCli`；`tools.effective` 的闭合请求只接受真实 `sessionKey` 和可选 `agentId`，方法要求 `operator.read`。`tools.invoke` 的闭合请求支持工具名、参数、同一 Session 与 Agent，方法要求 `operator.write`，并继续经过最终工具策略与 `before_tool_call` Hook。目标读取入口直接复用该导出，不把当前安装版本号作为能力开关。
- OpenClaw 最新主线在认证完成后把 Gateway 帧上限设为 25 MiB，正式客户端使用相同上限。JunQi 高敏矩阵的闭合标准输入和合同内联正文继续限制为 1 MiB，低于该传输边界；这只证明请求大小契约相容，不证明目标代理、反向代理或租户接受该业务请求。
- `minutes +search` 支持标题关键词或 RFC3339 时间范围搜索，并返回稳定 `taskUuid`、完整性和分页证据，可用于唯一定位指定会议听记。
- `minutes +transcript` 默认追完逐字稿分页、跨页去重，并返回 `taskUuid`、`complete`、页数和段落计数。它也允许省略 ID 自动选择最新、指定关键词、游标或单页读取，因此 JunQi 将调用面收窄为显式 ID、可选方向和页数上限，并在统一成功信封之后再次核验同一任务与完整性。
- `minutes +detail` 可返回同一 `taskUuid`、聚合完整性、失败数和指定 artifacts；`minutes +action-items` 只接受显式 `actions` 或 `dingtalkTodoList` 数组。行动项正式结果没有返回 taskUuid，因此目标验收以精确 ID 参数以及此前 detail 和 transcript 的响应身份建立同任务链路，不把行动项响应本身误报为身份核验。
- 审批发起只有在正式原始响应的 `result` 能解析为稳定实例 ID 时才继续执行 `oa approval detail --instance-id`；当前叶子没有声明可依赖的结果 schema，因此缺少稳定 ID 时必须保持 `unknown`，不能猜测字段别名。
- 审批发起的正式顺序是先读取表单 Schema，再以相同 processCode、部门与表单值预测流程并人工核对自选审批节点，最后才创建实例。通用撤销叶子没有声明可证明终态的结果 schema，不足以支撑自动创建后自动撤销的安全验收。
- 最新 DWS 产品面还包含 minutes、doc、wiki、report、chat、mail、event、aitable、contract、hrbrain、recruit 和 agoal 等域，但命令是否可用及参数结构仍必须逐个以目标 DWS 的叶子 schema 核验。本轮审阅的 `hrbrain.shortcut_search_employees`、`hrbrain.shortcut_profile`、`hrbrain.shortcut_career` 和 `hrbrain.shortcut_performance` 均为 `availability=unavailable`，不能注册为 JunQi 可用工具。
- OpenClaw `registerService` 是持续进程的正式所有权边界；服务可使用 `serviceHealth` 报告异步失效，并通过 `gatewayEvents.emit` 发送不含业务正文的小型失效通知。`emit` 的事件参数必须匹配局部名正则 `^[a-z][a-z0-9_-]*$`，OpenClaw 再自动加上 `plugin.<pluginId>.` 前缀并按显式 `operator.read` 范围广播。
- OpenClaw 正式建议插件服务的 Gateway 事件只作为小型失效通知，授权客户端通过插件的 scoped Gateway method 重读规范状态。`registerGatewayMethod` 可以明确声明 `operator.read`；相比统一为 `operator.write` 的 `tools.invoke`，它是桌面读取事件运行状态的正确权限边界。
- DWS `event consume` 是会创建或复用个人事件订阅的 `write`、`medium`、`non_idempotent` 复合命令。单事件和多事件必须分别等待正式 ready marker，正常退出优先关闭 stdin，不能使用强制杀进程作为常规停机路径。
- DWS `event schema <event_key> --flatten` 的稳定业务 DTO 把顶层 `type` 声明为必需字符串，并以单值 enum 固定为当前 `event_key`。consumer 不能把缺失类型或其他订阅类型的 JSON 对象当作合法业务事件。
- `mail +draft-create` 在最新 schema 中仍是 `availability=unavailable`，正式原因是草稿连续删除后仍可按同一 messageId 读取，无法证明清理终态；不能作为当前可用草稿写入口。
- `chat.send_personal_message` 是仅以当前用户身份发送的正式叶子，支持稳定群或成员目标、24 小时幂等键和异步 `openTaskId` 回执；`chat.query_message_send_status` 可取得正式 `openMessageId` 与 `openConversationId`。最新 `chat +messages-mget` 会对请求 ID 去重，排除非请求消息和重复消息，并以 `messagesComplete`、请求数、命中数、缺失列表和失败清单披露基础消息集合是否完整。JunQi 只开放当前用户窄发送、状态查询和这一精确读取入口，不开放包含 Bot、Webhook、批量、自然语言目标和富媒体的 `chat +messages-send` 复合面。
- DWS StringSlice 在 Schema 中声明为 `array`，CLI 使用 CSV 解析。JunQi 现在对字符串数组执行类型和必填校验，再按 CSV 规则编码；不再把 JSON 数组字符串作为一个错误的列表成员传入 DWS。
- 完整叶子的参数对象仍以 CLI flag 为键，`property` 只记录底层 RPC 或接口字段映射，不是 Agent 调用参数名。最新 81 个工具中有 230 个参数的两者不同；JunQi 固定接受 flag 键并拒绝把 `property` 当成输入，避免把 `event`、`title`、`query` 等稳定 CLI 参数错误改写为底层接口字段。
- 对最新 DWS 完整 Schema 树递归盘点得到 31 个产品、1388 个正式叶子，其中仍有 1283 个标记可用但未注册到 JunQi。该数字是审查池，不是待批量开放清单；大部分条目属于底层原子命令、管理写入、高敏数据或缺少有界核验的复合面，必须继续按稳定目标、权限、确认、幂等、结果证明和数据最小化逐项准入。
- `todo +overdue` 是正式的 `read`、`low`、`not_required`、`idempotent` Shortcut。它完整翻页读取当前组织中当前用户作为执行人的待办，并筛选有截止时间、已过期且未完成的项目；每日助理不再只查今日到期而漏掉已经逾期的工作。
- `calendar +cancel-event` 是正式的 `destructive`、`high`、`user_required`、`unknown` Shortcut。它在删除前按稳定 eventId 确认目标存在，删除后接受正式未找到响应或已取消、已删除墓碑作为缺席证据，最终返回同一 eventId 和 `verified=true`。插件现在把 `destructive` 与 `write` 一并标记为有副作用；取消、超时、输出超限或进程结果丢失时只能进入未知状态，不能安全重试。
- 创建类 Shortcut 可以从回执建立新资源 ID；更新、完成、重开和取消类 Shortcut 已经持有请求中的稳定 ID。插件现在除要求 `verified=true` 外，还会比较回执 ID 与请求 ID，拒绝把另一个日程或待办的核验回执当作当前操作成功。

## 优先级评估

| 优先级 | 项目 | 当前结论 | 完成门禁 |
|---|---|---|---|
| P0 | 写入结果与审批可信 | 13 个副作用工具全部有显式审批摘要与核验策略；审批前核验 Profile、完整 Schema、类型、枚举、已知格式、CLI 必填与跨参数约束，展示目标、改动与完整参数指纹；缺少任一策略时失败关闭；已补齐请求 ID 与核验回执 ID 围栏，并增加日历三写与待办五阶段目标 Gateway 全链路验收 | 目标租户通过真实 OpenClaw 审批界面核对摘要并跑通日历与待办 Gateway 验收，再执行其余逐域真实写入、权威读回与人工清理 |
| P0 | 目标 DWS 契约准入 | 已有 81 工具全量审计入口，`availability` 与既有契约均纳入失败关闭校验，官方主线构建逐项通过 | 每个目标运行时安装后重新审计，失败时不得执行业务工具 |
| P0 | Gateway 到 DWS 调用链 | 已有关闭态基线、确定性夹具链路、正式目标 Gateway 当前用户读取、五项与十二项普通只读矩阵、固定 17 项高敏只读矩阵、日历三写和待办五阶段全链路验收；覆盖 Session 工具投影、最小 scopes、`tools.invoke`、报告式与请求式审批、插件归属、Schema、全参数预检、摘要一致性、DWS 结果信封与敏感证据丢弃 | 在 Docker 可用的受控测试机跑通两层隔离验收；随后对正式 DWS 和测试租户执行当前用户、两档普通只读、高敏矩阵、日历三审批和待办五审批验收，并用带身份同步的客户端核对认证 Profile 门禁 |
| P0 | 审批模板准入 | 已有失败关闭的五契约、两读取预检，不执行任何审批写入 | 目标租户提供安全模板、字段值、审批人和人工清理方案后再执行真实写入 |
| P0 | 日报模板准入 | 已有失败关闭的四契约、两读取预检，要求唯一精确模板并校验内容与接收人，不执行日报写入 | 目标租户读取真实模板定义并逐字段人工核对后，再单独审批提交一份可留痕测试日报 |
| P0 | 事件生命周期 | 服务、专用配置表单、ready、Profile、Schema、事件类型归属、去重、缓冲、优雅退出、正式 Gateway 命名、显式 Profile 授权的 `operator.read` 快照方法、桌面自动重读、连接与配置围栏、游标完整性和直接目标验收入口已实现；通知只显示为有新事件可读 | 先在目标租户执行单事件直接验收，再验证真实 Gateway 广播、桌面通知、快照自动重读、断线、退出退订和 Gateway 重启 |
| P1 | 每日工作助理 | 已补齐日程、逾期未完成待办、今日到期待办和待审批四源编排；`core` 五项和 `extended` 十二项只读预检已分档 | 目标租户先执行核心预检，再执行扩展预检并以真实 OpenClaw 会话核对空结果与单源失败 |
| P1 | 会议闭环 | 查人、忙闲、会议室、创建、变更、详情、参会人、核验后取消、听记搜索、同 ID 完整逐字稿与行动项固定工具和 Skill 已齐 | 目标租户完成一次受控创建、同 ID 读回、改期或参会人变更、核验后取消，再以受控听记 fixture 完成四阶段读取验收 |
| P1 | 听记、文档、日报、消息和邮件 | 听记已有同任务四阶段验收入口；其余只读与草稿底座已齐，日报按 reportId 对账，当前用户文本消息按异步回执和消息 ID 对账 | 真实权限矩阵、空数据边界、听记唯一定位与完整分页、日报字段与接收人、聊天正文与目标验收；邮件发送继续关闭 |
| P1 | AI 表格、合同、招聘和目标 | 17 个最小只读工具与显式 fixture 驱动的高敏只读预检已完成；HRbrain 因上游正式不可用而不注册 | 在目标租户执行预检，核对真实权限、敏感字段和最小数据范围；HRbrain 等待上游可用契约 |
| P2 | 消息和邮件扩展写入 | 当前用户单目标文本发送已开放；Bot、Webhook、批量、富媒体和邮件发送关闭 | 逐项找到正式确认、幂等和写后核验契约后再开放 |
| P2 | 高敏域写入 | 当前不开放 | 逐工具完成权限、审批、核验、审计和数据最小化 |

## 根因与影响链路

原实现的根因有三层：

1. 插件没有区分 DWS 核验 Shortcut 的 `ok/outcome/data` 信封和 OA 原子命令的裸 MCP JSON。
2. 插件只核验写命令自身的叶子 schema，执行成功后没有调用对应的只读命令。
3. 桌面活动状态只有 `succeeded`，无法表达“写响应成功但尚未核验”与“权威读回已确认”。
4. 字符串列表曾被编码成 JSON 数组文本，聊天读回又在任意嵌套字段中递归查找消息 ID；前者会把多个值误传成一个成员，后者会让请求回显形成假阳性。
5. 叶子 Schema 解析曾丢弃 `availability`，全量审计因此可能把上游明确不可用的工具误报为结构兼容并继续注册。
6. 写后核验协调器虽然会把未知写工具收敛为 `unknown`，但此前没有执行前的策略准入；未来误注册的副作用工具可能先产生写入再发现无法核验。
7. OpenClaw 不会自动把原始工具参数附加到插件审批视图，原实现只有聊天发送展示了具体目标和正文，其余写操作只有通用动作说明；超长正文还可能超过正式 512 字符上限。DWS `string` 参数也曾允许对象被隐式 JSON 序列化，日报正文则位于子进程参数中。
8. 事件服务曾把完整的 `junqi.dingtalk.events.changed` 传给只接受局部名的 `gatewayEvents.emit`。通知抛错又落在 DWS 行解析的外层异常处理中，导致有效业务事件被错误计入 rejected；桌面主连接也没有该插件事件的专用消费者。
9. 事件 consumer 曾只检查每行是否为 JSON 对象，没有执行 DWS 扁平输出 `type` 的必填和单订阅归属约束；错误 consumer 的输出可能污染缓存、去重和 Gateway 失效通知。
10. 桌面事件页曾只显示 Gateway 失效通知，没有调用插件规范读取面确认对应 revision 已进入可读缓存；内部事件工具又必须经过 `tools.invoke` 的 `operator.write` 权限，不适合作为桌面自动只读刷新边界。
11. 首次增加自动快照重读后，旧配置在连接切换后的短暂窗口仍可能驱动新连接读取；返回结果也只验证了字段形状，没有核对已保存 Profile、订阅组、EventKey、请求游标与通知 revision。
12. 参数准入此前只读取 compact Schema 并验证必填和基础类型，丢失 `cli_required`、接口类型、枚举、格式与跨参数约束。无效写请求可能先进入 OpenClaw 审批，再由 DWS 拒绝，审批内容并未真正满足当前叶子契约。
13. 合同分析的 DWS 正式入口要求 `--file -` 从标准输入读取 JSON，但插件执行准备此前只转换日报正文，导致 OpenClaw `tools.invoke` 传入的内联合同对象无法进入 runner 标准输入，同时任意文件路径也没有专门在插件边界拒绝。

本轮已修复这些问题。所有业务工具和事件消费现在都要求 `availability=available`，当前 4 个不可用 HRbrain Shortcut 已从注册面移除。Schema registry 读取完整叶子并生成最小调用投影，把 `cli_required`、接口类型、默认值、枚举、`date`、`date-time`、`json`、`anyOf` 和三类跨参数约束纳入摘要与执行前校验；DWS 为兼容 CLI 保留但不在调用面暴露的别名会按正式投影规则过滤。13 个副作用工具在审批前执行完整准入并生成有界摘要，完整参数用 SHA-256 绑定，高敏正文只显示长度；标量字符串严格检查类型，日报只接受内联正文并转换为最多 1 MiB 的标准输入。事件通知改用正式局部名，发送失败不再污染 DWS 协议拒绝计数；缺失或跨订阅事件类型在缓存与通知前失败关闭。桌面只消费与当前已核验连接匹配的有界失效通知，通过显式要求已认证 Profile 的 `operator.read` 方法自动重读无业务载荷快照，并把配置来源连接、已保存 Profile、订阅组数量、EventKey、游标和最低 revision 纳入同一发布围栏；旧连接、旧配置和迟到请求都不能成为当前状态。最新版 DWS 契约无法证明终态的审批拒绝和撤销仍保留非完全核验状态，不会升级为成功终态。

## 目标状态机

读取操作保持 `pending -> succeeded | failed`。

写入操作使用以下状态：

- `pending -> approval_required`：等待 OpenClaw 正式审批。
- `pending -> verified`：写回执有效，取得稳定资源 ID，并通过对应只读命令绑定同一 ID 完成预期后置条件核验。
- `pending -> succeeded_unverified`：权威读回成功，但当前正式契约只能证明目标对象存在，不能证明所有请求字段或动作终态。
- `pending -> unknown`：写操作可能已经执行，但缺少稳定 ID、读回失败、身份不一致或结果不可解析。此状态禁止自动重放写命令。
- `pending -> failed`：结构化证据证明写命令尚未开始或服务明确拒绝。

插件只把核验元数据写入本地活动证据，不持久化钉钉业务正文。原始业务结果仍由当次工具输出承载。

## 分阶段边界

1. 写前审批与写后核验已完成代码和自动化契约验证；当前 13 个副作用工具全部由审批摘要和核验注册表覆盖。审批前先核验精确 Profile、目标 Schema 和参数类型，缺少任一策略的工具会失败关闭。摘要在 512 字符内展示目标、实质改动与完整参数指纹，高敏正文不进入通知。更新、完成、重开和取消还会比较请求资源 ID 与回执资源 ID。目标租户实测待执行。
2. 日常助理已具备今日日程、逾期未完成待办、今日到期待办和待审批四个只读入口；插件工作流 Skill 按冲突、逾期、今日紧急待办和有时限审批排序，要求四路结果独立报告，禁止把失败读取解释为空数据，也不得从简报请求执行任何写入。
3. 会议闭环已具备查人、忙闲、会议室、共同时间、建会、改期、更新参会人、详情、核验后取消、听记搜索与读取所需工具；插件工作流 Skill 要求唯一目标、写入串行和逐步核验。取消前必须展示同一稳定 eventId、标题、时间和受影响参会人，取消后只接受 DWS 的缺席读回证明，不把跨工具编排伪装成客户端事务。DWS 直连维护入口会先核验三个写入叶子 Schema 和全部参数，再以内嵌方式对同一 DWS、同一 Profile 执行 `core` 五项只读门禁；任一读取失败时形成完整脱敏矩阵并保持零副作用。只有门禁全通过才对一个合成日程执行创建、同 ID 改名和同 ID 取消。目标 Gateway 入口在此基础上先证明最终工具投影和报告式审批边界，再要求三个独立所有人审批；两种入口遇到未知结果都立即停止且不自动重试或追加清理写入。
4. 受控待办验收会在任何副作用前核验创建、更新、完成和重开四个叶子 Schema，并内嵌执行同一 DWS、同一 Profile 的 `core` 五项只读门禁；只允许显式指定与 Profile 用户一致的执行人，然后按同一 taskId 创建、改名、完成、重开并再次完成。核心读取任一失败保持零写入；成功路径的终态是已完成，写入任一步未知都会停止后续动作并返回已知 taskId 供人工检查。
5. 审批模板预检会先核验表单 Schema、流程预测、发起、详情和撤销五个叶子契约，再只执行前两项读取。两个结果必须是 DWS 统一成功信封。它只接受简单模式的 processCode、部门 ID 和字符串表单值，输出不保留业务 payload，并明确返回仍需人工复核；不会创建、同意、拒绝或撤销审批。
6. 日报模板预检会先核验模板搜索、模板定义、提交和详情四个叶子契约，校验内容五字段与非空无重复接收人，只接受搜索结果中唯一的精确同名模板，再通过统一成功信封读取字段定义。输出不保留 Profile、模板、内容、接收人或业务 payload，且不会提交日报；正式模板详情没有结果 schema，因此仍需人工逐字段比较。
7. AI 听记已具备最新听记、按标题或时间搜索、详情、同 ID 完整逐字稿和行动项读取。逐字稿调用拒绝自动选取和单页结果，并对任务身份、完整标记、页数、段落数和段落对象执行后置校验。目标租户验收在任何读取前核验四个 Schema 与全部参数，再要求搜索唯一命中、详情和逐字稿证明同一 taskUuid 与完整性、行动项返回显式数组；任一读取失败立即停止。它不保留 fixture 与业务 payload，也不会触发待办或日报写入。
8. 文档搜索、文档读取、知识库和知识节点搜索已按只读方式开放。
9. 日报周报已开放收件、已发、最新日志、模板搜索、模板字段和详情读取。Skill 要求先展示完整草稿、模板和接收人，用户明确要求提交后才调用写工具；插件只接受内联正文，在审批前执行 1 MiB 上限检查，再使用 DWS 官方 `--contents -` 通过标准输入发送，不接受任意文件路径。插件从回执提取 reportId，再通过固定详情工具读取同一日志。ID 不一致进入 `unknown`，ID 一致仍保持 `succeeded_unverified`，直到目标租户能证明全部字段和接收人后置条件。
10. 消息和邮件已开放未读、提及、消息搜索、邮件分拣、邮件搜索和正文读取。聊天草稿经用户核对后，只能通过当前用户、单个稳定目标、文本和必填幂等键的窄入口发送；OpenClaw 审批展示精确身份、目标、正文和幂等键。发送后若只有异步任务 ID，插件固定查询一次状态；取得真实消息 ID 后调用 `chat +messages-mget --no-reactions --no-threads`。只有基础消息集合完整、计数与失败清单一致、消息 ID 一致且群会话 ID 一致时才接受读回；请求回显或任意嵌套字段中的同名 ID 不能冒充证据。异步仍处理中、目标不一致或消息不存在均进入 `unknown` 且不重发；精确 ID 读回仍保留 `succeeded_unverified`。邮件草稿仍只生成在会话中，不注册发送工具。
11. DWS event 已由 OpenClaw `registerService` 托管。配置为空时不启动；配置存在时先核验 `event.consume` 叶子契约，再按精确 Profile 启动最多 8 个同类事件组。运行时等待精确 ready、逐行解析 NDJSON、要求 `type` 属于当前 consumer 请求的 EventKey、按 `event_id` 去重，VoIP 优先使用 `biz_id`，并限制事件行、去重集合和内存缓冲。每个服务实例生成独立运行代际 UUID，并为包含 Profile、缓冲区、EventKey、目标和角色的完整规范化配置生成 SHA-256。插件发送正式局部事件名 `events_changed`，OpenClaw 在线上广播 `plugin.junqi-dingtalk.events_changed`；通知和快照同时携带代际与配置摘要，桌面重算后逐项核对并绑定当前已核验 Gateway 连接。同一代际重复或倒退 revision、摘要漂移和旧代际结果会被丢弃，新代际才允许序号重置。异常退出、事件类型违规或通知发送失败进入 `degraded`，不自动创建新订阅绕过 DWS 的重试保护。直接目标验收入口进一步要求真实事件与局部通知的序号和类型一致，并在结束时验证进程退出。
12. AI 表格、合同、招聘和目标管理已接入 17 个最小只读工具。当前没有开放这些域的任何写入或删除命令；HRbrain 的 4 个审阅 Shortcut 因正式 Schema 声明不可用而未注册。
13. 事件配置表单只在已验证且允许桌面修改的运行时开放编辑。它与插件 manifest 共用回归守护的 27 个事件闭集，拒绝混合目标和未知字段，并使用配置哈希、精确数组替换、两次写后重读和运行目标围栏完成保存与重启链路。
14. 目标租户只读预检要求显式选择 `core` 或 `extended`。核心档只包含每日助理五项最小读取；扩展档在此基础上增加最新听记、知识库列表、最新日报周报、邮件分拣、未读会话、招聘职位和当前用户目标权限，共十二项。每项只在取得 `ok=true`、`outcome=success` 且包含 `data` 的统一信封时计入通过；零退出的失败、等待或畸形信封进入脱敏失败矩阵。扩展权限失败不会阻塞日程和待办的核心写入验收，两个范围都不保留业务 payload。
15. AI 表格、合同、招聘和目标管理的高敏只读预检覆盖当前 17 个已开放工具，要求固定确认串、精确 Profile 和完整受控 fixture。在执行任何业务读取前先核验全部 17 个叶子 Schema，再预构造并校验全部命令参数；任一 Schema 或参数漂移都会失败关闭且保持零业务读取。列表读取固定为最小页，AI 表格记录固定为精确记录 ID，招聘固定为精确职位 ID；合同分析请求经最多 1 MiB 的 stdin 传入，不进入进程参数。全部读取还要求统一成功信封，失败、等待或畸形结果不会增加通过计数。所有业务结果在进程内丢弃，输出只保留阶段、计数和脱敏错误，且该预检失败不影响 `core` 日程与待办门禁。

## 未验证边界

- 当前没有目标钉钉租户的授权与真实业务数据，自动化只能验证命令构造、状态机、结构化输出和禁止重放，不能证明目标租户权限已开通。目标事件验收入口已经实现，但尚未获得真实 Profile 和外部事件触发条件执行。
- 受控日程和待办 DWS 直连写入验收入口已经实现，并在代码内强制同一 DWS、同一 Profile 的核心五项只读门禁，但尚未获得目标 Profile 执行。两者也已分别具备目标 Gateway 三审批与五审批入口，但同样未取得目标 Gateway、授权审批界面和受控租户执行。两者均不覆盖桌面活动投影或其他业务域，待办成功路径还会保留一条已完成的合成记录。
- 审批模板预检入口已经实现，但尚未获得目标 processCode、部门 ID 和真实字段执行。即使预检通过，也只代表表单 Schema 与流程预测可读取，不能替代人工核对自选审批节点或证明审批写入和清理安全。
- 日报模板预检入口已经实现，但尚未获得目标模板名、字段内容和真实接收人执行。即使预检通过，也只代表唯一精确模板可定位、模板定义可读取且计划参数符合当前 CLI Schema；不能证明字段与模板语义一致，也不能证明提交、可见性或收件人终态。
- 同任务听记四阶段验收入口已经实现，但尚未获得目标 Profile、受控 query 和稳定 taskUuid 执行。自动化只能证明全量预校验、唯一搜索、详情与逐字稿身份完整性、行动项数组和 payload 丢弃；行动项正式结果没有身份字段，不能单独证明响应属于同一任务。
- 17 项高敏只读预检入口已经实现，但尚未获得目标租户的受控 Profile、AI 表格、合同、招聘和目标 fixture 执行。自动化只能证明全契约预检、参数边界、读取范围和 payload 丢弃，不能证明目标权限已开通、fixture 对象真实存在或返回字段符合租户数据语义。
- 原子审批拒绝和撤销的详情字段及终态枚举没有足够稳定的官方结果契约。当前只能证明同一审批实例的权威详情已读回，不能把动作终态标为完全核验。
- 目标 DWS 版本必须在实际安装后逐个执行叶子 schema 核验；最新版主线能力不能替代目标运行时证据。
- HRbrain 当前没有可注册的已审阅 Shortcut。此处是上游正式不可用边界，不是目标租户开通权限即可绕过的问题；上游恢复 `availability=available` 后仍需重新审查路径、安全属性、参数和结果契约。
- 当前事件实现不会自行重启意外退出的 consumer。DWS 官方把建立订阅后的 Stream 重连韧性列为独立未完成范围；在上游或目标环境证据不足时，JunQi 不增加会绕过 `0/2/1` 订阅创建预算的自动重启。直接目标验收只能证明本地 consumer 进程干净退出，不能单凭进程终态证明远端订阅已经删除。
- 日报提交和当前用户聊天窄发送已完成代码与自动化核验，但尚未在目标租户执行。聊天 Bot、Webhook、批量、富媒体发送、邮件发送和高敏业务写入尚未实现，不能在界面中显示为可用。
- 事件配置专用表单、正式 Gateway 通知路由、`operator.read` 快照、连接隔离、自动重读与提示语义的代码和自动化验证已完成；状态区域继续复用 `Button` 与 `aegis-bg`、`aegis-border`、`aegis-text`、`aegis-primary` 及状态色，不新增本地业务终态。尚未在真实 Tauri 窗口和目标租户验证编辑、保存、重启、事件到达、快照自动重读及错误恢复。
- 最新 OpenClaw 官方源码已经证明加载器描述符、认证 Profile 门禁和事件前缀契约。固定 `2026.8.1` tag 也确认 `openclaw/plugin-sdk/gateway-runtime` 正式导出 `callGatewayFromCli`，其额外参数支持显式 scopes 与只读共享状态；同版本 Gateway 会按方法注册 scope 返回结构化缺权错误。隔离脚本现要求 `operator.read` 单独成功，并要求 `operator.write` 单独调用收到精确的 `FORBIDDEN`、`MISSING_SCOPE` 和 `operator.read` 缺权字段。当前机器实跑仍在 Docker 预检因守护进程不可连接而停止，未进入插件安装；认证 Profile 拒绝和线上事件分发仍需目标环境动态验收。

## 本轮验证结果

- 使用 DWS 官方提交 `d4098a72dbcbbf8bdb286dcca96994bc5a9f462f` 构建的 Schema 二进制枚举已审阅工具，确认 81 个为 `available`，4 个 HRbrain Shortcut 为 `unavailable`。移除 HR 注册项并把可用性纳入契约后，81 个业务工具全部通过完整叶子的 canonical path、CLI path、availability、effect、risk、confirmation、idempotency、参数语义与约束审计。
- 同一官方 Schema 二进制确认扩展只读预检新增的听记、知识库、日报周报、邮件、消息、招聘和目标管理七个叶子均为 `available`、`read`、`low`、`not_required`、`idempotent`，且没有必填业务参数；同时确认 AI 表格、合同、招聘和目标管理高敏预检覆盖的 17 个叶子均为相同的可用、低风险、无需确认和幂等读取契约，并按正式 Schema 提取其必填参数。
- DWS 官方 `chat +messages-mget` 的 ID 隔离、系统错误停止扇出和完整性投影定向 Go 测试通过。
- 钉钉插件测试 165 项全部通过，新增用例覆盖合同分析内联 JSON 到 `--file -` 标准输入的插件边界，以及高敏共享调用计划只允许该工具接收内联对象，并继续覆盖听记四阶段、读取前全量 Schema 与参数校验、统一信封门禁、日程和待办内嵌核心只读门禁、审批与日报预检、事件配置、`operator.read` 快照 RPC、全部 13 个审批摘要与核验策略、17 项高敏只读预检以及既有工作流边界。
- 受控日程和待办验收 CLI 使用错误确认串的进程级检查通过：命令在解析 DWS 运行路径和启动任何子进程前失败，未进入写入链路。
- 审批预检 CLI 的无效表单值进程级检查通过：在读取目标 DWS 路径、核验 Schema 或调用业务命令前以稳定输入错误失败，并明确报告没有执行写入。
- 日报模板预检 CLI 的空内容数组进程级检查通过：在读取目标 DWS 路径、核验 Schema 或调用业务命令前以稳定输入错误失败，并明确报告没有执行写入。
- 只读预检 CLI 缺少显式范围的进程级检查通过：在解析 DWS 运行路径和启动任何子进程前拒绝执行。
- 高敏只读预检 CLI 的错误确认串与空对象 fixture 进程级检查通过：两种输入均在解析 DWS 运行路径、核验 Schema 和启动业务子进程前失败关闭。
- 听记四阶段验收 CLI 的错误确认串进程级检查通过：在读取 fixture、解析目标 DWS 路径、核验 Schema 和启动业务子进程前失败关闭。
- 目标事件验收 CLI 使用错误确认串的进程级检查通过，在 DWS 路径解析、Schema 核验和订阅创建前失败关闭。真实子进程夹具同时验证了 Schema、ready、事件接收、局部通知、等待计时器及时清理和 `stopped` 终态。
- 事件配置、保存与重启协调、默认订阅、保存门禁、Gateway 通知路由、连接围栏、提示语义和三语言键集合共 20 个定向测试全部通过。
- 事件快照客户端、通知桥和展示的定向测试继续通过；事件读取协调器 4 项测试覆盖连接配置绑定、完整配置摘要、运行代际、最低 revision 和迟到请求拒绝，通知桥额外覆盖同代际去重、倒退、摘要漂移和新代际序号重置。三语言钉钉资源与资源装载的 6 项定向测试通过。
- OpenClaw 官方主线提交 `66e4de2205e9995d5a26480da9218751c084133b` 的源码确认 `tools.effective` 继续要求 `operator.read` 和真实 `sessionKey`，`tools.invoke` 继续要求 `operator.write`，并把调用交给最终工具策略与 Hook 路径；插件 Gateway 方法选项仍进入正式描述符，`profileAccess: required` 仍触发认证 Profile 门禁，服务事件宿主仍校验局部名和 operator scope 并添加 `plugin.<pluginId>.` 前缀。认证后的 Gateway 与正式客户端帧上限均为 25 MiB。该源码核对不能替代目标 Gateway、正式 DWS 和租户的动态验收。
- 全仓测试通过；前端与运行时测试 3001 项通过。增加目标 Gateway 待办验收并收敛日历与待办共享写入断言后再次执行全部脚本测试，309 项全部通过；五类目标 Gateway 定向测试共 52 项通过。
- 965 个生产文件的模块边界、版本一致性和 TypeScript 静态检查通过。
- 插件包契约显式检查统一 DWS 成功信封、共享读取结果核验、目标事件、听记四阶段验收与 17 项高敏只读预检的编译产物，维护 CLI 不会在固定包缺失对应执行模块时仍通过校验。
- 当前钉钉固定包为 `0.27.0`，注册 81 个业务工具和 4 个内部工具，共 85 个工具，并注册一个显式要求已认证 Profile 的操作员只读事件快照 RPC。两份元数据字节一致，归档摘要为 `5b9dea8641bb32da7ac301f7ad94462422b12b80774ed3c0d21fc89f73b2858f`；归档包含 96 个文件，新增合同分析安全标准输入转换和共享 17 项高敏调用计划，并继续包含完整叶子 Schema、参数语义和跨参数约束准入、统一结果信封、目标验收、日程和待办内嵌核心只读门禁、配置摘要、运行代际围栏、两类写策略、13 个有界审批摘要、日报有界 stdin、高敏预检、目标事件验收和无业务载荷快照逻辑，且不含任何 HRbrain 工具注册项。
- 隔离 Gateway 验收脚本 9 项测试全部通过，覆盖固定制品逐字节核验、独立归档挂载目标、无 DWS 配置、关闭态闭合投影、显式 `operator.read` 成功、`operator.write` 单独拒绝、容器参数与令牌边界、DWS 子进程拒绝、重启代际变化、失败证据和所有权围栏清理。原有协作插件隔离运行时的 11 项回归测试同时通过，证明共享运行时扩展没有破坏既有链路。
- 目标 Gateway 当前用户读取入口 11 项测试全部通过，覆盖闭合命令与标准输入、URL 凭据拒绝、4 KiB 上限、官方包导出边界、Session 工具归属与拒绝态、最小 scopes、DWS 成功信封、文本详情一致性、失败后禁止调用、稳定错误码和进程级敏感信息脱敏；进程级夹具同时证明 OpenClaw 模块加载前已从环境删除令牌。包级错误确认串检查也在读取标准输入、解析 OpenClaw 包或连接网络前以稳定错误码失败。该自动化没有连接目标 Gateway 或钉钉租户。
- 目标 Gateway 高敏只读矩阵 9 项测试全部通过，覆盖固定 17 项与共享插件计划一致、闭合参数和 1 MiB 输入边界、全部 Schema 先于业务读取、Schema 或参数失败零业务读取、单项读取失败后继续、摘要漂移拒绝、显式包根、模块加载前删除令牌、fixture 与业务 payload 丢弃和稳定错误码。包级错误确认串也在读取标准输入、解析包根或连接网络前以稳定错误码失败。该自动化没有连接目标 Gateway 或钉钉租户。
- 目标 Gateway 日历验收 12 项测试全部通过，覆盖固定核心五项与三个写契约、共享插件注册表一致性、闭合 fixture 和 16 KiB 输入边界、一次工具投影、全部 Schema 与参数预检、三个报告式审批探针、核心读取失败零写入、三个独立请求式审批、同 eventId 串联、拒绝与未知结果停止且不重放、显式包根、模块加载前删除令牌和敏感证据丢弃。包级错误确认串在读取标准输入、解析包根或连接网络前以稳定错误码失败。该自动化没有连接目标 Gateway、真实审批界面或钉钉租户。
- 目标 Gateway 待办验收 12 项测试全部通过，覆盖固定核心五项与四个写契约、共享插件注册表一致性、执行人与 Profile 绑定、闭合 fixture 和 16 KiB 输入边界、一次工具投影、九个 Schema 与全部参数预检、四个报告式审批探针、核心读取失败零写入、五个独立请求式审批、同 taskId 串联、拒绝与未知结果停止且不重放、资源 ID 漂移拒绝、显式包根、模块加载前删除令牌和敏感证据丢弃。该自动化没有连接目标 Gateway、真实审批界面或钉钉租户。
- 目标 DWS 全量契约维护入口的 2 项回归测试通过，覆盖直接调用与 pnpm 参数分隔符两种形式的绝对路径解析，以及缺参、相对路径和额外 Profile 参数在 DWS 解析前失败关闭。以官方提交 `d4098a72dbcbbf8bdb286dcca96994bc5a9f462f` 构建的绝对路径二进制执行 81 工具完整 Schema 真实子进程审计，最终 81 项全部通过；新增逐字稿叶子也通过完整结果 Schema 和参数语义核验。这仍不是目标部署版本或租户权限证据。
- `corepack pnpm dingtalk:gateway:smoke` 的真实执行完成固定包校验后，在 `docker-preflight` 因 Docker 守护进程不可连接失败；证据位于 `.artifacts/dingtalk-real-gateway/20260909092154-3a50767b3b/evidence.json`。该结果只证明验收基础设施正确失败并完成清理，不证明插件安装、Gateway RPC 或目标钉钉能力。
- 对同一源码连续执行两次插件打包，两个归档的 SHA-256 一致，没有发现固定包非确定性。
- 当前验证进程不在包声明的 Node engines 范围内，发布前仍需在声明支持的 Node 范围复跑。
- DWS 官方主线源码已刷新到 `bea76da8ba5091154a31779e2850d652c212aef6`。相对上一审阅提交的变化集中在聊天读取，待办生命周期实现未变化；创建、更新、完成和重开仍以稳定 taskId 完成写后读取并返回 `verified=true`。该提交继续要求当前受控环境无法满足的新版 Go 工具链，因此 81 工具动态 Schema 审计仍明确限定在已成功构建的官方提交 `d4098a72dbcbbf8bdb286dcca96994bc5a9f462f`，不能描述为最新主线动态通过。
- 未执行 Rust 测试、真实 Tauri 窗口视觉验收和目标钉钉租户验收。
