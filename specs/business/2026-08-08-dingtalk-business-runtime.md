# 钉钉业务工作台运行时规格

日期：2026-08-08

## 目标

在已确认的钉钉单平台 UI 下，实现由 OpenClaw 插件承接、DWS 执行、业务页与 Chat 共用的真实业务链路。第一可交付版本以运行时 readiness 和只读业务能力为范围，不包含未经真实租户验证的写操作。

## 必须满足的契约

1. DWS 只能由 OpenClaw `junqi-dingtalk` 插件执行；React、Tauri 页面和普通 service 不得直接启动 DWS。
2. 业务页只能展示当前 Session 的 `tools.effective` 中实际存在且未被 Session 拒绝的钉钉插件工具。
3. 业务页调用必须复用现有 `invokeOpenClawTool`，绑定真实 Session、attested Gateway identity、新鲜 effective snapshot 和一次性 `idempotencyKey`。
4. Chat Agent 与业务页必须调用同一组插件工具，不维护第二套业务 API 或 prompt bridge。
5. 插件不得提供任意 DWS 命令入口。每个工具必须映射到产品 allowlist 内的一个已验证 DWS canonical path。
6. DWS leaf schema 是参数、effect、risk、confirmation 和 idempotency 的运行时依据。schema 缺失或漂移时，对应工具失败关闭。
7. 所有写入和 destructive 工具都必须请求正式插件审批，只允许 `allow-once` 与 `deny`；无审批路由、超时和非法决策均不得执行。
8. DWS 需要命令行确认时，只有插件审批通过后才可传入 `--yes`。
9. 写调用返回成功后必须重读权威实体。重读失败时显示“待核验”，不得伪报业务终态或自动重放。
10. DWS `non_idempotent` 或 `unknown` 写操作发生响应丢失后不得自动重试。
11. profile 必须使用 `profile list` 返回的精确 `corpId:userId`；多 profile 不自动选择，聊天身份不替代业务身份。
12. 业务活动投影不得伪造 OpenClaw transcript、Tool Result、钉钉审计或业务实体终态。
13. token、client secret、DWS 配置正文、完整敏感表单和附件不得进入前端持久化、日志、Markdown 或测试快照。
14. 飞书、Google 与旧平台目录、Chat bridge、静态 Journal 在新链路启用时一并删除，不保留兼容路径。

15. 专属 Agent 必须同时满足 OpenClaw 的逐 Agent `tools.allow/deny` 和插件 `allowedAgentIds` 二次围栏；缺少 `ctx.agentId` 或配置为空时失败关闭。
16. 工作台身份卡只能展示 DWS 运行时返回的当前 profile、授权域、状态、到期时间和当前用户投影；未返回头像 URL 时不得拼接或猜测图片地址。
17. DWS 就绪引导必须以紧凑状态条区分插件未就绪、当前 Agent 未授权、DWS 缺失、业务身份未确认、用户资料待验证与可用状态；已核验的 Native 或 Docker runtime 只能启动官方安装与设备授权命令，远程或未核验 runtime 仅提供官方流程交接，不得伪报成功。
18. 业务活动必须优先展示 OpenClaw 官方 metadata-only 审计事件中的 Agent、Session、run、toolCall 与终态；本地仅可保存对应调用的派生关联元数据，不能替代官方审计、保存业务参数或推断委派关系。
19. DWS 缺失引导必须明确安装目标绑定当前 Gateway runtime。JunQi 只可在已核验的 Native 或 Docker runtime 启动已核对的官方安装与设备授权命令；复制命令、打开官方文档和重新检测均为用户主动操作，JunQi 不执行远程脚本或读取 token。
20. 钉钉业务插件未就绪时必须在工作台显示“在 JunQi 安装”入口；安装动作仅允许对已验证的当前 Gateway 执行，安装成功不等于工具已进入当前 Session，必须重启 Gateway 并重新读取工具状态。
21. 插件安装反馈只能展示 JunQi 可验证的阶段：目标身份核对、等待 Gateway 安装与启用、安装结果和重启要求；Gateway 未提供进度事件时必须使用不确定进度，不能伪造字节百分比或细粒度完成状态。
22. 能力表格是业务工作台的主要浏览区。搜索、业务域和操作效果等高频本地筛选必须在表格顶部可达；可展开筛选栏不得与工具详情重复承载租户身份。租户身份仅作为当前工具调用的显式参数保留在工具详情中，不得持久化。
23. 业务应用侧栏必须提供“有效工具”“操作审计”“接入与授权”三个稳定入口；页面内部不得再复制一套工具与记录页签。
24. 工具与审计视图在 readiness 完全就绪时不得持续占用状态条空间；任何阻断、错误或待核验状态仍需内联显示并提供真实动作。
25. “接入与授权”必须分别展示 Session、插件、Agent 双层授权和 DWS 身份核验，不得合并成单一“已连接”状态。
26. 工具表格只能按当前 `tools.effective` 返回的真实工具业务域分组，不得生成静态能力数量、占位工具或推测性可用状态。
27. 工具详情优先展示业务域、效果、风险和 Session 状态；工具 ID、DWS canonical path、schema 摘要和 JSON 参数进入可访问的高级披露区。

## 阶段 0 验收

- 使用正式 DWS 发布包取得脱敏的 `auth status`、`profile list`、product compact schema 和目标 leaf full schema 样本。
- 证明 OA `create-instance`、审批决定、待办、日历和考勤目标命令在测试版本中的 canonical path 与安全元数据。
- 复现至少一个成功读取、一个未授权、一个参数错误、一个超时或取消；恢复事件未复现时必须明确记录。
- 记录测试 DWS 版本、Gateway 运行时身份、操作系统和未验证平台，不把版本号写成永久能力开关。

## 阶段 1 验收

- `packages/junqi-dingtalk/` 可独立构建、测试、校验和打包。
- 插件在 DWS 缺失、auth 无效、profile 未选、schema 漂移和输出不合法时均返回结构化失败，不注册或不开放受影响业务工具。
- JunQi 业务页在插件不可用时显示准确原因，不显示静态可用数量或伪连接状态。
- 当前产品页面只出现钉钉，不出现飞书、Google、添加应用或平台切换。
- 删除旧 bridge 后，业务操作不再通过修改 Chat 草稿触发。
- 默认视图中筛选栏不挤占能力表格宽度；用户仍可通过可访问的筛选轨道展开业务域集中浏览，并在表格顶部完成搜索、业务域、效果筛选和清除。

## 阶段 2 只读 MVP 验收

- 当前用户、通讯录搜索、OA 列表与详情、考勤摘要、日历列表与详情、待办列表与详情均通过固定插件工具读取。
- 每次结果带有运行时、profile、schema 摘要和观察时间的最小投影信息。
- 切换 Gateway、Session 或 profile 后旧结果不可继续作为写入依据。
- 空数据、权限不足、认证过期、DWS 缺失、schema 漂移、Gateway 断开和返回结构非法均有独立 UI 状态。

## 阶段 3 与阶段 4 写入验收

- 每个写工具都有用户可读的操作计划、插件审批、DWS schema 校验、结构化结果和权威重读测试。
- 重复点击使用同一进行中 attempt，不生成第二个新写请求。
- 审批拒绝、超时、页面关闭、Gateway 断开和响应丢失不会显示成功，也不会自动重放。
- OA 发起必须先读取当前 form schema；流程预测是否必需由当前 leaf schema 和租户事实决定，不能硬编码。
- destructive 操作的确认必须包含目标实体和影响，且不提供永久授权。

## 测试要求

- 插件：tool allowlist、schema 映射、参数数组、输出上限、取消、超时、审批、幂等与恢复事件单元测试。
- Gateway 边界：`tools.effective` 新鲜度、Session fence、connection identity、`tools.invoke` envelope 和审批事件回归。
- 前端：亮暗主题、键盘焦点、窄窗口、加载、空数据、错误、审批中、未知结果和重读失败。
- 集成：使用不含真实凭据的 DWS fake binary 验证参数与错误；真实租户验证另行记录，不把 mock 成功当作平台验收。
- 文档：官方提交引用、schema baseline 摘要、未验证边界和 `PROJECT_STATUS.md` 同步。
