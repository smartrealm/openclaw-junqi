# Gateway 原生能力与扩展一致性整改规格

日期：2026-08-09

## 目标

关闭 `docs/quality/gateway-native-extension-consistency-audit-2026-08-09.md` 中 GNE-01 至 GNE-10。
整改后，JunQi 必须只解释最新版 OpenClaw 已证明的核心协议和正式插件扩展；权限、事件、终态和凭据
暴露面由可执行契约验证，不能由文本、超时、本地状态或重复实现推断。

## 总体验收

- [ ] Gateway 核心方法、插件方法和 Tauri 本地事件在类型、命名空间、权限和状态所有权上互不混淆。
- [x] `pnpm lint` 的模块边界结论来自生产与测试共用的检查器实现，不能出现已知假阴性。
- [ ] 普通、管理员、审批和配对连接均通过窄化端口注入；调用方不能任意选择更高权限 facade。
- [ ] Chat、Agent、Wizard 和会话设置在最新版官方源码对应的真实 Gateway 上有协议级验证证据。
- [x] 不保留本轮已确认的旧事件、旧 resolver、无消费者凭据 command、兼容 fallback 或伪成功路径。
- [ ] 每批修复均先增加当前实现会失败的行为回归，再修改生产代码。

## GNE-01 模块边界验证可信化

- [x] `check-boundaries` 导出一个生产与测试共用的扫描实现；测试不复制规则或算法。
- [x] 别名和相对导入统一归一化到 `src/` 相对路径，再与同一种路径格式的规则比较。
- [x] 检查器区分运行时导入和 type-only 导入；规则对两类依赖的要求必须显式记录。
- [x] 当前 130 个违规按业务域分批收敛，不使用全局 allowlist 掩盖。
- [x] `chatStore/gateway/ChatHandler` 和 `Connection/gatewayDataStore` 的运行时循环被删除。
- [x] 旧的重复测试实现和错误注释一并删除。

## GNE-02 二维码登录权限路由

- [x] `ChannelQrLoginSession` 依赖只包含 `start` 和 `wait` 的管理员请求端口。
- [x] 渠道连接状态核验依赖独立只读端口。
- [x] UI 组合根注入正确权限实现，不把全局普通 Gateway facade 直接传入业务状态机。
- [x] 回归测试证明两个登录方法只从管理员连接发出，并验证权限失败的内联错误状态。
- [x] 取消只终止本地等待和投影，不伪造远端取消。

## GNE-03 Chat 和 Agent 事件解码

- [x] 建立与最新版官方载荷一致的 Chat 判别联合，覆盖 status、delta、final、aborted、error。
- [x] delta 合并同时处理 `deltaText`、可选累计 message、`replace` 和首次中途订阅。
- [x] status 阶段只投影官方 phase，不根据文本创造状态。
- [ ] 建立 Agent stream 的严格解码边界；畸形事件不得推进序列或运行终态。
- [ ] 只有通过解码的事件才能进入 Chat 投影和中央数据仓库。
- [ ] 回归测试至少覆盖无 message 的 delta、replace、错过增量后的快照修复、非法 seq 和 status。

## GNE-04 Wizard 官方终态

- [x] 删除所有本地构造 `{ done: true, status: "done" }` 的恢复路径。
- [x] Wizard 会话丢失、Gateway 交接超时和状态不可读时保持 outcome unknown。
- [x] 配置结构、模型验证、Gateway 身份和 Wizard outcome 作为分离事实呈现。
- [x] 文本正则不得改变步骤失败或阻断语义；没有官方结构化字段时保持未知。
- [x] `wizard.start` 的 setup/channels flow 只由明确的产品入口和官方参数驱动，不能由标题推断。
- [x] 回归测试证明本地配置完整不会把丢失会话或超时转换为官方成功。

## GNE-05 凭据广播与死解析链

- [x] 删除启动阶段 `gateway-config` WebView 事件及 token 载荷。
- [x] 删除 `configResolvers.ts`、专属测试、导出和文档引用。
- [x] 当前连接目标只由 `GatewayConnectionTargetResolver`、运行时身份和凭据提供器解析。
- [x] 安全回归证明 Gateway token 不进入 WebView 事件、浏览器持久存储、日志或测试快照。

## GNE-06 事件命名空间清理

- [x] Gateway 事件分派只接受最新版官方目录和已加载插件明确注册的事件。
- [x] Tauri `task-status`、`task-session` 继续由本地事件适配器处理，不进入 Gateway switch。
- [x] 删除没有官方或插件生产者的 session/agent 顶层事件分支及其专属状态缓冲。
- [x] Talk 的 session 生命周期只从 `talk.event` 结构化载荷投影。

## GNE-07 会话字段最小权限

- [x] `model` 的单字段 patch 使用 `operator.write`。
- [x] 运行参数继续按最新版动态权限规则使用管理员连接。
- [x] 测试复用会话字段请求策略，不复制独立的权限常量。
- [x] 权限不足、动态策略变化和管理员凭据不可用均保留真实失败。

## GNE-08 Tauri command 最小暴露面

- [ ] 为注册 command 生成可审计清单，标记 WebView、Rust 内部、插件和测试消费者。
- [x] 已确认无消费者的供应商凭据读取、OAuth 和密钥 command 从 `generate_handler!` 移除。
- [ ] Rust 内部需要的函数保留普通函数调用，不因内部复用继续暴露为 Tauri command。
- [ ] 前端调用名、参数外层、大小写、Rust 签名和 serde 字段由跨语言 fixture 验证。

## GNE-09 契约测试语义化

- [ ] 优先迁移权限、凭据、Wizard、Chat 和会话 command 的源码文本断言。
- [ ] 使用纯解析器、schema、生成注册表或真实 handler fixture 断言行为。
- [ ] 测试不得依赖变量名、表达式文本、相邻定义或源码偏移。
- [ ] 保留的源码 smoke test 只检查无法通过可执行入口验证的注册存在性。

## GNE-10 最新版插件验证

- [ ] 在受控最新版 OpenClaw Gateway 加载协作和钉钉插件。
- [ ] 验证插件发现、RPC 或工具注册、权限、审批、重启恢复和错误隐藏。
- [ ] 钉钉真实租户验证使用测试数据，不把 token、用户标识或业务内容写入仓库。
- [ ] 记录已验证的官方提交、插件包版本、平台和未覆盖边界，不以 peer 范围代替实测。

## 架构约束

- 使用端口与适配器、观察者、策略、命令、仓储和官方状态机投影解决已确认职责问题。
- 不增加无第二消费者的抽象、通用工厂或抽象基类。
- Gateway facade 只做稳定入口组合，不直接持有 store 变更、UI 回调和协议解析。
- 不保留旧接口、旧事件、旧字段 fallback 或迁移双轨。

## 完成验证

- [x] `pnpm lint`
- [x] `pnpm test`
- [x] `pnpm test:rust`
- [x] `pnpm build`
- [x] `pnpm verify:openclaw-docs`
- [x] `pnpm collab:test && pnpm collab:validate`
- [x] `pnpm dingtalk:test && pnpm dingtalk:validate`
- [x] `git diff --check`
- [x] 修改文件完整 Emoji 扫描
- [ ] 真实最新版 Gateway 的 QR、Wizard、Chat 和插件验证记录
- [ ] macOS、Windows、Linux 未完成的真机边界明确记录
