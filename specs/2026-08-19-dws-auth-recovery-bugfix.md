# DWS 授权恢复规格

## 范围

修复 DWS 授权对话框的输出误分类、长行越界、授权阶段混淆、结构化终态核验过宽、旧登录槽位不可读时缺少安全恢复入口，以及钉钉业务目录进入页面后才探测的问题。JunQi 仍只调用 DWS 官方命令，不读取、迁移或重写 DWS 凭据。

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

## 未验证边界

- macOS Keychain 中密钥仍可读取但沙箱进程不可读取时，官方迁移流程需要在可读取原登录态的终端环境执行；本次不由 JunQi 自动迁移。
- Windows、Linux 和 Docker 的凭据库错误文本尚未实测，分类以结构化 `auth` 错误和明确语义为门禁。
- DWS 最新公开 npm `1.0.59` 没有账号级全业务权限清单；未来若新增正式只读权限协议，必须重新审计后才能替换调用时核验语义。
