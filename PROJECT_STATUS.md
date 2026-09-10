# JunQi 项目状态

更新时间：2026-09-09

## 当前目标

持续评估并扩展钉钉 DWS 集成，按 P0、P1、P2 顺序完成契约准入、写入核验、实时事件、日常工作流和高敏业务域。当前代码阶段已完成 P0 底座、DWS 完整叶子参数与可用性失败关闭、写入请求与回执资源 ID 围栏、受控日程和待办写入验收入口、审批与日报模板只读预检、DWS 字符串列表参数修复、聊天严格完整性读回、事件配置专用表单、事件类型归属失败关闭、操作员只读快照与桌面自动重读、目标事件验收入口、每日四源工作助理、会议创建变更取消闭环、指定听记搜索、同 ID 完整逐字稿门禁与同任务四阶段目标验收、日报周报安全提交、上游明确可用业务域的最小只读入口、固定归档的隔离 Gateway 关闭态与确定性插件调用链、正式目标 Gateway 当前用户读取、核心与扩展只读权限矩阵、固定 17 项高敏只读 Gateway 矩阵，以及日历创建、更新、取消的目标 Gateway 三审批全链路验收。当前最紧急门禁是在 Docker 可用的受控测试机依次跑通两层隔离 Gateway 验收，再以正式 DWS 和受控钉钉租户执行目标 Gateway 当前用户、普通只读、高敏只读和日历写入矩阵，完成真实权限、读写、事件和跨工具工作流验收。

## 已完成内容

- 钉钉插件源码升级到 `0.27.0`，注册 81 个业务工具和 4 个内部工具，共 85 个工具，并增加一个不计入 Agent 工具面的操作员只读事件快照 RPC。
- 所有业务工具与事件消费契约现在要求目标 DWS 叶子 Schema 明确声明 `availability=available`；字段缺失或为 `unavailable` 时失败关闭。官方主线标记为不可用的 4 个 HRbrain Shortcut 已从插件清单、运行时规格和桌面域列表移除。
- 插件严格区分最新版 DWS 核验 Shortcut 的 `ok/outcome/data` 信封和 OA 原子命令保留的裸 MCP JSON，不再混用两种协议。
- 日程创建和更新、待办创建、更新、完成和重开、按关键词同意审批均切换到 DWS 官方内置写后权威读回的 Shortcut。
- 会议取消使用 DWS 官方 `calendar +cancel-event`：删除前确认稳定 eventId 存在，删除后验证同一日程已不存在；只有同一 eventId 和 `verified=true` 才进入已核验状态。
- `destructive` 与 `write` 现在共用副作用围栏、OpenClaw 审批和写后核验；取消、超时、输出超限或结果丢失时保持未知且禁止自动重试。
- 当前 13 个写入或破坏性工具全部纳入显式核验策略注册表。调用路径在目标 Schema 读取和 DWS 启动前检查策略；未来新增副作用工具若没有同步核验策略，会以稳定错误失败关闭，不会先产生写入再归类为未知。
- 当前 13 个副作用工具也全部纳入显式审批摘要策略。请求 OpenClaw 审批前先核验精确 Profile、当前 DWS Schema、参数类型和两类策略；摘要展示目标、实质改动与完整参数 SHA-256，限制在正式 512 字符内，高敏正文只显示长度。缺少摘要策略时不展示可批准入口。
- 更新和取消日程、更新、完成和重开待办除要求 DWS 返回 `verified=true` 外，还会比较回执资源 ID 与请求资源 ID；其他对象的回执不能成为当前操作成功证据。
- 新增受控目标租户日程写入验收入口。它要求精确写入确认，在任何副作用前核验创建、更新和取消三个叶子 Schema 与全部参数，并以内嵌方式对同一 DWS、同一 Profile 执行 `core` 五项只读门禁；任一读取失败会完成脱敏失败矩阵并保持零写入。门禁通过后才对一个唯一合成日程执行创建、同 ID 改名和同 ID 取消，任一步未知时立即停止，不自动重试或追加清理。
- 新增受控目标租户待办验收入口。它只允许把测试待办分配给 Profile 本人，在任何副作用前核验创建、更新、完成和重开四个叶子 Schema 与全部参数，并以内嵌方式执行同一 DWS、同一 Profile 的 `core` 五项只读门禁；任一读取失败保持零写入。门禁通过后才按同一 taskId 创建、改名、完成、重开并最终完成，任一步未知时立即停止，不自动重试或继续改变状态。
- 新增目标租户审批模板只读预检。它要求精确 processCode、部门 ID 和字符串表单值，在业务调用前核验表单 Schema、流程预测、发起、详情和撤销五个叶子契约，只执行表单 Schema 与流程预测两项读取，丢弃业务 payload，且明确标记仍需人工复核自选审批节点。由于正式撤销契约不能证明通用终态，不提供自动创建和清理审批单的验收路径。
- 新增目标租户日报模板只读预检。它要求精确模板名、非空内容数组和非空无重复接收人，在业务调用前核验模板搜索、模板定义、提交和详情四个叶子契约，只接受统一信封中唯一的精确同名模板并读取其字段定义。预检校验内容五字段和计划提交参数，但不提交日报，也不保留 Profile、模板身份、内容、接收人或业务 payload；因为正式模板定义没有结果 schema 且已提交日报没有安全删除契约，结果只进入人工复核门禁。
- 发起审批只有在正式原始回执的 `result` 能解析为稳定实例 ID 时，才通过固定审批详情工具读取同一实例；当前叶子没有可依赖的结果 schema，缺少稳定 ID 时保持 `unknown`，不猜测字段别名。
- 审批拒绝和撤销执行写后详情读取，但因官方终态契约不足，只进入 `succeeded_unverified`；读回失败、ID 缺失或信封异常进入 `unknown`，不自动重放写命令。
- 桌面活动状态新增 `verified`、`succeeded_unverified` 和 `unknown`，仅保存工具、schema 摘要、核验路径、稳定资源引用和原因码，不保存业务正文。
- 已加入今日日程、逾期未完成待办、今日到期待办、共同会议时间、参会人、AI 听记搜索、详情、同 ID 完整逐字稿与行动项、文档、知识库、日报周报、邮件、未读会话、提及消息和消息搜索等只读入口。
- 新增由 OpenClaw 插件正式加载的工作流 Skill，覆盖每日助理、会议创建、指定听记定位、听记转待办、文档知识检索和日报、消息、邮件草稿；Skill 只引用已注册的固定工具，不暴露任意 DWS 命令。
- 目标租户只读预检现在要求显式选择范围：`core` 固定检查当前用户、今日日程、逾期未完成待办、今日到期待办和待审批；`extended` 在核心五项上增加最新听记、知识库列表、最新日报周报、邮件分拣、未读会话、招聘职位和当前用户目标权限，共十二项。每项读取必须取得 DWS 统一成功信封，零退出的失败、等待、缺少 `data` 或畸形结果进入脱敏失败矩阵；两档都丢弃业务结果。
- 新增 AI 表格、合同、招聘和目标管理 17 项高敏只读预检。它要求固定确认串、精确 Profile 和完整受控 fixture，在任何业务读取前核验全部 17 个叶子 Schema 并预校验全部命令参数；列表固定最小分页、对象读取使用精确 ID，读取失败或统一信封不成立时会继续形成完整权限矩阵，所有业务 payload 均被丢弃。
- 修复合同分析在 OpenClaw 插件调用边界无法安全传递正文的问题。该工具只接受字段闭合、可序列化且不超过 1 MiB 的内联 JSON 对象；插件规范化后把 DWS 参数固定为 `--file -` 并通过标准输入发送。任意文件路径、额外字段、循环引用、非有限数值和超限正文都在 DWS 启动前失败关闭。
- 新增共享 DWS 成功结果判据，要求 `ok=true`、`outcome=success` 和显式 `data`。OpenClaw 实际业务只读工具、目标普通只读、高敏只读、审批表单与流程预测、日报模板定义均已接入；零退出的失败、等待和畸形信封不再被外层包装为成功或误记为验收通过。长驻事件消费继续使用正式 ready 与扁平 NDJSON 契约。
- DWS runner 新增最多 1 MiB 的可选 stdin 输入边界，合同分析的正式 `--file -` 和日报提交的正式 `--contents -` 请求不进入进程参数；日报写工具不接受任意 `contents-file` 路径，无效类型和超限输入会在解析 DWS 路径和启动子进程前失败关闭。
- AI 听记逐字稿只允许显式稳定 taskUuid，拒绝自动选择最新、关键词选择、续页游标和单页模式；结果必须证明同一 taskUuid、`complete=true`、有效页数和一致段落计数，行动项才可在人工确认后调用已核验待办写工具或生成待核对的日报周报草稿。
- 新增目标租户 AI 听记四阶段只读验收。它要求固定确认串并从有界标准输入接收受控 query 与稳定 taskUuid，在任何读取前核验搜索、详情、逐字稿和行动项四个 Schema 与全部参数，再要求唯一完整搜索、详情与逐字稿同 ID 完整性和显式行动项数组；失败时停止后续读取，输出只保留阶段、计数和脱敏错误。
- 日报周报新增模板搜索、模板字段、日志详情和提交工具。Skill 要求先展示完整草稿、模板和接收人，用户明确要求后再提交；插件从回执提取 reportId 并读取同一日志详情。ID 不一致进入 `unknown`，ID 一致仍保持 `succeeded_unverified`，因为正式详情契约不能证明全部字段和接收人。
- 当前用户聊天新增窄发送、异步状态查询和按消息 ID 精确读取。发送仅接受一个稳定群 ID 或 openDingTalkId、文本和必填操作级幂等键；OpenClaw 审批完整显示 Profile、目标、正文和幂等键。自然语言目标、Bot、Webhook、批量、提及、附件和媒体在调用前拒绝。
- 聊天写后核验从 `openTaskId` 查询真实消息与会话 ID，再通过 DWS 官方 `chat +messages-mget` 严格读取。只有 `messagesComplete`、请求数、命中数、缺失列表、失败清单、精确消息 ID 和群会话 ID 全部一致时才接受同一消息存在；请求回显中的 ID 不再能冒充读回证据。精确读回仍只进入 `succeeded_unverified`，因为正式契约不能证明完整正文和接收人后置条件。
- DWS Schema 中的 `array` 字符串列表现在按 CLI CSV 契约编码；`string` 标量也严格拒绝对象、数组、布尔值和数字。必填空数组、非字符串成员和未知参数在启动 DWS 前失败关闭，不再把 JSON 数组文本误传为单个成员或把对象隐式序列化为字符串。
- Schema registry 改为读取完整叶子并只投影调用所需字段。`cli_required`、接口类型、默认值、枚举、`date`、`date-time`、`json`、`anyOf` 格式分支以及 `mutually_exclusive`、`require_one_of`、`require_together` 都进入契约摘要和 DWS 启动前校验；接口数组的 CSV 枚举逐成员检查，隐藏兼容参数约束按正式调用面过滤。自然语言 `required_when` 保留为证据，但不做猜测性解释。
- 最新 81 工具完整 Schema 中有 230 个参数的 CLI flag 与底层 `property` 不同。插件继续以参数对象键对应 CLI flag 作为 OpenClaw 调用面，`property` 仅进入审计摘要；把 RPC 字段名作为调用参数会在 DWS 启动前按未知字段拒绝。
- 递归盘点最新版 DWS 完整 Schema 树得到 31 个产品和 1388 个正式叶子，其中还有 1283 个标记可用但未注册到 JunQi。该集合只作为逐项审查池，不作为批量开放清单；底层原子命令、管理写入、高敏读取和缺少有界核验的复合面继续关闭。
- 邮件仍只在 OpenClaw 会话中生成草稿，不开放发送工具。
- 新增全量契约审计工具，以并发上限 4 逐项核验 81 个业务工具的可用性与既有契约，并返回完整失败清单。
- 新增由 OpenClaw `registerService` 托管的 DWS 事件运行时：精确 Profile、27 个正式 EventKey、最多 8 个同类事件组、叶子 Schema 准入、正式 ready marker、NDJSON 解析、稳定 ID 去重、有界内存、最小 Gateway 失效事件、健康失败和 stdin 优雅停机。插件只发送正式局部名 `events_changed`，由 OpenClaw 生成 `plugin.junqi-dingtalk.events_changed`；通知发送失败不会把有效 DWS 行误报为协议坏行。
- DWS 扁平事件必须携带与当前 consumer 请求 EventKey 完全一致的非空 `type`；缺失、首尾空白或跨订阅类型会在缓存、去重和通知前被拒绝。新增显式目标租户事件验收入口，只有 consume Schema、ready、真实事件、同序号同类型通知、等待计时器清理和 `stopped` 终态同时成立才通过。
- 事件快照新增配置数、活动消费者数、已就绪消费者数、Schema 摘要、序列、水位、丢弃数、拒绝数和脱敏错误；完整事件正文只保留在当前 Gateway 生命周期的有界内存中。
- 钉钉接入工作区新增 DWS 实时事件专用表单，覆盖精确 Profile、27 个事件类型、目标类别、最多 8 个订阅组和有界内存配置；保存使用最新 `baseHash`、精确数组替换、写后重读、运行目标围栏、统一 Gateway 重启和重启后重读。桌面主连接新增严格通知桥，只保留与当前已核验 connectionId 匹配的 revision 和 eventType，并明确显示为“有新事件可读”而不是业务完成状态。
- 插件新增显式要求 `operator.read` 和已认证 Profile 的 `junqi.dingtalk.events.snapshot` Gateway 方法，闭合参数只允许起始序号和最多 20 条结果。响应保留运行阶段、运行代际、完整配置摘要、消费者计数、契约摘要、丢弃与拒绝计数，以及事件序号、接收时间和类型，不返回事件 ID 或业务 payload。桌面把配置读取绑定到来源 connectionId，进入事件页或收到新 revision 后自动重读；发布前本地重算完整配置摘要，并核对运行代际、请求游标和通知最低 revision，旧连接、旧配置、旧代际、迟到响应、未知字段、非法计数、乱序或跨订阅类型全部失败关闭，并提供就地失败与手动重试。
- 新增固定钉钉归档的隔离真实 Gateway 基线验收脚本。它不读取宿主 OpenClaw 配置或凭据，不注入 DWS 路径、Profile 和事件订阅；使用只读根文件系统、独立状态卷、安装期专用网络、运行期无出口内网、非默认端口和环境变量令牌，要求真实安装归档、校验配置、检查插件、确认没有 DWS 子进程，并验证 Gateway 重启后的运行代际变化。关闭态快照现在由显式 scope 客户端调用：仅 `operator.read` 必须成功，仅 `operator.write` 必须得到结构化缺权拒绝；无认证身份同步信息的令牌客户端仍不被用作 Profile 门禁证明。
- 新增确定性隔离 Gateway 插件调用链模式 `dingtalk:gateway:chain-smoke`。它只读挂载一个只接受精确 Schema 与当前用户读取的测试执行器，使用正式 `sessions.create` 建立无 Agent run 的 Session，经 `tools.effective` 核对最终工具投影，再以 `tools.invoke` 穿过插件授权、Schema registry、统一 runner、DWS 子进程和统一结果信封。调用后要求无残留 DWS 进程，证据不保存 Profile 和业务 payload；该模式不进入插件归档，也不冒充正式 DWS 或租户验收。
- 新增目标 Gateway 当前用户读取入口 `dingtalk:gateway:target-read`。它只从显式 OpenClaw `package.json` 解析正式 Gateway 客户端，不依赖宿主 PATH 或复制 WebSocket 协议；令牌只走环境变量并在模块加载前从进程环境删除，Session、Agent 和 Profile 只走不超过 4 KiB 的闭合标准输入。调用先以 `operator.read` 证明 Session 中唯一钉钉工具的来源、归属、风险与可见性，再以 `operator.write` 调用当前用户读取；输出只保留工具、插件、Schema、时间与 scope 证据，不保留令牌、Session、Profile 或业务 payload。
- 新增目标 Gateway 只读权限矩阵 `dingtalk:gateway:target-readonly`。`core` 固定当前用户、今日日程、逾期待办、今日到期待办和待审批五项，`extended` 固定在此基础上增加听记、知识库、日报周报、邮件、未读会话、招聘和目标管理七项。矩阵一次性核对所有工具投影，任一缺失或拒绝时保持零 DWS 调用；投影通过后串行执行，单项失败仍完成其余读取并只保留稳定错误码，不保留身份和业务 payload。
- 新增目标 Gateway 高敏只读矩阵 `dingtalk:gateway:target-sensitive-readonly`。范围固定为 17 个已注册 AI 表格、合同、招聘和目标工具，并从显式 OpenClaw 与钉钉插件包根加载正式编译产物；先核对内部 Schema 工具和全部业务工具投影，再读取全部 Schema 并预校验完整参数计划，任一失败保持零业务读取。全部预检通过后才串行调用，逐项要求统一成功信封与预检、执行 Schema 摘要一致，输出不保留连接、身份、fixture 和业务 payload。
- 新增目标 Gateway 日历验收 `dingtalk:gateway:target-calendar`。它固定投影内部 Schema、核心五项读取和日历创建、更新、取消三个写工具，先完成全部 Schema 与参数预检，再用三次不带 `confirm` 的调用证明只报告审批边界且没有执行工具。核心读取全部通过后，三个写入分别使用 `confirm=true` 等待独立所有人审批，并要求统一成功信封、`verified` 写后重读和同一 eventId；拒绝或未知结果立即停止且禁止自动重放，输出仅保留必要恢复标识或完整成功后的删除 ID 摘要。
- 新增目标 DWS 全量契约维护入口 `dingtalk:verify-target-contracts`，只接受显式绝对 DWS 路径，以固定并发 4 复用插件同一 Schema registry、81 工具规格和审计器；输出不含路径、Profile、Schema 原文或业务 payload。缺参、相对路径和额外 Profile 参数在 DWS 解析前失败关闭。
- AI 表格、合同、招聘和目标管理已加入 17 个最小只读工具；这些域的写入、删除、导入、分享、权限和流程变更均未注册。HRbrain 当前没有可注册的已审阅可用 Shortcut。
- 已完成实现审计、行为规格和实施计划，并记录最新版 OpenClaw 与 DWS 官方提交依据。

## 关键技术决策

- JunQi 继续只作为 OpenClaw 桌面客户端；工具执行、审批和会话策略由 Gateway 拥有，钉钉业务语义由 DWS 拥有。
- 每个工具都使用固定名称、canonical path、CLI path 和安全元数据，并在每次调用前对目标 DWS 叶子 schema 的 `availability=available` 与既有契约失败关闭核验。
- 参数准入以完整叶子 Schema 为准，内部摘要覆盖影响调用语义的字段；向 Agent 返回的 Schema 只保留可调用参数和约束，不暴露上游字段来源树。无法解释的自然语言条件和未知格式继续交由 DWS 判定，不在 JunQi 猜测。
- 字符串列表的 Schema 类型和 CLI 编码分别核验，不能把 JSON 参数表示直接当作 DWS StringSlice 的命令行表示。
- 优先使用 DWS 官方已封装写回执校验和读回验证的 Shortcut，不在插件内复制同一业务状态机。
- 无法由正式结果契约证明的写终态保持待核验或未知；非幂等写在结果未知时禁止自动重试。
- 副作用工具必须先进入显式核验策略注册表才有执行资格；安全的 `unknown` 结果不是允许未审阅写工具先执行的替代方案。
- OpenClaw 插件审批不会自动展示原始工具参数，审批摘要是用户核对目标与改动的正式输入。摘要必须有显式工具策略、绑定完整参数指纹、满足 512 字符上限，并避免把高敏正文复制到通知和移动推送。
- 日报提交虽然 DWS 原子命令本身不要求命令行确认，仍由 OpenClaw `before_tool_call` 对所有插件写工具执行单次人工审批，并由插件按 reportId 独立读回。当前读回只证明同一日志对象存在，不把内容和接收人终态标成完全核验。
- 日报目标租户预检只执行模板搜索和模板定义读取；搜索结果必须严格符合正式统一结果 schema，且只有一个名称完全相同、身份不重复的稳定 templateId 才能继续。模板字段仍必须由人工与草稿逐项比较，预检通过不授权提交。
- 日常助理、会议闭环、听记转待办和草稿生成由 OpenClaw Agent 串联固定工具，JunQi 不创建平行任务、纪要、日报或草稿发送模型。
- 每日助理固定读取今日日程、逾期未完成待办、今日到期待办和待审批，按证据排序并逐来源报告失败；简报请求本身不授权完成待办、处理审批、发消息或创建后续事项。
- 指定标题或日期的会议必须用听记搜索取得唯一稳定 `taskUuid`，不得用“最新听记”猜测；每种业务工具首次调用前读取当前 Schema，全流程保持同一精确 Profile。
- DWS 事件消费是长驻 NDJSON 子进程，必须由 OpenClaw `registerService` 托管，不能伪装成一次性工具。
- OpenClaw 插件服务事件必须向 `gatewayEvents.emit` 传入局部名，完整的 `plugin.<pluginId>.<event>` 由 Gateway 生成；桌面失效通知必须绑定接收时的已核验 connectionId。
- OpenClaw 正式要求 `tools.invoke` 使用 `operator.write`，因此桌面事件自动刷新不借用内部 Agent 工具；按照插件事件文档的建议，失效通知后通过插件 `operator.read` Gateway method 重读规范投影。
- 事件快照 RPC 仍依赖目标身份数据，因此显式保留 OpenClaw 默认的 `profileAccess: required`。每个事件服务实例拥有独立运行代际 UUID，并对 Profile、缓冲区、每组 EventKey、目标和角色的完整规范化配置计算 SHA-256；通知与操作员快照同时携带两项证据。桌面按相同规范重算摘要，并把响应绑定 connectionId、运行代际、完整配置、请求游标和通知最低 revision。同一代际的重复、倒退 revision 或摘要漂移会被丢弃，新代际才允许序号重置。
- consumer 意外退出只进入 `degraded` 并上报服务健康失败，不自动重建订阅。当前 DWS 官方仍未给出建立订阅后的 Stream 自动重连闭环，客户端不得绕过正式重试预算。

## 核心文件

- `packages/junqi-dingtalk/src/tool-specs.ts`
- `packages/junqi-dingtalk/src/schema-contract.ts`
- `packages/junqi-dingtalk/src/dws-result.ts`
- `packages/junqi-dingtalk/src/write-reconciliation.ts`
- `packages/junqi-dingtalk/src/invocation-policy.ts`
- `packages/junqi-dingtalk/src/contract-audit.ts`
- `packages/junqi-dingtalk/src/event-runtime.ts`
- `packages/junqi-dingtalk/src/event-rpc.ts`
- `packages/junqi-dingtalk/src/index.ts`
- `packages/junqi-dingtalk/src/target-readonly-smoke.ts`
- `packages/junqi-dingtalk/src/target-calendar-smoke.ts`
- `scripts/verify-dingtalk-target-gateway-calendar.mjs`
- `packages/junqi-dingtalk/src/target-event-smoke.ts`
- `packages/junqi-dingtalk/src/target-todo-smoke.ts`
- `packages/junqi-dingtalk/src/target-approval-preflight.ts`
- `packages/junqi-dingtalk/src/target-report-preflight.ts`
- `packages/junqi-dingtalk/src/target-sensitive-readonly-preflight.ts`
- `packages/junqi-dingtalk/skills/junqi-dingtalk-workflows/SKILL.md`
- `src/business-applications/activityStore.ts`
- `src/business-applications/dingtalkTools.ts`
- `src/business-applications/dingtalkEventSnapshotCoordinator.ts`
- `src/business-applications/dingtalkInvocationOutcome.ts`
- `src/business-applications/dingtalkEventConfiguration.ts`
- `src/services/gateway/dingTalkEventBridge.ts`
- `src/services/gateway/OpenClawDingTalkEventClient.ts`
- `src/pages/BusinessApplicationsPage.tsx`
- `src/components/BusinessApplications/BusinessActivityList.tsx`
- `src/components/BusinessApplications/DingTalkEventSettingsPanel.tsx`
- `src/components/BusinessApplications/DingTalkEventSnapshotStatus.tsx`
- `scripts/verify-dingtalk-real-gateway.mjs`
- `scripts/verify-dingtalk-real-gateway.test.mjs`
- `scripts/fixtures/dingtalk-gateway-dws-fixture.js`
- `docs/quality/dingtalk-dws-workflow-expansion-audit-2026-09-09.md`
- `specs/2026-09-09-dingtalk-dws-workflow-expansion.md`
- `plans/2026-09-09-dingtalk-dws-workflow-expansion.md`

## 测试与验证

- 从 DWS 官方提交 `d4098a72dbcbbf8bdb286dcca96994bc5a9f462f` 构建 Schema 二进制，枚举确认 81 个已审阅工具为 `available`、4 个 HRbrain Shortcut 为 `unavailable`。移除 HR 注册项后逐项核验剩余 81 个业务工具的完整叶子 canonical path、CLI path、availability、effect、risk、confirmation、idempotency、参数语义和约束；81 项全部一致。
- DWS 官方主线源码已刷新到提交 `44a23c5ab891822aa4099fa73c701721422e597c`。合同分析实现、叶子 Schema 与官方测试共同证明 `contract review analysis --file -` 从标准输入读取 JSON 对象；本轮插件修复严格采用该路径。该提交要求 Go 1.25.9，当前受控工具链无法构建最新主线二进制，因此 81 工具动态审计证据仍限定在上一条已成功构建的官方提交，不能描述为最新主线动态通过。
- 同一官方 Schema 二进制确认扩展只读预检新增的听记、知识库、日报周报、邮件、消息、招聘和目标管理七个叶子均为 `available`、`read`、`low`、`not_required`、`idempotent`，且没有必填业务参数；同时确认高敏预检覆盖的 17 个 AI 表格、合同、招聘和目标工具均为相同的可用、低风险、无需确认和幂等读取契约，并按正式 Schema 提取必填参数。
- OpenClaw 官方主线已刷新到提交 `329c12d11475589ac06c4bc0c9bc8d197a47489f`；从上一审阅提交到该提交的变更不涉及工具、审批或插件契约。`tools.effective` 继续要求真实 Session 与 `operator.read`，`tools.invoke` 继续要求 `operator.write` 并进入最终工具策略和 Hook 路径；不带 `confirm=true` 的调用以报告模式返回审批需求而不执行工具，显式 `confirm=true` 才请求审批并在批准后执行。认证后的 Gateway 与正式客户端帧上限均为 25 MiB，JunQi 目标高敏矩阵的闭合输入与合同正文继续限制为 1 MiB。
- DWS 官方 `chat +messages-mget` 的 ID 隔离、系统错误停止扇出和完整性投影定向 Go 测试通过。链接仍有 safechat 静态库目标版本警告，因此只作为源码契约证据。
- 钉钉插件完整测试通过，共 165 项；新增用例覆盖合同分析内联 JSON 到 `--file -` 标准输入的插件边界，以及高敏共享调用计划只允许该工具接收内联对象，并继续覆盖听记四阶段、完整叶子 Schema、参数语义、统一信封门禁、日程和待办内嵌核心只读门禁、事件配置、`operator.read` 快照 RPC、13 个审批摘要与核验策略、高敏只读预检和既有工作流边界。
- 听记验收 CLI 的错误确认串进程级检查通过，在读取 fixture、解析目标 DWS 路径、核验 Schema 和启动任何业务子进程前失败关闭。
- 受控日程和待办验收 CLI 的错误确认串进程级检查通过，在 DWS 路径解析和子进程启动前失败关闭。
- 审批预检 CLI 的无效表单值进程级检查通过，在目标 DWS 路径解析、Schema 核验和业务调用前以稳定输入错误失败，并报告 `writeExecuted=false`。
- 日报模板预检 CLI 的空内容数组进程级检查通过，在目标 DWS 路径解析、Schema 核验和业务调用前以稳定输入错误失败，并报告 `writeExecuted=false`。
- 只读预检 CLI 缺少显式范围的进程级检查通过，在 DWS 路径解析和子进程启动前失败关闭。
- 高敏只读预检 CLI 的错误确认串和空对象 fixture 进程级检查通过，均在 DWS 路径解析、Schema 核验和业务子进程启动前失败关闭。
- 目标事件验收 CLI 的错误确认串进程级检查通过，在 DWS 路径解析、Schema 核验和订阅启动前失败关闭；真实子进程夹具完成 Schema、ready、事件、局部通知和干净停止闭环。
- 事件配置、保存与重启协调、默认订阅、保存门禁、Gateway 通知路由、连接围栏、提示语义和三语言键集合共 20 个定向测试通过。
- 业务活动、工具投影、写结果状态和活动列表定向测试通过。
- 事件快照客户端、通知桥和展示的定向测试继续通过；事件读取协调器 4 项测试覆盖连接配置绑定、完整配置摘要、运行代际、最低 revision 和迟到请求拒绝，通知桥额外覆盖同代际重复、倒退、摘要漂移和新代际序号重置。三语言钉钉资源与资源装载的 6 项定向测试通过。
- OpenClaw 官方主线提交 `329c12d11475589ac06c4bc0c9bc8d197a47489f` 的加载器、工具调用和 Gateway 接收源码确认 RPC 的 scope 与 Profile 访问策略会进入 Gateway 方法描述符，`tools.invoke` 会经过最终工具策略和 Hook，并按 `confirm` 分离报告式与请求式审批；服务局部事件会由宿主校验并添加插件前缀，认证后帧上限为 25 MiB。该源码证据不替代目标 Gateway、正式 DWS、租户授权和广播验收。
- 固定钉钉归档隔离 Gateway 脚本 17 项测试通过，除关闭态归档、scope、重启代际和清理外，还覆盖确定性 DWS 只读挂载、两条精确命令白名单、Session 创建、实际工具归属、`tools.invoke` 结果闭合、调用后无残留进程、证据脱敏和缺工具时禁止调用。原协作插件隔离 Gateway 脚本 11 项测试同时通过。
- 目标 Gateway 当前用户读取入口 11 项测试通过，覆盖闭合参数、标准输入边界、URL 凭据拒绝、正式包导出约束、Session 工具归属与拒绝态、最小 scopes、DWS 成功信封、文本详情一致性、失败后禁止调用、稳定错误码和进程级敏感信息脱敏。进程级夹具确认 OpenClaw 模块加载前令牌已从环境删除；包级错误确认串检查在读取标准输入、解析 OpenClaw 包或连接网络前稳定失败。该测试没有连接目标 Gateway 或目标租户。
- 目标 Gateway 只读矩阵 8 项测试通过，覆盖五项与十二项固定范围、一次投影与串行读取、投影失败零调用、单项失败后继续、远端错误脱敏、进程环境令牌删除和业务 payload 丢弃。包级错误确认串检查也在读取标准输入、解析 OpenClaw 包或连接网络前以稳定错误码失败。该自动化没有连接目标 Gateway 或目标租户。
- 目标 Gateway 高敏只读矩阵 9 项测试通过，覆盖固定 17 项与共享插件计划一致性、闭合参数和 1 MiB 输入边界、全部 Schema 先于业务读取、Schema 或参数失败保持零业务调用、读取失败后继续、摘要漂移拒绝、显式包根、模块加载前删除令牌、fixture 与业务 payload 丢弃和稳定错误码。该自动化没有连接目标 Gateway 或目标租户。
- 目标 Gateway 日历验收 12 项测试通过，覆盖固定核心五项与三个写契约、插件注册表一致性、闭合 fixture 和 16 KiB 输入边界、一次工具投影、全部 Schema 与参数预检、三个报告式审批探针、核心读取失败零写入、三个独立请求式审批、同 eventId 串联、拒绝与未知结果停止且不重放、显式包根、模块加载前删除令牌和敏感证据丢弃。该自动化没有连接目标 Gateway、真实审批界面或目标租户。
- 目标 DWS 全量契约维护入口 2 项测试通过，覆盖直接调用与 pnpm 分隔符形式的绝对路径、缺参、相对路径和额外参数失败关闭。以 DWS 官方提交 `d4098a72dbcbbf8bdb286dcca96994bc5a9f462f` 构建的显式绝对路径二进制执行完整 Schema 真实子进程审计，81 个业务工具全部通过；新增逐字稿叶子同时通过正式结果 Schema 与参数语义核验。该结果仍不代替目标部署版本和租户权限验收。
- 真实执行 `corepack pnpm dingtalk:gateway:smoke` 时，固定归档校验通过，随后在 `docker-preflight` 因 Docker 守护进程不可连接而停止；未创建卷、网络或容器，清理结果无残留。该结果不是插件安装或 Gateway RPC 失败，动态基线仍未通过。
- 上一次真实执行 `corepack pnpm dingtalk:gateway:chain-smoke` 时使用固定 `0.26.0` 归档，摘要校验后在 `docker-preflight` 因 Docker 守护进程不可连接而停止，且没有创建预声明容器、网络或卷。当前归档已升级为 `0.27.0`，必须在 Docker 可用的受控测试机重新执行；当前确定性真实 Gateway 链路仍未动态通过。
- `corepack pnpm lint` 通过，包含 965 个生产文件的模块边界检查、桌面版本一致性和 TypeScript 检查。
- `corepack pnpm dingtalk:validate` 通过。
- 插件包契约现在显式检查共享 DWS 成功信封、共享读取结果核验、目标事件、听记四阶段验收和 17 项高敏只读预检的编译产物，避免维护 CLI 已声明但固定包缺失执行模块。
- `corepack pnpm verify:openclaw-docs` 通过，`commands.list` 校验已对齐新的官方 operator methods 页面。
- `corepack pnpm test` 全仓测试通过；前端与运行时测试 3001 项通过，全部脚本测试 297 项通过。目标 Gateway 当前用户读取、普通只读矩阵、高敏只读矩阵与日历写入验收共 40 项定向测试通过。
- `corepack pnpm build` 通过，协作与钉钉插件固定包、TypeScript 和 Vite 生产构建均完成。
- 固定钉钉插件归档已重建；两份元数据字节一致，均为版本 `0.27.0`、工具数 `85`、摘要 `5b9dea8641bb32da7ac301f7ad94462422b12b80774ed3c0d21fc89f73b2858f`。归档包含 96 个文件，新增合同分析安全标准输入转换和共享 17 项高敏调用计划，并继续包含完整叶子 Schema、参数语义和跨参数约束准入、统一结果信封、目标验收、日程和待办内嵌核心只读门禁、配置摘要、运行代际围栏、两类写策略、13 个有界审批摘要、日报有界 stdin、高敏预检、目标事件验收，以及显式 Profile 授权的无业务载荷操作员快照逻辑，且不含任何 HRbrain 工具注册项。
- 同一源码连续两次打包的 SHA-256 一致，排除当前固定包非确定性。
- `git diff --check` 通过。
- 对当前 111 个修改或未跟踪路径中的 110 个文本文件执行完整 Emoji 扫描，未发现命中；其余为二进制文件。
- 本轮没有修改 Rust，未运行 Rust 测试。没有执行真实 Tauri 窗口和目标平台视觉验收。
- 验证命令报告当前执行进程不在包声明的 Node engines 范围内，因此仍需在项目声明支持的 Node 范围复跑发布前验证。
- DWS 最新主线源码提交 `44a23c5ab891822aa4099fa73c701721422e597c` 要求 Go 1.25.9，当前受控工具链未能构建该提交。合同标准输入路径已有最新源码、叶子 Schema 与官方测试证据；81 工具动态审计仍限定在已成功构建的官方提交 `d4098a72dbcbbf8bdb286dcca96994bc5a9f462f`。

## 已知问题与未验证边界

- 当前没有目标钉钉测试租户、正式 DWS Profile 和对应权限，未执行真实日程、待办、审批、听记、文档、知识库、日报、邮件或聊天调用；自动化不能替代目标租户实测。
- 13 个写操作审批摘要已按 OpenClaw 正式数据模型完成自动化验证，但尚未在真实 Gateway 的桌面审批、TUI、频道转发和移动推送界面逐一核对显示、截断与隐私边界。
- 审批拒绝和撤销缺少可证明终态的正式结果字段，因此不会显示为完全核验。
- 日报提交和当前用户聊天窄发送已完成代码与自动化核验，但未在目标租户执行。聊天 Bot、Webhook、批量和富媒体发送仍关闭；邮件只能读取并在会话中生成草稿。
- 工作流 Skill、听记搜索、同 ID 完整逐字稿门禁、四阶段目标验收入口和固定包已完成自动化验证，但没有目标租户和真实 OpenClaw 会话，因此尚不能证明每日助理、会议闭环或听记转待办在目标权限下端到端可用。行动项正式结果没有 taskUuid 字段，同任务绑定依赖精确调用参数及此前详情和逐字稿的响应身份，不能把行动项响应单独描述为身份核验。
- 目标租户核心与扩展只读预检入口已经实现，但当前没有可用的受控测试 Profile，因此未实际执行；它们也不覆盖 Gateway、Agent、写入和事件链路。
- 受控日程创建、更新和取消的 DWS 直连接口及目标 Gateway 三审批接口均已实现，但当前没有目标 Gateway、授权审批界面和可用的受控测试 Profile，因此未实际执行；它们仍不覆盖桌面活动投影。
- 受控待办创建、更新、完成、重开和最终完成验收入口已经实现，但当前没有可用的受控测试 Profile，因此未实际执行；成功执行后仍会在租户中保留一条已完成的合成待办记录。
- 审批模板预检入口已经实现，但当前没有目标 processCode、部门 ID 和真实表单值，因此未实际执行。预检通过也不证明审批创建、同意、拒绝或撤销可用，仍需人工核对预测路径、审批人和安全清理方案。
- 日报模板预检入口已经实现，但当前没有目标模板名、真实字段内容和接收人，因此未实际执行。预检通过也不证明草稿字段符合模板语义、日报已提交或接收人可见；仍需人工检查模板详情并对可留痕提交单独审批。
- 17 项高敏只读预检入口已经实现，但当前没有受控 Profile 和真实 AI 表格、合同、招聘、目标 fixture，因此未实际执行。自动化不能证明目标权限、fixture 对象存在性或租户数据语义。
- 17 项目标 Gateway 高敏只读矩阵入口已经实现，但当前没有目标 Gateway、带身份同步的真实客户端、受控 Profile 和真实 fixture，因此未实际执行。自动化只证明投影、Schema、参数、顺序、摘要一致性和脱敏边界，不能证明认证 Profile 门禁、目标租户权限或敏感字段语义。
- 目标 Gateway 日历三审批验收入口已经实现，但当前没有目标 Gateway、可处理插件所有人审批的授权界面、受控 Profile 和可安全创建后取消的时间窗口，因此未实际执行。自动化不能证明审批展示、目标租户权限或日历最终状态；纯令牌 CLI 也不能证明认证 Profile 身份同步门禁。
- 实时事件代码、正式 Gateway 通知路由、操作员只读快照、桌面自动重读和模拟测试已完成，但目标租户尚未验证订阅创建、事件到达、桌面通知、快照重读、Gateway 重启、断线行为和退出退订。
- 目标事件验收入口已经实现并通过真实子进程夹具，但当前没有受控租户 Profile 和可配合触发的事件，因此尚未直接执行；它也不证明 OpenClaw Gateway 线上前缀广播、桌面连接围栏或远端订阅删除。
- 事件配置专用表单、配置控制面、连接隔离通知、显式 Profile 授权的 `operator.read` 快照客户端、配置与游标围栏、自动重读与手动重试已完成代码和自动化验证，但尚未在真实 Tauri 窗口与目标租户完成保存、重启、事件到达和快照重读验收。
- OpenClaw 最新主线和固定 `2026.8.1` tag 已证明 RPC 描述符、显式 scopes、结构化缺权、认证 Profile 门禁、Session 工具投影、`tools.invoke` 最终策略和插件事件前缀契约；隔离脚本现已具备关闭态 scope 正反例与确定性 Gateway 到插件到 DWS 读取链路的动态断言。但当前机器因 Docker 守护进程不可连接，尚未动态证明归档安装、配置校验、插件检查、两层 Gateway 调用和重启代际。确定性夹具也不证明正式 DWS、认证 Profile、租户权限或线上事件分发。
- DWS 官方仍把建立订阅后的 Stream 重连韧性列为未完成范围，当前 consumer 意外退出不会自动重启。
- AI 表格、合同、招聘和目标管理只有只读入口，尚未完成目标租户权限、敏感字段和最小数据范围验收。HRbrain 的 4 个已审阅 Shortcut 在当前官方主线均为 `availability=unavailable`，不能通过开通目标租户权限绕过，也未在 JunQi 注册。
- UI 复用既有 `Button`、`IconButton`、`Switch`、主题化 `Select`、`DingTalkProfileSelect` 和活动列表，以及 `aegis-bg`、`aegis-surface`、`aegis-border`、`aegis-text`、`aegis-primary` 和状态色。最近事件通知与快照使用同一主题 token、就地 `role=status` 和 `role=alert`，不新增本地业务终态。自动化覆盖配置、连接隔离、严格快照解码、自动读取结果和提示语义，尚未在真实 Tauri 窗口完成亮色、暗色、窄窗口、键盘焦点、加载、失败和空配置视觉验收。

## 失败方案与已删除路径

- 删除待办通用“设置完成状态”原子入口，改为 DWS 官方 `+complete` 和 `+reopen` 两个有明确目标状态且自带读回核验的命令。
- 删除原子“同意审批”入口，改为 DWS 官方 `+approve-by` 唯一匹配并读回任务终态的高风险 Shortcut。
- 日程和待办不再由插件复制字段比对逻辑，直接采用 DWS 正式复合契约。
- 删除聊天读取结果的任意递归 ID 匹配，改为 DWS 正式完整性投影和固定顶层字段核对；同时删除字符串列表的 JSON 文本编码路径，统一按 DWS CLI CSV 语义传参。
- 不开放 DWS 官方尚未证明安全清理和写后核验的邮件草稿、聊天 Bot、Webhook、批量、富媒体或敏感人事写工具。当前用户单目标文本发送只走带必填幂等键、异步状态查询和精确 ID 重读的固定窄路径。
- 不直接打包 DWS 官方原始 Agent Skills；它们会指导调用超出 JunQi 白名单的任意命令。JunQi 只通过 OpenClaw 正式扩展点交付固定工具工作流 Skill。
- 不把 DWS event 作为普通工具运行，避免超时杀进程、泄漏订阅或丢失事件。
- 不为事件 consumer 增加猜测性的自动重连或新订阅 ID fallback。
- 不再向 `gatewayEvents.emit` 传入带点的完整事件名，也不让保留的钉钉失效通知进入通用聊天事件处理。
- 直接调用未锁定的 `pnpm` 曾触发非交互环境依赖目录处理失败；后续统一通过仓库锁定的 `corepack pnpm` 执行。
- 一次性 `tsx -e` 审计脚本不能使用 CommonJS 输出不支持的顶层 `await`；改为显式异步函数后完成同一审计。
- OpenClaw 文档站已把 `commands.list` 从协议总览拆到 operator methods 页面；文档链接校验已改为检查新的官方页面。
- 一次进程级负向检查曾使用 zsh 只读变量名 `status`，导致业务命令已经按预期失败后外层校验脚本再次报错；复跑时改用任务专属变量 `approval_exit`，避免复用 shell 保留名。
- 首次枚举全部叶子 Schema 时无上限并发启动 DWS 子进程导致脚本超时；该失败不是 DWS 契约失败。改用与插件一致的并发上限 4 后完成枚举，并据此发现 4 个 HRbrain Shortcut 的正式不可用状态。
- 首次启用 `availability` 必填校验后，4 个事件运行时测试夹具因缺少该正式字段按预期失败；补齐夹具并新增不可用事件契约回归测试后，插件 103 项测试全部通过。
- 首次制品检查错误地要求仓库维护脚本 `scripts/verify-target-readonly.mjs` 存在于固定插件归档，因此按包清单正确失败。该脚本只供仓库维护者使用，安装包正式范围是 `dist`、`skills`、manifest 和 README；修正后的检查分别核验归档内预检运行逻辑与仓库内 CLI 入口。
- 首次探测 AI 表格和合同叶子时手写了不存在的 `contract.shortcut_*` canonical path，DWS 按正式契约拒绝。复跑改为直接从 `DINGTALK_TOOL_SPECS` 读取已审阅路径后成功，确认 AI 表格和合同工具均可用；后续不得在审计脚本中重复手写 canonical path。
- 首次直接对完整事件设置面板做 Node 端 SSR 测试时，测试加载器无法处理共享按钮的 CSS Module；提示语义随后拆到无副作用的专用展示组件中测试，完整面板仍由 TypeScript、生产构建和既有交互状态测试覆盖。
- 本阶段单独运行事件提示和事件客户端测试时曾没有加载根测试初始化文件，并一度误写为不存在的 `src/test-setup.ts`；前者使 i18n 或 localStorage 初始化失败，后者直接触发模块不存在。改用全仓一致的根级 `test-setup.ts` 后，事件快照、提示语义和三语言资源定向测试通过。前端单文件测试不得脱离仓库测试初始化条件解释为产品失败。
- 目标事件验收首版使用闭包变量记录异步通知，TypeScript 控制流把回调外读取收窄为不可达类型；改为显式状态对象后通过编译和行为测试，不使用强制断言掩盖异步状态边界。
- 最终制品检查发现插件 README 的事件契约说明是在第一次固定包构建后更新，导致已记录摘要过期；按最终源码连续重建两次后取得一致摘要，并同步两份元数据与当前文档。
- 本阶段第一次固定包后置统计尝试引用仓库未声明的 `tar-stream` 模块，导致统计命令在两次打包和摘要一致性断言已经完成后失败；改用系统 `tar` 后确认当时 `0.21.0` 归档文件、摘要与两份元数据一致，共 84 个归档文件。后续统计不得假定未声明的 Node 模块存在。
- 本轮一次固定包后置核验按 npm 包名猜测了归档文件名，因真实文件名由元数据声明而失败；复跑改为读取 `metadata.json#archiveFile` 指向的 `junqi-dingtalk.tgz`，确认摘要和 96 个归档文件均一致。后续制品核验必须以元数据的归档名为准，不从包名推导。
- 新增事件快照状态组件的首次单文件 SSR 测试直接导入共享 `Button`，Node 测试加载器不能处理其 CSS Module；随后把无副作用的状态正文拆为独立展示组件测试，生产组件继续复用共享按钮，并由 TypeScript、全仓测试和生产构建覆盖装配。
- 目标事件验收的首版通知竞速没有取消未胜出的等待计时器，真实事件很快到达后进程仍可能额外挂住最多 300 秒；当前在竞速结束后显式清理计时器，并用 5 秒等待夹具验证 2 秒内完成。
- 隔离钉钉 Gateway 首次真实执行在 `docker-preflight` 因 Docker 守护进程不可连接而停止。脚本按所有权围栏检查并确认没有已创建资源；后续应在 Docker 可用的受控测试机复跑，不得改用宿主 OpenClaw 配置或把预检失败误报为插件失败。
- 固定 OpenClaw tag 不在用于主线审计的浅层 blobless checkout 中，直接读取 tag 触发远端对象等待且没有产生源码结果；中断后改从 OpenClaw 官方 GitHub `v2026.8.1` 文件页核对同一导出、显式 scopes、只读共享状态和服务端授权契约。后续固定版本核对应先检查本地 tag 是否存在，不存在时直接使用官方 tag 文件页或单独的有界 tag checkout。
- scope 探针失败编排测试首次走了生产 90 秒重试路径，导致负向测试等待；当前负向夹具改为显式异步注入并等待同一 scoped 调用，立即进入脱敏证据与清理断言。后续长重试链路的单元失败用例必须在真实调用边界注入已等待的失败，不能留下未处理 Promise。
- 目标契约命令首次按常见 pnpm 形式传入参数分隔符时，脚本把独立的 `--` 当成业务参数并按预期失败；当前解析器只允许忽略一个首位分隔符，之后仍严格要求唯一 `--dws-path` 和绝对路径。
- 最终固定归档手工摘要核对首次误用了不存在的 `archiveSha256` 字段，命令因此失败但没有改写制品；两份元数据的正式字段是 `sha256`。后续制品核验必须读取生成器定义或现有元数据结构，不得凭记忆猜测字段名。
- 核心读取 Schema 调查首次手写了不存在的 `approval.shortcut_pending` 路径，DWS 正确以 validation 错误拒绝；随后改为从插件已审阅规格使用 `oa.list_pending_approvals`。同一调查还假定系统存在 `jq` 而使投影管道失败，改用 Node 标准库直接解析官方 Schema 输出。后续外部契约审计不得手写 canonical path，也不得假定未声明的命令行依赖存在。
- DWS `todo +due-today` 的正式说明写有“没有到期待办则返回错误提示”，但同一官方提交的可复现实现始终通过 `rt.Output` 返回 `{count: 0, tasks: []}` 成功结果。当前以源码和结果 Schema 的 `success` 契约为准，将文案差异记录为上游说明问题，不在 JunQi 增加空数据失败兼容分支。
- 曾尝试要求全部业务叶子 Schema 显式声明 `result.outcomes`，但对同一官方 DWS 二进制执行 80 工具真实子进程审计后，只有 29 个叶子携带该可选声明，51 个叶子没有该字段。该过严门禁已撤回，随后 80 项契约审计恢复全部通过；运行结果信封继续依据 DWS 统一输出框架和实际返回值严格核验，不能把 Schema 未声明结果字段误判为工具不可用。
- 完整叶子 Schema 首轮审计有 3 个聊天工具因正式约束引用隐藏兼容别名而失败，结果为 77/80。DWS 官方命令实现与测试要求完整 Schema 保留这些别名；JunQi 随后把约束投影到已公开调用参数：互斥组少于两个成员时删除，至少一个组必须保留可调用成员，成组约束若仍引用隐藏字段则失败关闭。修复后同一官方提交的 80 项审计全部通过。
- 构建最新 DWS Schema 二进制时，最初沿用不存在的 `./cmd/dws` 包路径，Go 正确拒绝；核对官方 README 后改用正式入口 `./cmd` 并完成构建。另一次代表性检查因命令工作目录拼写错误而没有启动，使用已核对仓库根目录复跑后通过，均未改写产品文件。
- 本阶段七次验证或补丁命令因代理误填不存在的工作目录或文件路径而未启动，另一次空补丁因不含变更行被编辑器拒绝；正确仓库路径复跑后测试均通过，失败补丁没有改写文件。这些失败与产品代码无关；后续命令固定使用已核对的仓库根目录，并在提交补丁前确认存在实际修改。
- 本轮一次只读 Schema 映射统计命令缺少闭合括号，Node 在解析阶段退出且没有改写任何文件；修正为分步构造映射后确认 81 个工具共有 230 个 CLI flag 与底层 `property` 不同。后续一次性审计表达式先在语法层核对括号配对。
- 本轮一次文档残留检索把 Markdown 反引号直接放入双引号 shell 参数，zsh 将其中两段误作命令替换；检索仍未改写文件，随后改用单引号模式完成核对。后续包含反引号的搜索模式只使用不会触发 shell 展开的引用方式。
- 本轮第一次固定包复现命令因末尾包含递归删除临时目录而被安全策略在进程启动前拒绝，未改写制品；改为单个系统临时文件且不执行递归删除后，两次打包、逐字节比较、摘要和文件数核对全部通过。
- 本轮一次生成物状态检查使用 zsh 特殊变量名 `path` 作为循环变量，间接清空命令查找路径，使检查脚本后半段无法找到 `git` 和 `rg`；命令未改写产品文件。复跑改为显式逐文件检查，后续 shell 变量不得复用与 PATH 绑定的 `path`。
- 本轮刷新 DWS 官方提交时，一次只读 `git ls-remote` 使用了拼写错误的工作目录，命令在启动前失败且没有改写文件；随后固定使用已核对的仓库根目录复跑并确认官方提交未变化。
- 本轮最终收集交付行号时再次误填不存在的工作目录，命令在启动前失败且没有改写文件；后续交付检索继续固定使用仓库绝对根目录，不能在已确认路径后临时重写。
- 本轮增加目标 Gateway 验收时又有两次只读命令因误写工作目录在进程启动前失败，另有两次补丁因误写目标路径被编辑器校验拒绝；四次均未执行产品逻辑或改写目标文件，使用当前线程默认仓库目录和已核对绝对路径后完成同一检查与补丁。后续不再为当前仓库命令重复填写可选工作目录。
- 本轮刷新 DWS 最新主线后，第一次构建命令使用了目标工具不支持的 `-C` 参数，命令在编译前退出且未改写产品文件；改为在官方源码目录执行正式构建入口后，又因该提交要求 Go 1.25.9 而无法在当前受控工具链构建。后续最新主线动态审计应在具备官方要求工具链的受控环境运行；在此之前只保留源码、Schema 与官方测试证据，不把旧提交的动态审计冒充最新主线结果。
- 固定包后置检查首次误读不存在的 `version` 字段，且组合命令没有启用立即失败，导致该子检查失败后仍继续执行后续只读命令。命令没有改写制品；随后依据生成元数据的正式 `pluginVersion` 字段并启用立即失败与管道错误传播重跑，确认两份元数据、0.27.0、85 个工具、归档摘要和 96 个文件全部一致。后续组合验证必须在首行启用立即失败，并从生成器或现有结构读取字段名。
- 本轮包级错误确认串的首次外层断言错误地要求 `corepack pnpm` 只输出子进程 JSON，忽略了 pnpm 生命周期前后文；业务脚本已经按预期以稳定错误码退出。复跑改为同时核对退出码和结构化错误码片段。生产构建还发现把仓库维护命令写入插件 README 会在没有运行时代码变化时改变固定归档摘要；该说明已移到仓库审计，插件 README 恢复后重建确认 0.27.0 摘要不变。后续仓库维护入口说明不得无意进入插件发布内容。

## 下一步顺序

1. P0-A：在 Docker 可用的受控测试机依次运行 `corepack pnpm dingtalk:gateway:smoke` 和 `corepack pnpm dingtalk:gateway:chain-smoke`，动态证明固定归档关闭态以及 Session、实际工具投影、`tools.invoke`、插件、Schema、DWS 子进程和结果信封链路；两者均不证明正式 DWS 或租户。
2. P0-B：先运行 `corepack pnpm dingtalk:verify-target-contracts -- --dws-path <absolute-path>` 完成目标 DWS 的 81 工具 Schema 核验；再以环境变量提供 Gateway 令牌，并把 `agentId`、`sessionKey` 和 Profile 通过闭合 JSON 标准输入传给 `dingtalk:gateway:target-read` 完成最小当前用户读取，随后对同一目标依次执行 `dingtalk:gateway:target-readonly` 的 `core` 五项和 `extended` 十二项矩阵。最后必须用真实带身份同步的客户端验收认证 Profile 门禁；纯令牌 CLI 没有身份同步句柄，不能冒充这项证明。
3. 使用受控 Profile 和真实 fixture 先执行 DWS 直连 17 项高敏只读预检，再对同一 Agent、Session、Profile 和 fixture 执行 `dingtalk:gateway:target-sensitive-readonly`，逐域核对 AI 表格、合同、招聘和目标管理的工具投影、Schema、参数、权限、对象存在性、敏感字段与最小数据范围；最后由带身份同步的真实客户端单独验收 Profile 门禁。
4. 先使用已内嵌同 DWS、同 Profile 核心只读门禁的直连确认入口执行日程创建、同 ID 更新和同 ID 取消；通过后用 `dingtalk:gateway:target-calendar` 在同一目标核验工具投影、报告式审批边界、三个独立所有人审批、同 ID 读回和禁止未知写重放。随后执行自分配待办创建、同 ID 更新、完成、重开和最终完成，并补齐待办的 Gateway 全链路验收。
5. 使用审批只读预检核对目标模板字段与流程预测，并使用日报模板预检唯一定位模板、读取定义和校验计划内容与接收人；由人工分别确认审批人、接收人和留痕方案后，再按审批、日报周报和当前用户文本消息顺序执行真实写入、权威读回和人工确认，验证 `verified`、`succeeded_unverified` 与 `unknown` 的桌面展示。
6. 先用显式确认的目标事件验收入口验证单一最小事件的 Schema、ready、类型归属、事件到达、局部通知和干净停机，再通过专用表单验证真实 Gateway 广播、桌面连接绑定、事件快照重读、去重、Gateway 重启、断线和退出退订。
7. 使用受控 query 和稳定 taskUuid 执行听记四阶段目标验收，再以真实 OpenClaw 会话验证工作流 Skill 的每日助理、会议闭环、指定听记搜索、听记转待办和草稿链路，并记录部分成功和恢复行为。
8. 完成 AI 表格、合同、招聘和目标管理的逐域权限与敏感数据验收；持续跟踪 HRbrain 上游可用性，但正式恢复前不接入。
9. 完成事件配置页的亮色、暗色、窄窗口、键盘焦点、加载、失败和空配置真机验收。
10. 只有取得正式确认、幂等和写后核验契约后，才评估消息、邮件和高敏域写入。
