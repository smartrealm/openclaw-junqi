# DWS 安装与工作区恢复审计

日期：2026-08-19

## 依据

- [DWS 官方 README](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/README.md) 将 `npm install -g dingtalk-workspace-cli` 列为 Node.js/npm 安装方式；登录仍由官方 `dws auth login` 或 headless 环境的 `dws auth login --device` 承担。
- 2026-08-20 核对 DWS 官方主线提交 `62d72ad84cb667379c02132148086bd984ea69c9`：`profile list` 的稳定身份是 `corpId:userId`，状态来自真实 token；可选 `authorizedDomains` 只是 Profile 元数据，主线没有把它填充为审批、考勤等业务权限清单。当前安装的 `v1.0.58` 真实输出同样不包含该字段。
- 2026-08-20 再次核对 OpenClaw 官方主线提交 `d5abaf4ab3a8d4741a2ec463eb4d3278102fc6f7`：`tools.effective` 是 `operator.read` 方法并允许启动阶段读取；对应 Gateway handler 明确要求 UI 查询只投影已预热的核心 Session 工具目录，不创建 MCP 运行时或额外连接。
- 2026-08-21 已刷新 OpenClaw 官方 `origin/main` 至 `75c44b2b98d508593b71501da80c12aa63a7e672`。官方 Control UI 仍只把 HTTP、HTTPS 与邮件协议呈现为普通 Markdown 外部链接，没有定义钉钉业务深链语义；JunQi 的钉钉链接处理因此属于受限桌面展示增强，不改变 OpenClaw transcript 或工具结果。
- 2026-08-21 核对 DWS 官方主线提交 `74b7690cbb67fc2baf681ad56a67ecb493f5cc07`：审批模板响应中的 `approveType`、`formName`、`processCode` 与 `submitUrl` 均为必填字段；官方说明要求将每个 `submitUrl` 以 Markdown 链接呈现，而不是让调用方自行拼接跳转地址。
- Tauri 官方 Opener 文档将 URL 交给系统默认应用的入口定义为 `openUrl`，并要求在 capability 中显式配置允许范围；Shell 文档已经将旧 `shell.open` 引导至 Opener。Opener 的 scope 支持 URL glob，JunQi 必须只放行已核验的 HTTP、HTTPS、邮件、电话及钉钉两个深链前缀。
- DWS 当前参考说明和本机结构化返回均证明业务跳转使用 `dingtalk://dingtalkclient/action/openapp` 或 `dingtalk://dingtalkclient/page/link`。核对只记录协议、主机与路径，没有保存查询参数、组织身份或用户身份。
- DWS 最新公开 npm `1.0.59` 的 `profile list`、`auth status` 与工具 schema 仍未提供覆盖审批、考勤、日历等业务域的账号权限清单。`dws pat chmod` 的批量计划只表达 PAT 行为授权，不等同于组织角色、数据范围或具体业务权限。
- JunQi 只在已核验的所选 Native 或 Docker OpenClaw 运行时中执行该安装命令，安装后以 DWS 的结构化 JSON 命令核验，不读取或展示凭据。
- Gateway 重启只通过 `gatewayLifecycle.restart` 协调；工作区入口以当前连接的 OpenClaw 会话快照为放行事实。

## 根因

`dws_operation` 原先只转发 npm 的标准输出和标准错误。npm 在下载或解析依赖的静默阶段不会产生行输出，界面只能永久显示“等待输出”。

同一操作的子进程若在前端收到 `start_dws_operation` 返回的 `operationId` 前结束，完成事件会先到达。旧页面丢弃了尚未关联当前弹窗的终态，随后把弹窗写为 `running`，没有任何后续事件可以收敛。

Gateway 重启后的数据轮询还存在独立缺陷：`sessions.list` 返回与重启前相同的会话投影时，数据层只清除 loading 而未更新 `lastFetch.sessions`。工作区首屏门禁将这个时间戳与本次 `connectionStartedAt` 比较，于是把已成功返回的当前快照误判为旧连接数据，持续显示“正在同步工作区”。智能体范围读取失败也会阻断会话读取，但旧失败判定没有将其作为可重试的首屏失败。

后续全量审查又确认终态发布仍有一处顺序缺口：子进程等待线程在命令退出后直接发送完成事件，两个独立输出读取线程可能尚未转发最后一批结构化诊断。授权失败恢复只能看到终态到达时的快照，因此会漏掉最后的凭据库错误。

2026-08-19 的本机安装包实测又确认了三项授权链路缺陷：

- `BUG-DWS-01`，高优先级：DWS 官方 CLI 会把授权地址和等待进度写入标准错误流，前端却为每一行标准错误增加“错误”前缀，导致正常进度被误报为失败。
- `BUG-DWS-02`，高优先级：授权输出中的长地址和结构化诊断参与对话框网格的最小内容宽度计算。日志容器缺少 `min-width: 0`、横向约束和任意位置断行，长行会把对话框内容推到视口外。
- `BUG-DWS-03`，高优先级：旧 `auth-token` 密文存在但系统凭据库中的数据加密密钥缺失时，DWS 会拒绝覆盖该登录槽位。旧界面只显示原始诊断，没有识别 DWS 的结构化 `auth` 错误，也没有提供官方 `dws auth reset` 的显式恢复入口。
- `BUG-DWS-04`，高优先级：DWS 浏览器回调在授权码换取 token 且组织权限检查通过后立即显示成功，CLI 随后才保存本机 token。JunQi 把后续持久化失败显示为笼统的“官方流程未通过”，没有解释网页成功只代表回调阶段完成；同时授权核验只拒绝 `success: false`，会错误接受 `success: true, authenticated: false`。
- `BUG-DWS-05`，中优先级：业务工具要求用户手填“租户身份”，没有使用 `profile list` 返回的精确 `corpId:userId`；工作台也没有官方 Profile 切换和单账号退出入口，全量重置因此容易被误解为普通退出。
- `BUG-DWS-06`，低优先级：DWS 用户资料未返回 HTTPS 头像时，界面用姓名首字母生成占位头像，与“不会显示猜测头像”的产品文案不一致。
- `BUG-DWS-07`，中优先级：钉钉业务审计读取失败时，Hook 丢弃错误类别并统一显示“账本不可用”，没有说明当前连接缺少 `operator.read`、Gateway 尚未支持 `audit.activity.list`、响应契约不兼容或普通请求失败的差异。
- `BUG-DWS-08`，高优先级：`tools.effective` 与 DWS Profile 身份由两条异步链路读取。工具目录先返回时，页面把尚未结算的 `runtimeIdentity === null` 当作未登录终态，先发布“当前账号没有可展示的操作”，随后又切换为完整目录；DWS 当前 Profile 返回后，本地选择状态还会晚一个 React effect，造成第二个短暂错误空态。
- `BUG-DWS-09`，高优先级：即使错误空态已经收敛，`tools.effective` 与 DWS Profile 仍在业务页挂载后才开始读取。用户进入页面时需要等待完整探测，连接和当前 Session 已经就绪的空闲阶段没有复用。
- `BUG-DWS-10`，中优先级：工具表格逐行显示“账号权限：调用时核验”和“Session：已暴露”，容易把插件操作目录理解为已授予账号的权限清单，并为每行重复相同边界信息。
- `BUG-DWS-11`，高优先级：DWS 返回的钉钉 Markdown 深链先被 `react-markdown` 默认 URL 转换清空；现有 Tauri Shell 默认范围也拒绝 `dingtalk://`。点击处理吞掉桌面错误并调用无效的 WebView `window.open`，最终留下一个有链接样式但没有任何反馈的入口。
- `BUG-DWS-12`，高优先级：修复后的聊天 Markdown 已能保留钉钉深链，但仍通过已被 Tauri 官方替代的 Shell `open` 调用系统处理器；钉钉工作台的直接工具执行结果则以 JSON `pre` 原样渲染，DWS 返回的 `submitUrl` 没有可点击入口。两条展示路径对同一个官方跳转契约产生了不一致的可达性。

`BUG-DWS-03` 的恢复不能自动执行。DWS 官方文档说明 `auth reset` 会清除本机全部登录配置；JunQi 只能在展示影响范围并取得二次确认后调用官方命令。若旧登录态仍可读取，应优先按官方迁移流程处理，不得用重置代替迁移。

## 目标行为

- DWS 子进程成功启动后立即发送本地派生的事实状态；每 15 秒发送一次仍在等待的实际时长。该状态不表示 npm 已完成，也不伪造百分比。
- 输出和完成事件按 `operationId` 缓存。页面建立该操作投影后消费已到达的终态，并只执行一次后续 DWS 配置、统一 Gateway 重启和刷新。
- 每个当前连接的成功 `sessions.list` 快照都更新会话读取时间，即使会话内容没有变化。
- 由于智能体范围是当前会话读取的前置条件，智能体请求在已结算后失败时，首屏显示可重试错误，不能无限显示同步中。
- DWS 命令退出后必须先等待标准输出和标准错误读取线程完成，再执行结构化核验和发送终态事件。
- 标准输出和标准错误只表示来源流，不表示业务成功或失败。授权过程的每一行均以中性诊断呈现；最终成功只服从 DWS 结构化核验和进程终态。
- DWS 输出对话框在窄窗口和长行下保持视口内布局，日志在固定边界内纵向滚动并允许任意位置断行。
- 对可识别的旧登录槽位不可读错误展示安全恢复说明。只有确认属于数据加密密钥缺失时，才提供“重置本机全部 DWS 登录态”的入口，并在二次确认后运行官方 `dws auth reset --format json --yes`；重置成功不等于重新授权成功。
- 浏览器回调已返回但本机持久化失败时，界面分别呈现网页阶段和本机阶段；授权完成必须由 `auth status` 的 `authenticated: true` 证明。
- 工具执行身份从 `profile list` 的精确 Profile 中选择。切换当前账号与退出单账号分别执行 DWS 官方 `profile switch` 和 `auth logout --profile`，并用新的 `profile list` 结果核验。
- 已经存在当前 Profile 时仍提供“添加账号”入口，并继续调用官方 `auth login`。DWS 官方允许该命令新增或刷新账号；JunQi 不在本地创建 Profile。只有 `profile list` 返回两个或更多真实账号时，选择器才存在可切换目标。
- DWS 未返回安全头像地址时显示通用用户占位图标，不生成姓名首字母头像。
- 业务审计优先调用最新版 OpenClaw 的 `audit.activity.list`。只有官方活动账本明确缺失且查询仅涉及运行或工具元数据时，才受限重试官方 `audit.list` 并标记为兼容工具账本；其他失败不回退，不以本窗口状态替代官方记录。
- DWS 安装完成后调用官方 `dws version --format json`，以非空 `version` 为安装终态。官方版本响应没有 `success` 字段，不能复用授权和 Profile 操作的成功结构。
- 顶栏紧凑身份只保留一个 DWS 头像和一组两级文本；姓名前的重复用户图标已删除，组织与姓名相同时次级文本回落到精确 Profile。
- 插件操作错误与授权结果从顶栏移入共享接入诊断面板，长文本在业务上下文内完整换行，顶栏只保留身份和刷新操作。
- Profile 选择使用项目共享的 Radix Select 与 `aegis-*` 主题 token，不再调用操作系统原生下拉菜单；当前账号继续由 DWS `profile list` 的 `isCurrent` 标识，不由客户端推断。
- `tools.effective` 只证明插件操作通过当前 OpenClaw Session 工具策略，不证明当前 DWS Profile 拥有相应钉钉审批、考勤或通讯录业务权限。工作台只有在所选 Profile 的官方状态为 `active` 时才展示“插件操作目录”，并在目录顶部集中说明账号业务权限由每次实际调用的钉钉结果确认；普通行不重复“调用时核验”或“已暴露”，只有 OpenClaw 明确拒绝的操作才显示 Session 拒绝状态。
- Profile 失效、被撤销、不可用或尚未核验时，业务操作目录为空；运行时探针仍由接入页自动执行，不需要把运行时工具暴露成用户业务能力。
- 工具目录和 DWS Profile 必须按当前 Gateway `connectionId` 与 OpenClaw `sessionKey` 原子发布。Profile 探针未结算时只显示稳定加载态，读取失败显示可重试错误；只有当前上下文的结构化结果已结算后才能发布未登录空态。切换连接或 Session 后丢弃旧请求的迟到结果，官方当前 Profile 在同一渲染中直接作为执行身份，不等待本地选择状态的后续 effect。
- 当前 Gateway 身份和 Session 就绪后，由应用根运行时预热 `tools.effective`。只有当前工具投影明确包含且未拒绝钉钉运行时工具时，才调用该工具核验 DWS Profile；业务页只消费共享快照。
- DWS 身份快照绑定 `connectionId`、`sessionKey` 与工具投影修订。同一上下文和修订复用单个在途请求；连接、Session 或修订变化后，旧请求的迟到结果不能发布。
- DWS 钉钉深链在 Markdown 中保留原始地址，但只允许 `dingtalkclient` 主机下的 `action/openapp` 与 `page/link` 两个已核验路径。Chat 与 Markdown 文件预览复用同一分类和打开逻辑；其他自定义协议失败关闭。
- 桌面运行时通过受限 Tauri Opener 范围把钉钉深链交给系统默认处理器。调用失败显示本地化错误，不回退到 WebView；浏览器开发环境不声称能够打开钉钉客户端。
- DWS 工具结果仅从当前返回的结构化 `data.templates[].formName` 与 `data.templates[].submitUrl` 投影提交入口。每个 URL 都要再次经过同一受限外链分类；不能解析、不可打开或不符合官方模板结构时，只保留原始结果，不伪造跳转按钮。
- 聊天中的 DWS Markdown 提交链接必须有明确的桌面打开提示、键盘焦点和指针反馈。调用 Opener 成功只表示请求已交给操作系统；链接旁必须明确不能确认钉钉页面已打开。调用失败同时在链接附近和通知区显示本地化错误。
- 钉钉工作台从 DWS 模板投影出的提交入口也必须在 Opener 成功返回后就近显示“请求已交给系统”的本地化状态；不得仅让按钮恢复可点，也不得把系统接手描述为钉钉页面已经打开。调用失败仍显示独立错误状态。
- 多 Agent 协作授权目标使用项目共享的 Radix Select 与 `aegis-*` 主题 token，不使用操作系统原生下拉菜单，避免亮暗主题和键盘交互不一致。

## 验证

- DWS 前端事件缓存回归测试通过，覆盖终态早于启动响应时保留输出与终态。
- Gateway 数据层回归测试通过，覆盖相同会话快照在新连接中仍更新读取时间，以及智能体前置请求失败进入可重试错误。
- Rust DWS 单元测试通过，覆盖凭据输出隐藏、所选 npm 前缀、结构化核验，以及无 npm 输出时的启动和等待状态。
- 2026-08-20 新增输出排空顺序测试，确认标准输出和标准错误读取完成后才进入终态处理；更新后的完整 Rust 库测试 653 项通过，1 项既有 Keychain 测试按设计忽略。
- 新增的授权恢复回归测试通过，覆盖格式化 JSON 跨行解析、`auth-token` 旧槽位识别、DEK 缺失与仅建议迁移的分流、非结构化文本失败关闭、原始事件保留和标准错误中性标记。
- Rust DWS 定向测试通过，确认 Native 与 Docker 均使用官方 `auth reset --format json --yes` 参数，且重置成功不复用登录状态核验。
- DWS Profile 定向测试通过，确认切换使用 `profile switch <corpId:userId> --format json`，单账号退出使用 `auth logout --profile <corpId:userId>`；二者均通过新的 `profile list --format json` 结果核验终态。
- 授权终态测试确认缺失 `success: true` 或缺失 `authenticated: true` 都不能完成授权；浏览器回调成功不会覆盖后续本机凭据保存失败。
- Profile 选择、头像地址、当前 Session 审计查询和错误分类的前端纯函数回归测试通过。
- 单账号 Profile 回归测试确认当前账号不会重复切换，同时保留继续添加账号的语义；选择其他已登录账号时才允许调用官方切换。
- DWS 版本核验回归测试使用官方版本 JSON 结构，并拒绝缺少非空 `version` 的对象。
- 紧凑身份标签回归测试覆盖组织名与姓名重复时回落到精确 Profile。
- `pnpm lint` 通过，模块边界扫描 918 个生产文件，四处版本一致，TypeScript 类型检查通过。
- 完整 `pnpm test` 通过：前端与源码测试 2850 项、脚本测试 238 项均无失败。
- `cargo check --lib` 和 `cargo test --lib` 通过：643 项通过、1 项会修改当前用户 Keychain 的既有测试按设计忽略。
- `pnpm build` 通过，协作插件、钉钉插件、TypeScript 与 Vite 生产构建完成。
- Apple Silicon 本地未签名应用与 DMG 已重新生成；应用二进制为 Mach-O arm64，版本 3.1.2。`hdiutil verify` 通过，DMG SHA-256 为 `27d1d2e600a25a6cf6b1041c9970fbc39b17793ed1471e4a2a796b125cdd9593`。
- DWS Profile 原子发布回归测试通过：当前 Session 已有插件工具但 Profile 探针尚未结算时保持加载态，表格不会渲染账号无操作的终态文案；探针结算后才分别进入 `active` 目录或未登录空态。定向测试共 20 项通过，`pnpm lint` 通过，模块边界扫描 934 个生产文件且 TypeScript 类型检查无错误；`pnpm build` 通过，协作插件、钉钉插件、TypeScript 与 Vite 生产构建完成。
- 包含原子发布修复的 Apple Silicon 本地 DMG 已生成，应用版本与构建版本均为 `3.2.1`，二进制为 Mach-O arm64。`hdiutil verify` 通过，DMG SHA-256 为 `166af3656fb460a1fca638fdf1609f6d6977583ff7239bf6fae30954dd854ae1`；应用仅为 ad-hoc 签名，未绑定开发团队且未公证。
- DWS 身份预热协调器回归测试通过，覆盖同修订单飞、工具修订变化后重新核验、连接或 Session 切换后丢弃迟到结果，以及失效上下文拒绝发布。
- 工具目录回归测试确认账号权限边界只集中说明一次，普通操作不再显示“已暴露”，只有 Session 明确拒绝的操作显示拒绝状态。
- 本轮定向回归 24 项通过；`pnpm lint` 通过，模块边界扫描 937 个生产文件，四处版本一致且 TypeScript 类型检查无错误。
- 本轮完整 `pnpm test` 通过：前端与源码测试 2891 项、脚本测试 238 项均无失败。
- 本轮 `pnpm build` 通过，协作插件与钉钉插件包契约有效，Vite 生产构建转换 9315 个模块。
- 钉钉深链定向回归 11 项通过，覆盖 Chat 与 Markdown 文件预览渲染、两个受限路径、伪造主机和路径、危险协议、编码换行、桌面打开失败及浏览器失败关闭。
- 钉钉深链修复后的完整 `pnpm test` 通过：前端与源码测试 2905 项、脚本测试 238 项均无失败；`pnpm lint` 通过，模块边界扫描 938 个生产文件，四处版本一致且 TypeScript 类型检查无错误。
- 此前 `pnpm build` 通过，协作插件与钉钉插件包契约有效，Vite 生产构建转换 9316 个模块。此前 `pnpm tauri build --no-bundle` 仅验证过旧 Shell 路径；本轮已经移除该路径，改以 Opener 的 Rust 编译与 capability 契约验证，未生成安装包。
- Opener 迁移后，DWS 提交入口定向回归 19 项通过，覆盖完整审批模板投影、重复入口过滤、两个钉钉路径、危险协议、桌面打开失败和浏览器失败关闭；`pnpm lint`、完整 `pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs`、`cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib` 与 `git diff --check` 通过。
- 钉钉深链、DWS 授权失败和操作单飞定向回归 12 项通过；`pnpm lint` 通过。新增回归确认 Chat 保留受限深链，并标出明确的钉钉桌面打开目标。
- 钉钉提交入口状态投影、DWS 模板投影、桌面外链分类、Chat 深链和三语资源定向回归 22 项通过；`pnpm lint`、`git diff --check`、三语 JSON 解析与本次修改文件的 Emoji 扫描通过。成功反馈只描述系统接手，不宣称钉钉页面已打开。
- 本轮完整 `pnpm test`、`pnpm build`、`pnpm lint` 与 `git diff --check` 通过。审计读取失败与成功空结果保持互斥；模型目录的供应商列和模型列各自可滚动，运行参数位于独立页签。

## 未验证边界

- 未在重新打包后的 macOS 应用完成 DWS 安装、授权、Gateway 重启和工作区恢复的连续真机验收。
- 未在 Windows、Linux 或 Docker 真机验证 DWS 安装输出和 DWS 凭据库行为。
- DWS 错误分类依赖官方结构化错误对象和当前官方错误语义。无法识别的错误继续保留原始诊断，不推断其恢复方式。
- 新对话框约束尚未在真实授权长地址下完成亮色、暗色、窄窗口和键盘焦点的连续人工视觉验收。
- 未对本机真实 DWS 登录态执行破坏性重置；自动化只证明命令、确认门禁和成功语义，不证明当前用户 Keychain 已恢复。
- 未对真实第二个 DWS 账号执行切换或单账号退出；自动化证明官方命令参数、身份格式、二次确认和终态核验，不证明当前用户的真实账号状态已改变。
- 新增 Profile 账户区复用了现有 Button、Dialog 和 `aegis-*` 主题 token，但尚未在亮色、暗色、窄窗口及键盘焦点下完成连续真机视觉验收。
- 主题化 Profile 下拉和 Session 工具语义已通过定向 SSR 契约测试与 TypeScript、模块边界检查；下拉展开、方向键选择、Escape 关闭和焦点返回尚待真实 WebView 连续验收。
- 连接级预热尚未在真实 Gateway 冷启动、重连、切换 Session 和进入业务页的连续抓帧中验证；自动化只证明请求复用、失效围栏和展示契约。
- 钉钉深链与 DWS 提交入口的自动化只能证明渲染、范围校验、成功后的系统接手提示和 Tauri Opener 调用契约；重新打包后的 macOS 钉钉客户端跳转、Windows 协议注册以及未安装钉钉时的系统行为仍待真机验证。
