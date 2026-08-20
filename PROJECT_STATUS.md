# 项目交接状态

更新时间：2026-08-20

## 当前目标

收敛会话进度空态、钉钉接入页的 Gateway 所有权误判、DWS 多账号入口、协作办公室配置入口与钉钉登录身份、Session 策略、业务权限三层展示，并定位聊天输入卡顿链路。当前已修复钉钉工作台工具目录与 DWS Profile 异步探测造成的错误空态闪烁，并重新生成本地 Apple Silicon DMG。输入性能问题已完成静态根因核对，尚未实施修复或真机性能录制；当前公开 Release 仍不包含本轮修复。

## 已完成内容

- 核对 OpenClaw 官方主线提交 `70b6f44f13e5a4c0c860e5412b9b5c3bb2272b1d` 的协议、Gateway、Android、iOS 和 macOS 客户端实现。
- 确认已发布 Gateway 仍使用官方 `agent` 事件的 `stream: "plan"`，而 JunQi `v3.2.1` 只读取 `progressCard.get`，导致用户环境中的计划 UI 实际不可达。
- 新增旧发布计划流的严格解码和临时进度卡投影，不读取 transcript，不从工具回执推断计划终态。
- 新增按物理连接绑定的兼容门禁：能力未知时暂存，精确未知方法后启用旧流，持久化读取成功后忽略双发旧流，重连后清空派生状态。
- 修正 `progressCard.changed`：只接受正安全整数或 `null`，`null` 立即清空并使在途旧读取失效，相同修订不重复读取。
- 计划 UI 继续位于输入区上方，默认显示紧凑进度按钮，点击或键盘激活后展开步骤详情；复用当前主题和共享组件。
- 新增规格、实施计划和运行时契约审计记录。
- 删除没有真实 OpenClaw 进度卡时的读取失败占位、无消费者错误状态和三种语言的失效文案；读取暂时失败时只结束加载并保留同一连接内此前已核验的卡片。
- 修复本机所选官方 Gateway 服务的身份竞态：当前选择为 Native、观测端点为本机所选端口且内存模式仍为 `None` 或 `External` 时，再次只读核验官方服务归属；确认运行且属于当前状态后按 `SystemService` 解析。
- 本机复现确认 `ai.openclaw.gateway` LaunchAgent、服务工作目录、状态目录和配置路径均属于 JunQi 当前选择，原“外部或远程 Gateway”提示不符合实际所有权。
- 核对 DWS 官方最新 README：`auth login` 可新增或刷新账号，`profile list` 返回全部已登录账号，`profile switch <corpId:userId>` 才持久切换当前账号。
- DWS 身份区在已有当前账号时新增“添加账号”，单账号状态明确说明没有其他可切换目标；当前账号在下拉项中标记，重复切换保持禁用并提供原因。
- 协作办公室顶栏新增“配置协作许可”，直接打开现有协作设置对话框；协调 Agent 和允许列表仍由统一 capability/configure 链路核验，不在工位卡片直接写配置。
- 完成聊天输入链路静态核对：IME 组合输入期间每次 `onChange` 都会先写入全局 `chatStore.drafts`；`App`、`ChatTabs` 和 `MessageInput` 等仍存在无 selector 的全 Store 订阅，因此每个预编辑更新会扩大为多个大型组件重渲染。
- 确认输入变化不触发磁盘、Gateway 或网络调用；次要同步开销来自每次草稿变化后将 textarea 高度清零、读取 `scrollHeight` 并重新写高，可能造成强制布局。当前证据指向 JunQi 渲染边界，输入法只会放大组合输入更新频率。
- 核对当前 DWS `oa approval list-pending` 契约：`start` 和 `end` 是必填 ISO-8601 查询时间边界。工具详情目前只展示 schema 摘要，把唯一可编辑的参数 JSON 藏在“高级参数与运行时契约”内，因此必填提示缺少就近输入入口，属于 JunQi 表单呈现问题，不是审批权限或 DWS Profile 错误。
- DWS Profile 下拉已替换为共享 Radix Select，弹层、边框、焦点和当前账号标识统一使用 `aegis-*` 主题 token，不再出现 macOS 原生蓝色菜单。
- 钉钉工作台改为三层证据：所选 DWS Profile 必须是官方 `active` 登录状态才展示插件操作目录；Session 列只表示“已暴露”或“策略已拒绝”；账号业务权限始终显示“调用时核验”。已删除未被官方填充为业务权限的 `authorizedDomains` 前端投影，不再把插件目录称为当前账号已拥有的能力。
- 修复钉钉工作台首屏竞态：DWS 身份快照绑定当前 Gateway `connectionId` 与 OpenClaw `sessionKey`，区分加载、结算和错误；切换上下文后丢弃旧请求结果，Profile 未结算时不再发布“当前账号没有可展示的操作”。官方当前 Profile 在同一渲染内直接作为执行身份，不再等待本地选择状态的后续 effect。

## 关键技术决策

- `progressCard.get` 与 `progressCard.changed` 仍是持久化权威链路；`stream: "plan"` 只是在真实 RPC 已证明持久化方法不存在时启用的官方运行中兼容投影。
- 不依据版本号或 `hello-ok.features.methods` 的缺失判定能力。只有当前已认证连接的结构化 RPC 结果可以切换兼容模式。
- 旧发布计划流不写入 transcript、不伪造工具结果、不定义新的任务状态机；本地修订号只服务同一连接内的稳定渲染。
- `revision: null` 是权威清空事实，不能再等待额外 RPC；在途读取和已排队刷新必须被围栏拦截。
- 可选进度读取失败不代表存在失败任务，只有 OpenClaw 返回真实卡片时才占用聊天输入区上方空间。
- WebSocket 端点健康和系统服务归属是两份独立证据。只有本机端点、所选 Native runtime 和官方服务归属三者同时匹配时，瞬时 `External` 快照才能提升为可管理的系统服务身份。
- 本轮修改 Rust 身份解析，但没有新增 Tauri command、安装器或发布配置；本地安装验证仍使用仓库既有的无 updater 制品配置，不改变正式发布配置。
- 多账号添加继续复用既有 DWS `Authorize` 操作，协作入口继续复用 `CollaborationSetupDialog`；两处都没有新增 RPC、Profile 存储或协作状态机。
- DWS 官方 `profile list` 仅提供精确 Profile 与登录状态，当前主线不提供可覆盖审批、考勤等业务操作的全局权限清单。JunQi 因此只能用登录状态作目录入口门禁，不能在调用前猜测用户是否拥有某项钉钉业务权限。
- 多探针页面必须按连接与 Session 上下文原子发布业务状态；`null` 只表示结果尚不可用，不能在探针结算前直接解释为未登录终态。

## 核心文件

- `specs/2026-08-20-openclaw-progress-card-release-compatibility.md`
- `plans/2026-08-20-openclaw-progress-card-release-compatibility.md`
- `docs/quality/runtime-contract-convergence-audit-2026-08-20.md`
- `src/progress-card/domain.ts`
- `src/runtime/OpenClawChatEventRuntime.ts`
- `src/services/gateway/OpenClawProgressCardClient.ts`
- `src/services/gateway/progressCardEventBridge.ts`
- `src/stores/progressCardCompatibilityGate.ts`
- `src/stores/progressCardRefreshGate.ts`
- `src/stores/progressCardStore.ts`
- `src/components/Chat/ProgressCard.tsx`
- `src/pages/ChatView.tsx`
- `src-tauri/src/commands/runtime_identity.rs`
- `src/business-applications/dwsProfileSelection.ts`
- `src/business-applications/dingtalkTools.ts`
- `src/components/BusinessApplications/DingTalkRuntimeIdentity.tsx`
- `src/components/BusinessApplications/DingTalkReadinessPanel.tsx`
- `src/components/BusinessApplications/DingTalkProfileSelect.tsx`
- `src/components/BusinessApplications/DingTalkToolDetail.tsx`
- `src/components/BusinessApplications/DingTalkToolTable.tsx`
- `src/pages/AgentHub/AgentHubOfficePanel.tsx`

## 测试与验证

- 进度卡空投影和三语言键集合定向测试共 4 项通过。
- 运行时身份定向 Rust 测试 9 项通过，覆盖本机所选服务提升、远程端点隔离和未确认服务保持外部身份。
- `pnpm lint` 通过：模块边界扫描 933 个生产文件，四处版本一致，TypeScript 类型检查无错误。
- Profile 下拉、Profile 登录门禁、Session 状态和账号权限语义定向测试 18 项通过；追加改动后的 `pnpm lint` 通过，模块边界扫描 934 个生产文件，四处版本一致。
- Profile 下拉与三层权限语义改动后的 `pnpm build` 通过：协作与钉钉插件包契约有效，Vite 转换 9312 个模块。
- `pnpm test` 完整通过。
- `pnpm build` 通过：协作与钉钉插件包契约有效，Vite 转换 9311 个模块。
- `cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib` 通过；Rust 656 项通过，1 项忽略。
- `pnpm verify:openclaw-docs` 通过。
- `pnpm tauri build --config src-tauri/tauri.no-updater-artifacts.conf.json` 通过，生成 `JunQi Desktop_3.2.1_aarch64.dmg`。
- 最终 DMG 修改时间为 `2026-08-20 19:27:58 +0800`，大小为 `8368384` 字节；经 `hdiutil verify` 校验有效，SHA-256 为 `166af3656fb460a1fca638fdf1609f6d6977583ff7239bf6fae30954dd854ae1`。
- 安装包内二进制确认为 Apple Silicon `arm64`，应用短版本和构建版本均为 `3.2.1`。
- 应用仅为 ad-hoc 签名，未绑定开发团队，也未完成 Apple 公证。
- `git diff --check` 通过。
- DWS Profile 与协作办公室定向测试 16 项通过，覆盖单账号不可重复切换、其他账号可切换、三类配置工位和统一协作配置入口。
- 本轮追加改动后的 `pnpm lint` 通过：模块边界扫描 933 个生产文件，四处版本一致，TypeScript 类型检查无错误。
- DWS Profile 原子发布定向测试 20 项通过，覆盖探针未结算保持加载、加载态不渲染账号无操作终态、结算后未登录空态和 `active` Profile 目录；追加改动后的 `pnpm lint` 通过，模块边界扫描 934 个生产文件，四处版本一致，TypeScript 类型检查无错误；`pnpm build` 通过，协作插件和钉钉插件包契约有效。

## 已知问题与未验证边界

- 尚未连接真实 `2026.7.1-2` Gateway 运行一次会产生计划更新的会话，因此旧计划流的真机展示仍未验证。
- 尚未连接支持 `progressCard.get` 的最新 Gateway 验证双发抑制、持久化恢复和 `revision: null` 清空。
- 亮色、暗色、窄窗口、键盘焦点、长计划滚动和动态岛同步尚未完成连续真机视觉验收。
- 本地浏览器验收入口未发现可用浏览器实例，因此本轮没有交互截图或连续抓帧证据。
- 当前公开 `v3.2.1` Release 不包含本轮修复；最新本地 DMG 已包含进度空态、Gateway 身份再核验、DWS 多账号、钉钉三层权限语义和 Profile 原子发布修复，但尚未打标签或发布新版本。
- 本地 DMG 未使用 Apple Developer 证书签名或公证，只能作为本机安装验证产物，不能作为正式发布包。
- 新构建安装后仍需在真实钉钉接入页核验本机身份提示消失、DWS 就绪状态保持以及插件维护操作恢复可用。
- DWS“添加账号”和办公室“配置协作许可”尚未在真实桌面应用中完成点击、OAuth、多账号切换和配置保存的连续验收。
- 聊天输入性能尚未用 React Profiler 或 Instruments 在真机连续录制；当前结论基于完整输入调用链和 Store 订阅边界，修复前仍需记录中文组合输入与纯英文输入的提交时长基线。
- 钉钉工具详情尚未按 DWS 叶子 schema 生成可编辑表单；当前只能展开高级区域手工填写参数 JSON，必填时间、类型、格式和错误反馈不够直接。
- 新 Profile 下拉尚未在真实 Tauri WebView 中完成亮色、暗色、窄栏、键盘方向键、Escape 关闭和焦点返回验收。
- DWS Profile 原子发布修复已进入最新本地 DMG，但尚未在真实 Tauri WebView 连续抓帧验证加载态到目录的过渡。
- 尚未使用真实无审批权限与有审批权限的两个 DWS Profile 分别执行同一工具；自动化只证明展示不会伪报已授权，不证明真实钉钉 RBAC 结果。
- 工作树原有未跟踪目录 `.pnpm-store/` 和 `outputs/` 不属于本任务，已保持不动。

## 失败方案

- 直接按 `hello-ok.features.methods` 是否列出 `progressCard.get` 判断能力不符合 JunQi 的保守发现规则，已改为真实 RPC 证据门禁。
- 只处理 `revision: null` 的界面清空会被晚到读取覆盖，已增加请求修订围栏并丢弃旧排队刷新。
- 首次应用包含测试文件的组合补丁时因跨文件上下文不匹配失败，随后拆分为精确文件补丁，没有产生部分 UI 修改。
- 尝试启动本地浏览器交互验收时没有可用浏览器实例，未改用无关自动化工具伪造视觉结论。
- 首次通过 `corepack` 调用项目 pnpm 时发现当前 Node 环境不提供该命令；随后核对独立 pnpm 版本与项目锁定版本同为 `9.15.9`，再继续构建。
- 默认 Tauri 打包已生成应用和 DMG，但因缺少 updater 私钥在 updater 签名阶段退出；本地安装包改用仓库既有的无 updater 制品配置重跑并成功，未伪造签名。
- 仅凭健康端点把 Gateway 分类为 External 会误判同机官方服务；本轮复用现有服务归属检查，只在本机所选端点上补充身份再核验。
- 首次定向测试命令未加载仓库 `test-setup.ts`，导致 CSS Module 和 i18n 测试环境错误；改用项目正式测试启动参数后，相关 16 项测试通过。
- 首次直接对整个钉钉详情面板做 SSR 测试时遇到共享 Button 的 CSS Module 导入限制；随后把 Profile 选择器拆为独立交互组件。Radix 为无障碍表单保留隐藏原生 select，回归测试改为验证可见的 combobox 按钮和无障碍名称，不再把隐藏节点误判为系统原生菜单。
- 两次组合补丁因长距离上下文不匹配被 `apply_patch` 原子拒绝，均未产生部分写入；随后按相邻语义块拆分并完成修改，细节已记录在 `.learnings/ERRORS.md`。

## 下一步顺序

1. 安装并启动最新本地 DMG，验证 DWS 添加第二账号、切换当前账号和单账号退出。
2. 从协作办公室打开配置对话框，验证协调 Agent 与允许列表保存后工位分区随权威 capability 刷新。
3. 在钉钉接入页重新连接本机官方服务，核验运行时身份不再显示外部或远程，同时确认远程 Gateway 仍保持不可修改语义。
4. 完成亮色、暗色、窄窗口、键盘和长内容视觉验收，再决定提交、版本号、标签与 Release。
5. 对聊天输入做真机性能基线，随后将草稿保留在输入组件局部状态、按会话边界同步，并把 `App`、`ChatTabs`、`MessageInput` 等全 Store 订阅改为精确 selector；高度测量合并到每帧一次后补充中文 IME 回归测试。
6. 将钉钉工具 schema 摘要替换为就地参数表单，按 DWS 返回的 `type`、`required` 和属性名生成输入控件；保留高级 JSON 作为同一草稿的结构化编辑视图，并为 `start`、`end` 提供 ISO-8601 时间输入与明确时区。
7. 安装最新本地 DMG，在真实 Tauri WebView 连续验收 Profile 探针加载到操作目录的过渡，并覆盖亮色、暗色、窄窗口和键盘焦点。
