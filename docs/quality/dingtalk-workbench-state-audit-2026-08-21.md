# 钉钉工作台状态审查

## 审查范围

- `src/pages/BusinessApplicationsPage.tsx`
- `src/components/BusinessApplications/DingTalkToolTable.tsx`
- `src/components/BusinessApplications/DingTalkToolDetail.tsx`
- `src/business-applications/dwsOperationEventCache.ts`
- `packages/junqi-dingtalk/src/`
- OpenClaw 官方主线 `9c3335a1a43b0c9851d5c1f3ed52fc53fa4619f1`
- DWS 官方主线 `74b7690cbb67fc2baf681ad56a67ecb493f5cc07`

## 上游契约

OpenClaw 官方 `docs/gateway/protocol.md` 将 `tools.effective` 定义为当前 Session 的服务端派生工具投影，将 `tools.invoke` 定义为经过同一 Gateway 工具策略链的实际调用。插件 `before_tool_call` 可以阻止调用或要求审批。因此 JunQi 只能展示当前 Session 返回的目录、DWS 返回的身份与 schema，以及实际调用结果，不能把目录可见性解释为账号业务权限。

## 已确认问题

### BUG-DWS-12 中：详情重复呈现未核验权限

工具表格已经集中说明账号权限由实际调用核验，但详情面板对每个工具继续展示“账号权限：调用时核验”和“Session：已暴露”。后者只是目录来源，前者不是权限结果。重复展示增加噪声，也容易被理解为一项已经核验的权限状态。

目标行为：详情只展示效果、风险与明确拒绝状态。正常目录可见性由表格顶部统一说明。

### BUG-DWS-13 中：空状态标题与真实原因不一致

无 Session、工具目录缺失、身份探针失败和 Profile 未登录时，表格统一显示“当前账号没有可展示的操作”。这些状态并不都与账号权限有关。

目标行为：空状态标题和说明都由 `DingTalkCatalogAvailability` 决定；加载态继续保持非终态语义。

### BUG-DWS-14 高：晚到 schema 覆盖当前工具

参数 schema 请求没有请求代次和 Session、工具上下文围栏。用户快速切换工具时，旧请求可以在新请求后返回并覆盖当前面板，导致界面使用错误 schema 校验参数。插件执行层会再次校验并拒绝错误参数，因此未证明产生业务副作用，但 UI 契约已经错误。

目标行为：只允许最新且仍匹配当前 Session 与工具的 schema 请求发布 loading、success 或 error 状态。

### BUG-DWS-15 高：切换 Session 后保留旧参数草稿

当前 Session 变化时只清理调用结果和错误，所选工具、参数 JSON 与 schema 仍可能保留。相同工具在新 Session 中出现时，旧写操作参数会带入新 Agent 或新 Session。

目标行为：Session 变化立即使旧 schema 请求失效，并清理工具选择、参数草稿、schema、调用结果和错误。执行 Profile 变化时也清理参数草稿与调用结果，且调用期间不允许切换 Profile。

### BUG-DWS-16 中：DWS 启动请求缺少同步门禁

调用 `startDwsOperation` 后，页面直到异步返回 operation id 才进入 running。返回前按钮仍可重复触发。Rust 后端会拒绝第二个活动进程，因此未证明重复启动 DWS，但会产生重复准备、竞争错误和不一致反馈。

目标行为：调用 Tauri 前同步进入本地 starting 状态；在 Tauri 返回真实 operation id 前保持 id 为空。starting 与 running 都禁用安装、授权、切换、退出、刷新和重复启动。

### BUG-DWS-17 低：操作事件缓存无生命周期回收

每个 operation 的单项输出上限为 400 行，但 operation id 对应的三个映射和终态集合不会回收。长时间运行桌面应用会持续累积已完成操作。

目标行为：完成并结算后保留当前可见输出，但清理不再需要的事件、终态和完成标识；缓存助手提供可测试的单操作清理语义。

### BUG-DWS-18 中：参数错误没有把可编辑输入带到用户面前

当前工具 schema 由 DWS 在调用时返回。详情面板会列出必填参数，并在参数 JSON 缺字段时禁用执行按钮；但 JSON 编辑器藏在折叠的“高级参数与运行时契约”内。用户只能看到“缺少必填参数”，却无法直接补齐字段。

目标行为：当当前 schema 已确认存在缺失必填参数或参数 JSON 无效时，参数输入区域默认展开并获得可访问的说明。JunQi 只展示 DWS schema 返回的字段名、类型与必填标记，不猜测日期、枚举或业务规则。

### BUG-DWS-19 中：核心工作台控件绕过语言资源

工具目录、详情面板、DWS Profile 选择器和插件安装进度残留硬编码中文；切换到英文或繁体中文后，OpenClaw/DWS 返回内容与客户端控件文案混杂，无法形成完整语言界面。

目标行为：核心工作台与插件安装路径的固定客户端文案全部使用现有 i18n 资源。客户端能够确定的本地参数契约错误必须以稳定错误码映射为当前语言；DWS 和 OpenClaw 返回的工具名称、字段名、描述、状态及错误保持原样，避免客户端对上游数据作未经证明的翻译。官方文档链接通过受控桌面外链打开器交给系统处理，失败时在当前界面展示明确反馈，不以 WebView 的静默 `window.open` 代替结果。

### BUG-DWS-20 中：官方审计刷新失败抹去已读取记录

首次读取失败与成功空结果已经被区分，但 `useDingTalkBusinessAudit.refresh()` 在已有官方记录时再次失败，会清空事件和分页游标。页面随后只剩失败空态，用户看不到刚刚由 OpenClaw 确认过的账本记录。

官方 `audit.activity.list` 是 metadata-only 活动账本的首选来源。仅在活动账本被官方判定缺失且查询限定为工具元数据时，才可受限读取官方旧 `audit.list` 并标记来源为 `legacy`；其他读取失败不代表此前已确认的记录失效。会话断开或切换时旧记录必须清空；同一会话的刷新失败则应保留已确认记录，并以列表内的非阻断提示说明本次刷新未成功。

### BUG-DWS-21 高：目录可见性被误报为插件 Agent 授权

`tools.effective` 只证明当前 Session 暴露了插件工具。钉钉插件还会在 OpenClaw 官方 `before_tool_call` 生命周期中读取 `allowedAgentIds` 并终止不在名单内的调用。当前就绪面板仅因目录中出现工具就把“Agent 授权”标为已核验，可能让用户在真实调用前看到错误成功状态。

目标行为：Session 工具可见性、插件 Agent 授权和 DWS 身份是三个独立事实。只有当前 Session 的实际 DWS 运行时探针成功返回，才能证明该次调用已通过插件 Agent 门禁；目录可见但尚未取得该证据时必须显示“待核验”，并提供已存在的授权配置入口。不得解析或依赖人类可读的阻断文本来猜测授权状态。

### BUG-DWS-22 高：业务审计页混入其他 Session 的本窗口投影

`BusinessActivityList` 的官方审计查询已经严格绑定当前 `sessionKey`，但本窗口投影直接读取全局 `activityStore.attempts`。切换会话后，摘要、筛选结果和“清除本窗口”都会包含其他 Session 的尝试记录，与页面的当前 Session 标识矛盾。

本窗口投影是 JunQi 的派生状态，仍必须严格绑定创建时记录的 `sessionKey`。目标行为：列表、摘要、筛选和清除操作全部只作用于当前精确 Session；空 Session 不展示或清除其他 Session 的投影。不得通过 Agent 名称、Profile 或最近记录推断归属。

### BUG-DWS-23 高：工具策略刷新期间复用旧 DWS 身份

`DingTalkRuntimeIdentityCoordinator` 已为运行时身份快照记录 `toolsRevision`，并会在
`tools.effective` 更新后重探测。但是工作台只按连接与 Session 接受该快照，未要求快照与当前
工具修订一致。工具策略、插件或 Agent 许可变更后，旧 Profile 在新探测结束前仍能驱动工具目录和
调用入口。

目标行为：目录、Profile、参数 schema 和执行入口只能消费连接、Session、工具修订均匹配且已经
结算的运行时身份快照。修订变化后的 loading 快照必须撤回旧目录，等待当前工具策略的官方探针返回。

### BUG-DWS-24 高：审批追溯猜测 DWS 未承诺的结果结构

旧审批追溯面板从任意 DWS 输出中尝试识别 `id`、`status`、`tasks`、`records` 等多种字段和数组
层级，再把结果合成为本地审批轨迹。DWS 官方 OA 命令只定义了审批记录和任务查询的请求参数
`processInstanceId`，没有为这些调用承诺对应的稳定结果 envelope 或字段集合。因此该面板可能把
无关结果误投影为审批状态。

目标行为：移除推断性审批追溯、自动二次查询和本地合成状态。工作台只显示官方工具的原始结果；
审批记录、任务或实例状态只能由后续经过正式 schema 证明的上游结果投影。

## 未纳入本轮的边界

- DWS leaf schema 当前投影只包含名称、类型、必填与 property，没有经过契约核验的中文说明、日期格式或枚举。本轮不硬编码 `start`、`end` 等字段含义，也不伪造表单控件。
- `approval records` 与 `approval tasks` 的请求参数已获 DWS 官方证明，但返回结构尚未获得稳定 schema
  依据，因此本轮不提供审批轨迹或状态合成。
- 账号能否审批、考勤或创建日程仍由每次 DWS 调用结果确认，不从工具目录或 Profile 名称推断。
- Windows、Linux 和真实钉钉账号权限仍需目标平台实测。
- Session 运行时模型目录的完整鼠标、触控板和键盘可达性仍需在真实 Tauri WebView 中验证；本轮只保证由 Gateway 返回的模型不再与运行参数共享同一滚动边界，并在目录中提供稳定数量与滚动容器。

## 本轮验证

- 钉钉身份快照只在连接、Session 和工具修订都匹配且已结算时发布；工具策略刷新期间不会继续展示旧 Profile 或执行入口。
- DWS 审批追溯的推断性解析、自动二次查询和本地状态合成已删除；审批工具只保留官方原始结果。
- 钉钉身份修订门禁、审计、模型目录和深链定向回归 50 项通过；`pnpm lint`、`pnpm dingtalk:test`、完整 `pnpm test`、`pnpm build` 与 `git diff --check` 通过。
- 未完成真实 Tauri WebView 的亮色、暗色、窄窗口和长模型目录滚动验收，也未在真实系统处理器中验证钉钉深链跳转。
