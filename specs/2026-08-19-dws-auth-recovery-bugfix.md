# DWS 授权恢复规格

## 范围

修复 DWS 授权对话框的输出误分类、长行越界、授权阶段混淆、取消与关闭无效、结构化终态核验过宽、旧登录槽位不可读时缺少安全恢复入口，以及钉钉业务目录进入页面后才探测的问题。JunQi 仍只调用 DWS 官方命令，不读取、迁移或重写 DWS 凭据。

## 验收条件

1. DWS 标准错误流中的授权地址、等待进度和诊断均使用中性来源标记，不能仅因来自标准错误流就显示为业务错误。
2. 对话框宽度不超过当前视口；长地址、连续字符串和结构化诊断在日志边界内断行，日志区域只在内部滚动。
3. 当前操作的原始输出事件按 `operationId` 保留，结构化错误识别不得从已本地化的展示文案反向解析。
4. 仅当 DWS 返回 `auth` 类错误且明确说明旧 `auth-token` 槽位不可读时展示凭据恢复说明。
5. 当诊断明确为数据加密密钥缺失时，可在二次确认后执行官方 `dws auth reset --format json --yes`。确认文案必须说明会清除本机全部 DWS 登录态。
6. 重置命令成功只表示 DWS 官方重置流程成功；界面必须要求用户重新发起授权，不能显示为已登录或已授权。
7. 无法识别或无法安全分类的错误只展示诊断和官方文档入口，不自动重置、不自动迁移。
8. DWS 浏览器回调页成功但本机 token 持久化失败时，界面必须明确区分“网页授权已返回”和“本机登录未完成”，不得把网页成功解释为当前 Profile 已授权。
9. `dws auth status --format json` 只有同时返回 `success: true` 与 `authenticated: true` 才能完成授权操作；普通 `success: true` 响应不能冒充已登录。
10. DWS `profile list --format json` 是账号列表、当前 Profile 和执行身份的唯一来源。工具调用必须从已返回的精确 `corpId:userId` 中选择，不再要求用户手填所谓“租户身份”。
11. 当前 Profile 切换只调用官方 `dws profile switch <corpId:userId> --format json`，并以 `profile list` 返回相同 `currentProfile` 为完成条件。
12. 单账号退出只调用官方 `dws auth logout --profile <corpId:userId>`，需要二次确认，并以 `profile list` 不再包含该精确 Profile 为完成条件。全量 `auth reset` 只用于明确的凭据损坏恢复。
13. DWS 未返回 HTTPS 头像字段时只显示明确的通用用户占位图标，不根据姓名生成疑似真实头像。
14. 钉钉业务审计必须区分未连接、Gateway 不支持 `audit.activity.list`、缺少 `operator.read`、响应不兼容和普通请求失败；界面同时说明只有经 OpenClaw 执行并写入官方 metadata-only 账本的钉钉工具事件才会出现。
15. DWS 安装核验必须遵守官方 `dws version --format json` 响应，只要求非空 `version`；该命令没有 `success` 字段，不能套用授权或 Profile 操作的成功判据。
16. 顶栏紧凑身份只显示一个 DWS 头像；姓名前不得重复显示用户图标，次级信息不得与姓名重复，组织名重复时回落到精确 Profile。
17. 插件操作错误和授权结果必须在“接入与授权”诊断区域完整显示；顶栏不承载会挤压身份与刷新操作的长错误文本。
18. 当前 Gateway 身份核验和 Session 快照就绪后，必须在业务页挂载前读取该 Session 的 `tools.effective`；只有其中明确存在且未拒绝钉钉运行时工具时，才能通过 `tools.invoke` 预热 DWS 身份。
19. DWS 身份快照必须同时绑定 Gateway `connectionId`、OpenClaw `sessionKey` 和当前 `tools.effective` 修订。连接、Session 或工具修订变化时旧快照立即失效，迟到结果不得覆盖新上下文。
20. 业务页只订阅共享预热快照，不再维护独立的首屏探测请求；手动刷新仍必须强制重读工具投影、DWS 身份和本机可管理插件状态。
21. DWS `profile list`、`auth status` 和 schema 不能证明账号拥有审批、考勤、日历等业务权限。DWS PAT batch plan 也只表达行为授权计划，不能替代组织角色或数据权限；客户端不得后台逐个调用业务工具预判权限。
22. 主目录集中说明“Session 暴露、Profile 登录和账号业务权限”三层边界，不在每一行重复展示“调用时核验”或“已暴露”。只有 OpenClaw 明确拒绝的工具才在对应行显示 Session 拒绝状态。
23. DWS 返回的 `dingtalk://dingtalkclient/action/openapp` 与 `dingtalk://dingtalkclient/page/link` 必须保留为可点击 Markdown 链接，并由桌面系统交给钉钉客户端打开。
24. 只允许上述两个已核验的钉钉主机与路径。其他自定义协议、其他钉钉主机或路径、含凭据、控制字符或编码换行的地址必须拒绝，不能交给系统打开器。
25. 钉钉深链打开失败时必须在当前界面显示本地化错误；不得静默回退到 WebView `window.open`，也不得继续显示为已经可用的操作。
26. Chat 消息与 Markdown 文件预览必须复用同一外部链接分类和桌面打开边界，不再各自维护不同的协议判断或失败回退。
27. 浏览器开发环境只保留 HTTP、HTTPS、邮件和电话链接的普通浏览器路径；钉钉深链必须明确要求桌面运行时，不能伪造打开成功。
28. 桌面端外链必须通过 Tauri 官方 Opener 的 `openUrl` 调用；不再使用 Shell 的已替代 `open` 路径。Opener capability 只允许 JunQi 已分类的协议和 DWS 已核验的两个钉钉深链前缀。
29. 钉钉工作台直接执行工具时，若当前结构化 DWS 返回严格包含 `data.templates[].formName` 和安全的 `data.templates[].submitUrl`，必须与 Chat 使用同一受限打开逻辑呈现每一个提交入口；原始 JSON 继续可查看，不能以本地推断生成模板或链接。
30. DWS 操作处于启动、运行或取消中时，关闭按钮、Escape 和遮罩关闭请求都必须请求取消，不得静默忽略；命令已经确认取消后，关闭请求才自动收起对话框。
31. 用户在 `start_dws_operation` 返回操作标识前请求取消时，页面必须保留取消意图，并在取得该精确 `operationId` 后立即发送取消请求；不得将操作重新写回运行态。
32. 取消只允许按 JunQi 当前持有的精确 `operationId` 终止本地 DWS 子进程，不得因 Gateway 连接或运行时身份在操作期间变化而遗留该子进程；取消请求不表示浏览器页面、DWS 凭据或任何外部副作用已经撤销。
33. 取消请求发出后界面必须显示“正在取消”，拒绝重复点击；最终状态仍以本地子进程退出和结构化终态事件为准，取消失败不得伪装为已取消。

## 本轮验证记录

- 已由 DWS 官方主线提交 `35c6fd95e1440e4be06f54c4cc973d9194ffd84c` 核对审批模板的完整字段契约；JunQi 只投影完整模板，重复或不完整模板不会生成提交入口。
- Tauri Shell 的旧打开路径已删除，前端通过 `@tauri-apps/plugin-opener` 的 `openUrl` 调用，Rust 注册 Opener，capability 只保留 HTTP、HTTPS、邮件、电话和两个钉钉深链前缀。
- 定向回归、TypeScript、完整前端测试、生产构建、Rust 格式化、Rust 检查、Rust 库测试、官方 OpenClaw 文档校验与 diff 检查均通过；真实钉钉客户端是否打开目标页面仍属于未验证边界。
- 2026-08-27 已核对 Rust 官方 `Child::kill` 与 `Child::try_wait` 契约：`kill` 请求子进程退出，退出状态仍由非阻塞收集路径确认。DWS 取消入口因此只终止 JunQi 已创建且与精确 `operationId` 匹配的本地 CLI 子进程，不把外部授权结果视为已回滚。

## 未验证边界

- macOS Keychain 中密钥仍可读取但沙箱进程不可读取时，官方迁移流程需要在可读取原登录态的终端环境执行；本次不由 JunQi 自动迁移。
- Windows、Linux 和 Docker 的凭据库错误文本尚未实测，分类以结构化 `auth` 错误和明确语义为门禁。
- DWS 最新公开 npm `1.0.59` 没有账号级全业务权限清单；未来若新增正式只读权限协议，必须重新审计后才能替换调用时核验语义。
- 真实钉钉客户端是否接受 DWS 返回的每一种深链参数组合，仍需在重新打包后的 macOS 与 Windows 桌面应用分别验证。
- Opener 只能证明系统已接收打开请求，不能证明钉钉客户端已加载目标页面；macOS、Windows 和 Linux 的协议注册与实际跳转仍需真机验证。
- DWS 授权取消尚未在真实 Native、Docker、Windows 或 Linux 运行时验证；自动化仅证明弹窗关闭意图、启动竞态、IPC 参数和本地子进程终止请求的代码契约，不证明浏览器已自动关闭或外部授权副作用已撤销。
