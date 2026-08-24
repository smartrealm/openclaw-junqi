# 项目交接状态

更新时间：2026-08-24

## 当前目标

已合并本地 `main` 到 `Blues-Code/Jarvis`，完成安装目标层级契约收敛；已按官方 Codex 源码对照完成可由 OpenClaw 正式协议支撑的聊天交互增强。

## 已完成内容

- 已创建合并提交 `2ba31791`，将本地 `main` 的 5 个领先于 `origin/main` 的提交纳入当前分支，无冲突。
- 合并后安装目标类型已收敛为 `custom` 与 `existing`；同步删除旧 `user` 与 `userMissingPath` 的不可达界面、辅助函数回退和测试输入，避免 TypeScript 契约漂移。
- 已将官方 `openai/codex` 当前 `main` 的浅克隆放入 `gui/`，固定审阅提交为 `068c49f`；该目录是参考源码，未接入 JunQi 构建。
- 已对照 Codex 的运行历史、待处理审批、会话分支、运行时选择、多智能体工作区与中断转向模式。JunQi 已有 `ExecutionProcessGroup`、`SessionBranchesControl`、`SessionRuntimeControl`、`AgentOfficeView` 与正式 `sessions.steer` 路径；不复制 Codex TUI，也不新建平行会话、任务或审批语义。
- 聊天 Composer 上方新增待处理 OpenClaw 审批提示条。它只复用既有审批 Store 的官方列表和实时订阅，按当前会话与其他会话汇总未决审批，并跳转至既有活动中心审批面板处理。
- 持久化进度卡新增 OpenClaw 来源和 `updatedAt` 元信息；修订、步骤、时间与清空继续只以官方进度卡为准，无法格式化的上游时间不产生本地替代值。
- 修复合并后钉钉插件打包阻断：当前工具规格只有 `read` 与 `write`，副作用标记不再比较不存在的 `destructive` 分支；同时补回中止执行测试遗漏的 `access` 导入。钉钉插件包与前端 metadata 已由正式构建重新生成。
- 修复本地 Tauri 打包阻断：Rust 2021 crate 将 Rust 2024 let-chain 改为等价嵌套判断，并为 Node 路径借用返回显式绑定 Node 生命周期；同一安装链路的既有格式差异已由 `cargo fmt` 收敛。
- 已在本机生成未签名 macOS ARM64 DMG：`src-tauri/target/release/bundle/dmg/JunQi Desktop_3.2.1_aarch64.dmg`，大小 8.0 MB，SHA-256 为 `7dee90f4714e96bc90f105cc4ce2f6154d999d7d3721431a453cb548ce987509`，`hdiutil verify` 通过。
- 已更新并核对 OpenClaw 官方主线提交 `95b69efcc161548b364ff681b2f46c66742930cb` 的 `engines.node`。当前范围为 `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`，其中无上限的 `>=25.9.0` 接受 `v26.1.0`。实际安装继续按当前目标 npm 包返回的准确范围判定，不把主线范围或开发机版本写死为目标契约。
- Native Node.js 判断只使用当前目标机器、当前所选 Runtime 的实际 Node 路径、版本和同发行版自带 npm；开发机路径、版本和用户环境不参与判断。显式配置的 Node 路径保持独占，未配置时按目标平台候选探测。
- 安装页现在区分“没有满足范围的 Node.js”与“已检测 Node.js 但版本不兼容”。后者显示实际版本和当前 OpenClaw 所需范围；OpenClaw 安装阶段的 Rust 进度事件也传递同一结构化参数。
- Node 安装与修复入口继续在下载、系统安装或覆盖前重新验证完整 Node/npm 契约；两次探测间已有兼容运行时可用时直接复用，不写入、不下载、不覆盖。
- 已完成目标环境证据与副作用链路静态审查，确认首次 OpenClaw 安装的 `LegacyFallback` 写入路径与 DWS 已中止调用副作用问题。
- 已修复目标环境证据与副作用链路审查的两项问题：首次 OpenClaw 安装先解析准确目标包 `engines.node`，不存在完整 Node/npm 对时只读取公开 npm 元数据；DWS 在启动前拒绝已中止调用，并将已启动写操作的中止、超时或不完整结果收敛为 `DWS_SIDE_EFFECT_UNVERIFIED`，不推断副作用未发生。
- 已依据用户提供的安装日志修复运行时切换补偿：OpenClaw 安装失败时，只有切换前经所选端点确认运行的 Gateway 才允许恢复；未运行的 Native Gateway 不再触发第二条“未找到 OpenClaw”启动错误。
- 已删除 Native 首次安装对 npm 默认全局前缀的隐式写入：只有用户明确选择 OpenClaw npm 安装目录才会执行 npm 安装，npm 缓存覆盖也绑定该选择；未配置时不会建议改动系统 npm 前缀。
- 已更新并核对 OpenClaw 官方主线提交 `75c44b2b98d508593b71501da80c12aa63a7e672` 的插件注册、`activation.onStartup`、service 启动、RPC 注册、`tools.effective`、`tools.invoke` 和官方审计边界。
- 本机运行证据确认 Gateway 正常启动，真正失败点是协作数据库 schema 13 与当前固定插件 schema 15 不兼容。
- 新增结构化插件启动失败：schema 不兼容返回 `DATABASE_SCHEMA_UNSUPPORTED`，其他启动失败返回已脱敏的 `SERVICE_START_FAILED`。
- service 未创建时的协作 RPC 也返回 `SERVICE_START_FAILED`，不再回退到带英文原始消息的 `UNAVAILABLE`。
- 修正插件构造阶段异常逃逸，确保数据库构造失败也会被 RPC 能力探针读取。
- 新增真实旧 schema 数据库回归测试，证明失败后数据库仍保持 schema 13，不迁移、不删除、不覆盖。
- 前端能力读取不再吞掉错误，按当前 Gateway 连接和运行时身份原子发布结构化失败。
- 精确目标重启进入唯一 Gateway 生命周期协调器，等待新连接和身份核验；预期断连期间不再触发全局 Gateway 启动失败和通知。
- 删除 28、58、82 等固定百分比。只有真实 Gateway 进度事件存在时显示数值，否则显示不确定进度。
- 协作设置对话框和协作办公室使用同一结构化错误语义，并提供打开修复入口。
- schema 不兼容且安装事务可恢复时，只提供恢复安装前插件和配置的精确回滚，不自动迁移或清理数据。
- 简体中文、繁体中文和英文主提示及协作设置所需键已补齐；原始运行时诊断和阻断原因不会作为主提示展示。
- 协作固定包和元数据已重新生成。
- 已把 OpenClaw 官方仓库更新到主线提交 `75c44b2b98d508593b71501da80c12aa63a7e672`，确认官方 Control UI 没有定义钉钉深链语义。
- 已核对 Tauri 官方 Opener 契约与 DWS 最新主线结构化审批模板：模板必须带 `approveType`、`formName`、`processCode` 与 `submitUrl`；`submitUrl` 只能经系统默认处理器打开，不能由 JunQi 推断执行成功。
- Chat 与 Markdown 文件预览现在复用同一桌面外部链接运行时；Markdown 会保留两个已核验的钉钉路径，其他自定义协议失败关闭。
- 已删除 Tauri Shell 的旧外链路径，统一迁移到官方 Opener `openUrl`；能力范围只允许 HTTP、HTTPS、邮件、电话及 `dingtalkclient` 的两个已核验钉钉路径。桌面打开失败时显示本地化错误，不再静默回退到 WebView `window.open`。
- 钉钉工具详情只在当前结果严格包含完整 DWS 审批模板且提交地址通过同一外链分类时显示“可用提交入口”；原始结果仍保留，非模板或不安全地址不会生成按钮。
- 钉钉工具 schema 读取增加 Session、工具和请求代次围栏；晚到响应不能覆盖当前工具详情。
- Session 切换会重建钉钉工作区本地状态，Profile 切换会清空参数草稿和旧输出，避免跨身份复用业务参数。
- DWS 启动增加同步忙碌门禁和本地 `starting` 状态；没有官方操作标识时不再生成伪造标识，终态事件缓存有界并可释放。
- 钉钉工具详情删除重复的账号权限和 Session 正常状态，只保留 OpenClaw 可证明的效果、风险和明确拒绝状态。
- 业务审计首次加载、读取失败、成功空结果和已有内容改为互斥状态；请求失败不再同时显示“尚无审计”。
- 业务审计页面的状态、筛选、错误和元数据标签已接入简体中文、繁体中文和英文资源。
- Session 运行时模型目录与后续运行参数拆成独立滚动区；供应商列和模型列各自滚动，模型可按名称、别名或完整 id 筛选，底部操作保持可达。
- 活动审计仅在当前握手未通告 `audit.activity.list` 时，才把旧 Gateway 的精确 `missing scope: operator.admin` 冻结响应识别为能力不支持；握手已通告该方法时保留失败事实，也不查询另一套审计协议。
- Session 运行时弹层接入共享视口碰撞宿主；模型目录与运行参数改成互斥页签，默认把完整主体高度留给模型目录。
- 删除了模型选择器对具体 Tailwind 字符串的脆弱测试，保留领域行为和共享视口碰撞测试。
- 钉钉工具目录、详情、Profile 选择、插件安装进度和官方文档入口的固定客户端文案均接入中、繁、英资源；DWS 和 OpenClaw 的动态数据、动态错误仍保持原样。
- 当 DWS 已返回 schema 但参数 JSON 无效或缺少必填字段时，详情自动展开 JSON 输入区域；字段含义仍完全以 DWS schema 为准，不生成本地表单规则。
- 客户端可识别的 DWS schema 投影损坏使用稳定错误码并按当前语言显示；Gateway 或 DWS 的运行时诊断不被客户端翻译或覆盖。
- 工作台官方说明链接现在通过受控的 Tauri 外链打开器交给系统；失败时在当前界面通知，不再静默调用 WebView 打开器。
- 同一 Session 的官方活动审计在刷新失败时保留已确认的记录与分页游标；只有断开连接或缺少 Session 时才清空该范围，失败状态在现有列表内就近提示。
- 钉钉插件 Agent 门禁改为以当前 Session 实际调用 `junqi_dingtalk_runtime_status` 成功为准；`tools.effective` 仅表示目录可见，不再单独标记为 Agent 已授权。
- 会话模型目录弹层使用稳定的视口尺寸约束；供应商列和模型列均为独立、可聚焦的滚动区域，并显示当前筛选结果数量。模型目录与运行参数保持互斥页签，避免参数区挤占模型列表。
- 业务审计页现绑定精确 Session key；切换会话后不会展示或在失败时保留上一会话的官方账本与分页游标。
- Gateway 断开时同步撤回当前 Session 已读取的官方审计页、游标和加载更多状态；“账本读取失败”与“成功空账本”保持互斥，并明确不代表钉钉业务调用终态。
- 活动审计继续优先 `audit.activity.list`；仅在官方定义的活动账本缺失且查询仅涉及运行或工具元数据时，受限重试官方 `audit.list`，并把返回页明确标记为兼容工具账本。消息、方向或渠道筛选及任何实际读取失败绝不回退。
- 已删除无消费者且直接调用旧 `audit.list` 的聊天审计 Hook 与展示组件，聊天追溯改为复用统一审计客户端并传递真实账本来源。
- 钉钉工具目录只接受连接、Session 和 `tools.effective` 修订均匹配且已结算的 DWS 身份快照；工具策略刷新期间不再复用旧 Profile 或保留旧执行入口。
- 删除没有 DWS 官方结果 schema 依据的审批追溯、自动二次查询和本地状态合成；审批工具结果仅按官方原始输出展示。
- Chat 中的 DWS 提交链接明确标注目标为钉钉桌面客户端，点击后在链接附近区分“已交给系统”与“系统拒绝打开”；前者不宣称钉钉页面已经打开。多 Agent 协作授权目标同步改用共享主题化 Select，避免原生下拉菜单破坏亮暗主题。
- 钉钉工作台的 DWS 提交入口现在复用同一真实语义：系统接手后就近显示本地化提示，失败显示错误；不再让成功返回静默恢复按钮，也不声称钉钉页面已经打开。

## 关键技术决策

- 代理所在本地环境不是项目或目标机器的证据来源。任何任务均不得以本地 Node.js、npm、pnpm、PATH、已安装依赖、运行进程、凭据、配置、网络、操作系统、用户目录、命令输出或工具版本形成结论、选择实现或报告验证；证据只可来自用户材料、受版本控制的仓库内容、目标系统可复现证据和上游官方契约。
- Gateway 连接错误不是本次根因；协作 service 在打开持久化数据库时失败，RPC 仍可用于返回结构化启动诊断。
- schema 13 到 15 包含结构删除，不能通过修改版本号安全升级。
- 仓库禁止历史迁移和兼容 fallback，本次不增加迁移器，也不自动删除用户数据。
- 当前安全恢复路径是使用安装事务保存的准确旧插件和配置执行回滚。若要采用 schema 15，需要另行定义并明确授权新的数据处置流程。
- Gateway 重启、连接恢复和身份核验继续只经过 `GatewayLifecycleCoordinator`。
- 钉钉深链只是 JunQi 对 OpenClaw Markdown 的受限桌面呈现，不改变 OpenClaw transcript、工具结果或 DWS 业务状态。
- 自定义协议必须同时通过前端协议、主机、路径和危险字符校验，以及 Tauri Opener 的最小 URL scope 校验；桌面打开失败不能伪装为浏览器打开成功。
- 审计兼容不是客户端本地 fallback：两个分支都读取 OpenClaw 官方账本，且旧账本始终以 `legacy` 来源暴露，不与活动账本或本窗口投影混用。

## 核心文件

- `packages/junqi-collab/src/database-schema-initializer.ts`
- `packages/junqi-collab/src/index.ts`
- `packages/junqi-collab/src/rpc.ts`
- `src/services/gateway/GatewayLifecycleCoordinator.ts`
- `src/stores/collaborationSetupStore.ts`
- `src/components/Collaboration/CollaborationSetupDialog.tsx`
- `src/pages/AgentHub/AgentHubOfficePanel.tsx`
- `src/runtime/desktopExternalLink.ts`
- `src-tauri/capabilities/default.json`
- `src/business-applications/dingtalkToolRequestCoordinator.ts`
- `src/business-applications/dwsOperationLifecycle.ts`
- `src/components/BusinessApplications/businessActivityPresentation.ts`
- `src/components/BusinessApplications/BusinessActivityList.tsx`
- `src/components/BusinessApplications/DingTalkToolDetail.tsx`
- `src/components/BusinessApplications/dingTalkSubmitLinkPresentation.ts`
- `src/components/BusinessApplications/DingTalkReadinessPanel.tsx`
- `src/components/BusinessApplications/dingTalkReadiness.ts`
- `src/hooks/useDingTalkBusinessAudit.ts`
- `src/services/gateway/OpenClawAuditClient.ts`
- `src/components/Chat/chatResponseTrace.ts`
- `src/business-applications/dingtalkRuntimeIdentityCoordinator.ts`
- `src/stores/dingTalkRuntimeIdentityStore.ts`
- `src/business-applications/dingtalkTools.ts`
- `src/components/Chat/session-runtime/SessionRuntimeControl.tsx`
- `src/components/Chat/ChatPendingApprovalsStrip.tsx`
- `src/components/Chat/ProgressCard.tsx`
- `packages/junqi-dingtalk/src/index.ts`
- `packages/junqi-dingtalk/src/dws-runner.test.ts`
- `src-tauri/resources/dingtalk/junqi-dingtalk.tgz`
- `src/generated/dingtalkPluginBundle.generated.json`
- `src/components/Chat/ChatMarkdownRenderer.tsx`
- `src/components/FileExplorer/MarkdownPreview.tsx`
- `src-tauri/src/commands/setup/node.rs`
- `src/hooks/useSetupFlow/useSetupInstallers.ts`
- `src/hooks/useSetupFlow/nodeRuntimePreparation.ts`
- `src/hooks/useSetupFlow/nodeRuntimePreparation.test.ts`
- `src-tauri/tauri.conf.json`
- `docs/quality/collaboration-service-startup-failure-audit-2026-08-21.md`
- `docs/quality/dws-install-and-workspace-recovery-2026-08-19.md`
- `docs/quality/dingtalk-workbench-state-audit-2026-08-21.md`
- `docs/quality/business-audit-and-model-picker-state-audit-2026-08-21.md`
- `specs/2026-08-21-collaboration-service-startup-failure.md`
- `plans/2026-08-21-collaboration-service-startup-failure.md`
- `docs/quality/target-runtime-node-resolution-2026-08-24.md`
- `specs/2026-08-24-target-runtime-node-resolution.md`
- `plans/2026-08-24-target-runtime-node-resolution.md`
- `docs/quality/target-environment-evidence-code-audit-2026-08-24.md`
- `specs/2026-08-24-target-environment-evidence-bugfix.md`
- `plans/2026-08-24-target-environment-evidence-bugfix.md`

## 测试与验证

- 本轮 `pnpm lint` 通过：模块边界、版本一致性和 TypeScript 类型检查均通过；安装预检定向测试 5 项通过；`git diff --check` 通过。
- 本轮 Codex 对照交互定向回归 4 项通过，覆盖审批跨会话汇总与进度卡来源、更新时间；`pnpm lint`、`git diff --check` 和本次完整修改文件的 Emoji 扫描通过。
- 本轮完整 `pnpm test` 通过。构建前的钉钉插件夹具与工具规格错误修复后，钉钉插件 23 项测试及 TypeScript 构建通过；完整 `pnpm build` 通过并重新生成协作、钉钉插件资源，随后 `pnpm lint` 与 `git diff --check` 再次通过。
- 本轮 `cargo fmt -- --check`、`cargo check --lib` 与 `cargo test --lib` 通过，Rust 库测试为 658 项通过、1 项忽略。`pnpm tauri build --bundles dmg --no-sign` 成功，并由 `hdiutil verify` 验证生成的 DMG。
- 本轮目标运行环境 Node.js 展示、安装闭包、安装引导与进度参数定向回归 122 项通过；三语 JSON 解析通过，修改文件与完整修改文件的 Emoji 扫描通过。
- 本轮 `cargo fmt -- --check`、`cargo check --lib`、`pnpm lint` 和 `git diff --check` 通过。`pnpm lint` 同时覆盖模块边界、版本一致性和 TypeScript 类型检查。
- 协作插件完整测试通过。
- 本轮协作空态、结构化失败、本地化与主提示隔离定向回归 47 项通过；`pnpm exec tsc --noEmit` 与 `git diff --check` 通过。
- 定向前端回归通过，覆盖结构化错误透传、统一重启、数据保护、本地化错误、无假百分比和办公室修复入口。
- 钉钉深链定向回归 11 项通过，覆盖两个受限路径、危险协议、伪造主机和路径、桌面打开失败及浏览器失败关闭。
- `pnpm lint` 通过：模块边界扫描 938 个生产文件、版本一致性和 TypeScript 类型检查无错误。
- `pnpm test` 通过：前端、源码和脚本全量测试均无失败。
- `pnpm collab:validate` 通过。
- `pnpm build` 通过：协作与钉钉固定包契约有效，Vite 转换 9316 个模块。
- `pnpm tauri build --no-bundle` 通过，Tauri 接受受限 Shell 正则并生成本机 release 应用二进制；未生成安装包。
- `pnpm verify:openclaw-docs` 通过。
- `git diff --check` 通过。
- 业务审计互斥状态、DWS 启动门禁、异步请求围栏、终态缓存回收和模型选择器既有运行时契约的定向测试通过。
- 本轮审计与模型弹层定向回归 20 项通过；`pnpm lint`、`pnpm test`、`pnpm build` 和 `git diff --check` 再次通过。
- 本轮钉钉工作台、审计、模型目录与桌面外链定向回归 46 项通过；`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check` 均再次通过。
- 本轮审计账本保留、Agent 运行时门禁与模型目录定向回归 24 项通过；`pnpm lint`、`pnpm test`、`pnpm build` 和 `pnpm verify:openclaw-docs` 通过。
- `pnpm dingtalk:test` 通过，钉钉插件 21 项契约测试无失败。
- 本轮提交入口定向回归 19 项通过，覆盖 DWS 完整模板投影、重复入口过滤、钉钉路径、危险协议、桌面打开失败与浏览器失败关闭。
- 本轮审计 Session 隔离、失败空态与模型目录定向回归 25 项通过；`pnpm exec tsc --noEmit` 与 `git diff --check` 通过。
- 本轮 `pnpm lint`、完整 `pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、`cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib` 与 `git diff --check` 通过。
- 本轮钉钉身份修订门禁、断连审计收敛、审批结果边界、模型目录和钉钉深链定向回归 50 项通过；`pnpm lint`、`pnpm dingtalk:test`、完整 `pnpm test`、`pnpm build` 与 `git diff --check` 通过。
- 本轮活动审计旧协议回退、Session 隔离与聊天追溯定向回归 17 项通过；`pnpm lint` 通过。完整测试和生产构建待本轮文档收口后执行。
- 本轮钉钉深链、DWS 授权失败和操作单飞定向回归 12 项通过；`pnpm lint` 通过。真实 Tauri WebView 的钉钉系统协议启动仍待人工验证。
- 本轮完整 `pnpm test`、`pnpm build`、`pnpm lint`、`pnpm verify:openclaw-docs` 与 `git diff --check` 通过。审计失败不会显示为成功空账本；模型目录与运行参数分别占用独立滚动区域。
- 本轮钉钉提交入口状态投影、DWS 模板投影、桌面外链、Chat 深链与三语资源定向回归 22 项通过；`pnpm lint`、`git diff --check`、三语 JSON 解析与本次修改文件的 Emoji 扫描通过，系统接手反馈与打开失败保持互斥。

## 已知问题与未验证边界

- 本轮未运行完整 `pnpm test`、Rust 测试或生产构建；未在真实 Gateway 或 Tauri WebView 验证待处理审批提示条与进度卡在亮暗主题、窄窗口、键盘焦点和减少动态效果下的完整序列。
- 当前 DMG 使用 `--no-sign` 本地打包，未进行 Apple Developer ID 签名、公证、updater 签名或目标机器安装验收；不能作为正式发布制品。
- 尚未在 Windows、macOS 与 Linux 的干净目标机器上分别验证：已有兼容 Node.js 复用、已存在不兼容 Node.js 的三语提示、版本管理器 PATH 选择、系统安装器权限和安装前二次复核。当前自动化与本机静态检查不替代这些目标平台验收。
- 尚未在真实 Tauri WebView 中连续验证 schema 不兼容提示、精确回滚、Gateway 重连和回滚后旧插件恢复。
- 亮色、暗色、护眼主题、窄窗口、键盘焦点和减少动态效果尚未完成真机视觉验收。
- Windows 和 Linux 的真实服务重启与回滚尚未验证。
- 尚未在重新构建的真实 Tauri WebView 中点击 DWS 返回的实际钉钉提交入口并验证系统接手提示；macOS 钉钉客户端跳转、Windows 协议注册和未安装钉钉时的系统行为仍待真机验证。
- 尚未在真实 Gateway 上连续验证审计失败、成功空结果和本窗口投影并存的完整切换序列。
- 尚未在真实 Tauri WebView 中用长模型列表验证鼠标、触控板和键盘滚动到最后一项；本地浏览器控制插件因当前入口引用已清理的旧版本内部文件而无法建立测试连接。
- 尚未在真实旧 Gateway 上复现 `unknown method` 或未通告状态下的 `missing scope: operator.admin`，并确认兼容工具账本来源提示；自动化已覆盖这两种精确结构化响应及禁止消息回退。
- 尚未在真实桌面应用中确认长模型目录的模型列能够滚动至末项，也未连续验证钉钉详情自动展开参数输入和官方文档外链失败反馈；自动化仅覆盖其数据与结构契约。
- 当前机器的浏览器控制入口引用了已清理的旧版本内部文件，无法替代真实 Tauri WebView 验收；模型目录、审计刷新失败保留和 Agent 运行时门禁仍需在安装后的桌面应用中验证。
- 本轮链接交互复用既有 `aegis-*` 主题 token、共享 Button 与通知组件；亮色、暗色、护眼主题、窄窗口和键盘焦点仍待真机视觉验收。
- 本轮没有生成 Tauri 安装包，没有正式签名、公证、提交、标签或线上发布。
- 工作树原有未跟踪目录 `.pnpm-store/` 和 `outputs/` 不属于本任务，保持不动。

## 失败方案

- 仅重启 Gateway 无法修复 schema 不兼容，只会重复得到同一 service 启动失败。
- 将固定进度作为安装状态会把等待误报为进展，已删除。
- 把能力探测错误转换为 `null` 会丢失根因，已改为保留结构化错误。
- 直接在协作安装流程调用专用重启会绕过统一生命周期，已改为协调器内执行精确目标重启。
- 自动修改 schema 版本、迁移或删除数据库都不具备安全和授权依据，本次未采用。
- 只保留链接样式不能修复问题，因为 `react-markdown` 默认转换会清空 `dingtalk://`，而旧 Shell 打开路径也不能提供当前官方的 Opener 契约。
- 桌面打开失败后调用 `window.open` 只会掩盖错误，已删除该伪降级并改为就近本地化反馈。
- 把官方审计读取失败放在“尚无审计”的描述中会把未知结果误报为空结果，已改为互斥状态。
- 让模型目录和全部运行参数共享一个外层滚动区会造成裁切和滚动目标不清，已拆成独立滚动边界。
- 不加握手条件地把 `missing scope: operator.admin` 归类为旧协议不支持会掩盖已通告方法的真实失败；JunQi 现在只在官方指定的未通告前提下采用该分类。
- 用源码字符串断言弹层宽度和类名只会约束写法，无法证明可达性；该守护已删除，由领域行为测试、共享碰撞算法测试和待完成的真机视觉验收共同覆盖。

## 下一步顺序

1. 在真实 Gateway 和 Tauri WebView 验证审批提示条、进度卡元信息、执行过程与活动中心审批面板的连续状态；覆盖亮暗主题、窄窗口、键盘焦点和减少动态效果。
2. 在 Windows、macOS 和 Linux 的目标机器上分别验证已有兼容 Node.js 的无下载复用、已存在不兼容 Node.js 的版本范围提示、系统安装器权限和安装前二次复核。
2. 在重新构建的真实桌面应用中点击 DWS 返回的请假提交入口，确认系统收到 Opener 打开请求；同时验证未安装客户端和无默认协议处理器时显示本地化错误。
3. 在真实 Gateway 上验证业务审计读取失败、成功空结果、已有官方记录和本窗口投影四种互斥状态，确认刷新失败不会清空已确认记录。
4. 用包含大量模型的真实 Session 验证模型列滚动到底、搜索、参数区独立滚动和底部操作可达，并覆盖三种主题与窄窗口。
5. 在真实桌面应用中打开协作设置，确认 schema 不兼容显示本地化错误且不再出现固定百分比和全局 Gateway 启动失败。
6. 执行精确回滚，验证旧插件与配置恢复、Gateway 重连以及既有协作数据仍可读取。
7. 根据用户后续指令决定是否提交、打包或设计明确授权的数据重置流程。
8. 在目标系统验证公开 npm 元数据解析、目标 npm 配置解析、Node.js 安装前目标契约门禁，以及 DWS 写操作的预先中止和启动后中止待核验语义。
