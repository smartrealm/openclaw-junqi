# DWS 安装与工作区恢复审计

日期：2026-08-19

## 依据

- [DWS 官方 README](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/README.md) 将 `npm install -g dingtalk-workspace-cli` 列为 Node.js/npm 安装方式；登录仍由官方 `dws auth login` 或 headless 环境的 `dws auth login --device` 承担。
- JunQi 只在已核验的所选 Native 或 Docker OpenClaw 运行时中执行该安装命令，安装后以 DWS 的结构化 JSON 命令核验，不读取或展示凭据。
- Gateway 重启只通过 `gatewayLifecycle.restart` 协调；工作区入口以当前连接的 OpenClaw 会话快照为放行事实。

## 根因

`dws_operation` 原先只转发 npm 的标准输出和标准错误。npm 在下载或解析依赖的静默阶段不会产生行输出，界面只能永久显示“等待输出”。

同一操作的子进程若在前端收到 `start_dws_operation` 返回的 `operationId` 前结束，完成事件会先到达。旧页面丢弃了尚未关联当前弹窗的终态，随后把弹窗写为 `running`，没有任何后续事件可以收敛。

Gateway 重启后的数据轮询还存在独立缺陷：`sessions.list` 返回与重启前相同的会话投影时，数据层只清除 loading 而未更新 `lastFetch.sessions`。工作区首屏门禁将这个时间戳与本次 `connectionStartedAt` 比较，于是把已成功返回的当前快照误判为旧连接数据，持续显示“正在同步工作区”。智能体范围读取失败也会阻断会话读取，但旧失败判定没有将其作为可重试的首屏失败。

2026-08-19 的本机安装包实测又确认了三项授权链路缺陷：

- `BUG-DWS-01`，高优先级：DWS 官方 CLI 会把授权地址和等待进度写入标准错误流，前端却为每一行标准错误增加“错误”前缀，导致正常进度被误报为失败。
- `BUG-DWS-02`，高优先级：授权输出中的长地址和结构化诊断参与对话框网格的最小内容宽度计算。日志容器缺少 `min-width: 0`、横向约束和任意位置断行，长行会把对话框内容推到视口外。
- `BUG-DWS-03`，高优先级：旧 `auth-token` 密文存在但系统凭据库中的数据加密密钥缺失时，DWS 会拒绝覆盖该登录槽位。旧界面只显示原始诊断，没有识别 DWS 的结构化 `auth` 错误，也没有提供官方 `dws auth reset` 的显式恢复入口。
- `BUG-DWS-04`，高优先级：DWS 浏览器回调在授权码换取 token 且组织权限检查通过后立即显示成功，CLI 随后才保存本机 token。JunQi 把后续持久化失败显示为笼统的“官方流程未通过”，没有解释网页成功只代表回调阶段完成；同时授权核验只拒绝 `success: false`，会错误接受 `success: true, authenticated: false`。
- `BUG-DWS-05`，中优先级：业务工具要求用户手填“租户身份”，没有使用 `profile list` 返回的精确 `corpId:userId`；工作台也没有官方 Profile 切换和单账号退出入口，全量重置因此容易被误解为普通退出。
- `BUG-DWS-06`，低优先级：DWS 用户资料未返回 HTTPS 头像时，界面用姓名首字母生成占位头像，与“不会显示猜测头像”的产品文案不一致。
- `BUG-DWS-07`，中优先级：钉钉业务审计读取失败时，Hook 丢弃错误类别并统一显示“账本不可用”，没有说明当前连接缺少 `operator.read`、Gateway 尚未支持 `audit.activity.list`、响应契约不兼容或普通请求失败的差异。

`BUG-DWS-03` 的恢复不能自动执行。DWS 官方文档说明 `auth reset` 会清除本机全部登录配置；JunQi 只能在展示影响范围并取得二次确认后调用官方命令。若旧登录态仍可读取，应优先按官方迁移流程处理，不得用重置代替迁移。

## 目标行为

- DWS 子进程成功启动后立即发送本地派生的事实状态；每 15 秒发送一次仍在等待的实际时长。该状态不表示 npm 已完成，也不伪造百分比。
- 输出和完成事件按 `operationId` 缓存。页面建立该操作投影后消费已到达的终态，并只执行一次后续 DWS 配置、统一 Gateway 重启和刷新。
- 每个当前连接的成功 `sessions.list` 快照都更新会话读取时间，即使会话内容没有变化。
- 由于智能体范围是当前会话读取的前置条件，智能体请求在已结算后失败时，首屏显示可重试错误，不能无限显示同步中。
- 标准输出和标准错误只表示来源流，不表示业务成功或失败。授权过程的每一行均以中性诊断呈现；最终成功只服从 DWS 结构化核验和进程终态。
- DWS 输出对话框在窄窗口和长行下保持视口内布局，日志在固定边界内纵向滚动并允许任意位置断行。
- 对可识别的旧登录槽位不可读错误展示安全恢复说明。只有确认属于数据加密密钥缺失时，才提供“重置本机全部 DWS 登录态”的入口，并在二次确认后运行官方 `dws auth reset --format json --yes`；重置成功不等于重新授权成功。
- 浏览器回调已返回但本机持久化失败时，界面分别呈现网页阶段和本机阶段；授权完成必须由 `auth status` 的 `authenticated: true` 证明。
- 工具执行身份从 `profile list` 的精确 Profile 中选择。切换当前账号与退出单账号分别执行 DWS 官方 `profile switch` 和 `auth logout --profile`，并用新的 `profile list` 结果核验。
- DWS 未返回安全头像地址时显示通用用户占位图标，不生成姓名首字母头像。
- 业务审计继续只调用最新版 OpenClaw 的 `audit.activity.list`，不回退旧协议；失败时显示可操作的分类原因，无记录时说明记录产生条件。
- DWS 安装完成后调用官方 `dws version --format json`，以非空 `version` 为安装终态。官方版本响应没有 `success` 字段，不能复用授权和 Profile 操作的成功结构。
- 顶栏紧凑身份只保留一个 DWS 头像和一组两级文本；姓名前的重复用户图标已删除，组织与姓名相同时次级文本回落到精确 Profile。
- 插件操作错误与授权结果从顶栏移入共享接入诊断面板，长文本在业务上下文内完整换行，顶栏只保留身份和刷新操作。

## 验证

- DWS 前端事件缓存回归测试通过，覆盖终态早于启动响应时保留输出与终态。
- Gateway 数据层回归测试通过，覆盖相同会话快照在新连接中仍更新读取时间，以及智能体前置请求失败进入可重试错误。
- Rust DWS 单元测试通过，覆盖凭据输出隐藏、所选 npm 前缀、结构化核验，以及无 npm 输出时的启动和等待状态。
- 新增的授权恢复回归测试通过，覆盖格式化 JSON 跨行解析、`auth-token` 旧槽位识别、DEK 缺失与仅建议迁移的分流、非结构化文本失败关闭、原始事件保留和标准错误中性标记。
- Rust DWS 定向测试通过，确认 Native 与 Docker 均使用官方 `auth reset --format json --yes` 参数，且重置成功不复用登录状态核验。
- DWS Profile 定向测试通过，确认切换使用 `profile switch <corpId:userId> --format json`，单账号退出使用 `auth logout --profile <corpId:userId>`；二者均通过新的 `profile list --format json` 结果核验终态。
- 授权终态测试确认缺失 `success: true` 或缺失 `authenticated: true` 都不能完成授权；浏览器回调成功不会覆盖后续本机凭据保存失败。
- Profile 选择、头像地址、当前 Session 审计查询和错误分类的前端纯函数回归测试通过。
- DWS 版本核验回归测试使用官方版本 JSON 结构，并拒绝缺少非空 `version` 的对象。
- 紧凑身份标签回归测试覆盖组织名与姓名重复时回落到精确 Profile。
- `pnpm lint` 通过，模块边界扫描 918 个生产文件，四处版本一致，TypeScript 类型检查通过。
- 完整 `pnpm test` 通过：前端与源码测试 2850 项、脚本测试 238 项均无失败。
- `cargo check --lib` 和 `cargo test --lib` 通过：643 项通过、1 项会修改当前用户 Keychain 的既有测试按设计忽略。
- `pnpm build` 通过，协作插件、钉钉插件、TypeScript 与 Vite 生产构建完成。
- Apple Silicon 本地未签名应用与 DMG 已重新生成；应用二进制为 Mach-O arm64，版本 3.1.2。`hdiutil verify` 通过，DMG SHA-256 为 `27d1d2e600a25a6cf6b1041c9970fbc39b17793ed1471e4a2a796b125cdd9593`。

## 未验证边界

- 未在重新打包后的 macOS 应用完成 DWS 安装、授权、Gateway 重启和工作区恢复的连续真机验收。
- 未在 Windows、Linux 或 Docker 真机验证 DWS 安装输出和 DWS 凭据库行为。
- DWS 错误分类依赖官方结构化错误对象和当前官方错误语义。无法识别的错误继续保留原始诊断，不推断其恢复方式。
- 新对话框约束尚未在真实授权长地址下完成亮色、暗色、窄窗口和键盘焦点的连续人工视觉验收。
- 未对本机真实 DWS 登录态执行破坏性重置；自动化只证明命令、确认门禁和成功语义，不证明当前用户 Keychain 已恢复。
- 未对真实第二个 DWS 账号执行切换或单账号退出；自动化证明官方命令参数、身份格式、二次确认和终态核验，不证明当前用户的真实账号状态已改变。
- 新增 Profile 账户区复用了现有 Button、Dialog 和 `aegis-*` 主题 token，但尚未在亮色、暗色、窄窗口及键盘焦点下完成连续真机视觉验收。
