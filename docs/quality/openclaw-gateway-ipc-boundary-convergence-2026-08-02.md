# OpenClaw Gateway IPC 出口收敛

## 依据

选定运行时的 Gateway 认证探测是首次启动、Wizard、环境检测和运行时恢复共同依赖的安全边界。它不能被端口有进程或不同参数形态的局部调用替代。

## 修复

- `probe_selected_gateway`、`gateway_status` 与 `restart_gateway` 统一由 `src/api/tauri-commands.ts` 的类型化 wrapper 调用。
- Setup 主流程、Wizard、环境审查和兼容适配器不再直接调用这些 command。
- `probeSelectedGateway` 仅接受可选端口并统一序列化为无参数对象或 `{ port }`，与 Rust 的 `Option<u16>` 签名一致。
- Gateway 配置 Resolver 依赖窄类型 `GatewayConfigReader`，不再接收任意 command 字符串；SecretRef token 解析也通过同一 typed wrapper 进入 Rust。
- OpenClaw 修复、恢复诊断和插件自愈同样进入 typed command 边界，恢复协调器与插件策略层不再直接依赖 Tauri `invoke`。
- 契约测试扫描所有上述调用方，防止未来重新绕过统一出口。
- 渠道受管插件的 npm 包映射只存在于 Rust。官方 catalog 仅向前端公开 `managedInstall` 能力，安装回执也只返回渠道和确认状态；页面据此呈现安装操作，不能复制或猜测 npm 包选择。
- Provider catalog、候选配置探测、OAuth profile、Channel catalog、能力、状态和日志也统一通过同一 typed command 边界。服务负责把 OpenClaw JSON 规范化为页面 DTO，页面不再直接访问 `window.aegis` 运行时对象。
- 选中运行时的 OpenClaw 配置文件由 `openclawConfigRuntime` 统一访问。App、Setup、配置中心、渠道中心与 Agent 设置不再从 `window.aegis.config` 读取、校验、解析或写入该文件。
- 本地 Gateway 连接偏好只保存当前端点；设备凭据不经过浏览器存储或兼容适配器迁移。OpenClaw 配置读取不是配置编辑或运行时校验的替代出口。
- 正常 WebSocket 连接和 Wizard 完成后的重连直接通过 `detect_gateway_config`、`get_gateway_token` 与系统凭据库解析选中 runtime 的端点和凭据，不再读取兼容适配器的 `config.get()`。
- `GatewayConnectionManager` 将连接、Native 启动与 Docker 启动作为可注入执行端口；默认实现只使用 typed command，生命周期测试不再依赖预加载全局对象。
- `gatewayProcessObservation` 现在是进程状态端口：它区分进程存活与认证就绪、串行执行状态轮询，并在在途观察结束后补发一次排队观察。管理器仅消费端口快照与生命周期结果。
- `GatewayErrorScreen` 通过 `useGatewayProcessRecovery` 订阅同一 selected-runtime 观测端口。只有已认证的 `ready` 状态且没有观测错误才能关闭错误页，进程仍在运行并不足以判定恢复。
- App 启动恢复通过同一观测端口决定静默 WebSocket 重连或生命周期恢复；聊天连接横幅和命令面板只请求 `GatewayConnectionManager` 重连，渠道日志清空直接使用 typed command。本地 Gateway URL 偏好不再写入 OpenClaw 配置文件。
- `GatewayConnectionTargetResolver` 是唯一的端点与凭据解析器：它合并显式 URL、用户保存的 URL、选中运行时 URL、typed token 和系统凭据库。选中运行时 bootstrap token 绝不会随手动 URL 发送到另一端点；显式 token 只在本次连接使用。
- 端点等价比较和 credential runtime key 由 `GatewayConnectionTargetResolver` 统一负责；浏览器旧值迁移与兼容凭据路径已删除，系统凭据恢复和 token 轮换仍通过原生凭据边界完成，不得在适配器内重建第二套凭据归属规则。
- Gateway 救援模型发现与诊断聊天、OpenClaw 媒体预览、Gateway 监督器快照、Control UI 就绪探测和旧凭据迁移均已进入 typed command 层。聊天媒体不再以旧桥接回退到任意文件读取。
- Chat 文件打开、显示、文本读取、预览 URL 和 Markdown 本地链接只通过 `managedFileRuntime` 调用已注册的 typed command；历史 `uploads` 和 `window.aegis.managedFiles` 兼容对象均已删除，不得作为回退或会话清理任务。托管上传/输出索引需要独立的 Rust 契约后才能恢复入口。
- Chat 截图交互、全屏、窗口枚举与窗口截图只通过 `screenshotRuntime` 调用 registered command。该服务统一转换权限拒绝、用户取消和其他运行时失败；组件不得解析平台错误或访问 `window.aegis.screenshot`。
- Agent 与 Skill 共享包的扫描、导出、检查、导入预检和导入只通过 `sharePackagesRuntime` 调用 typed command。Rust 是 ZIP 安全策略、路径校验与冲突处理的唯一权威；共享对话框不得通过 `window.aegis.sharePackages` 重新建立第二个出口。
- 设置页此前的附件数量、大小和刷新按钮依赖同一个不存在的托管索引，已与 `uploads` 兼容对象、会话伪清理和 `managedFiles` 伪 `list/delete/saveAs` 声明一并删除。文件预览的可注入读取桥只用于纯单测，产品默认路径始终进入 typed runtime。
- 握手返回的轮换 device token 与配对完成 token 共用 `storeGatewayConnectionDeviceCredential`：已绑定实例优先、匹配的 selected runtime scope 次之、端点最后。连接层通过窄端口注入该副作用，临时 admin socket 永不持久化 token。
- 手工配对屏只将用户输入交回 App 的单一完成处理器，不能自行持久化 token；协作实例凭据提升由 `GatewayCredentialBinding` 在 identity fence 内执行。历史 `window.aegis.pairing` 已删除，避免 UI 根据运行环境走不同 credential mutation 路径。
- App 恢复后的自动打开与设置页的手动打开共用 `GatewayControlUi`。该服务必须先对 selected runtime 执行认证就绪探测，再调用 Rust `open_control_ui`；历史 `window.aegis.consoleUi` 与裸端口探测入口已删除。
- 配置中心此前的 `agentAuth` 适配器调用是空成功占位，不对应任何 Rust command，也不触发模型或凭据同步。该出口和调用已删除；Provider SecretRef 只随经过校验的 OpenClaw 配置写入进入 selected runtime。
- 配置中心的 Secret 审计和热重载此前只是兼容适配器的固定失败对象，并无对应 Rust command。页面现在只展示当前已加载配置声明的 secret provider，不暴露值，也不声称可以重新解析第三方 provider；历史 `window.aegis.secrets` 已删除。
- 设置页保留的 Gateway 日志、桌面日志和 Electron 日志兼容入口此前都会打开同一个 state 目录。它们已收敛为 `runtimeData.openStateDirectory` 与 `openRuntimeDataDirectory`：设置页和 Gateway 错误页共享这个真实的只读打开动作，不再把一个目录伪装成多个日志能力。
- 没有 Tauri command、适配器实现或产品调用方的 `window.aegis.calendar` 仅是遗留类型声明，已经删除，避免本地日历页面被误解为连接 OpenClaw 或系统日历的同步能力。
- `window.aegis.config`、`providerRuntime`、`channelRuntime`、`gateway` 与 `settings` 已没有产品调用方，且会重建配置、凭据和生命周期的第二套规则。兼容适配器、全局类型和重复的设置写入已一并移除；Gateway endpoint 与 credential 优先级只由 `GatewayConnectionTargetResolver` 负责，OpenClaw 配置、模型、渠道和生命周期只经 typed command 与对应服务访问。

## 验证边界

自动化验证 IPC 名称、参数外层、Rust 注册和调用方收敛；仍需在 Native 与 Docker 的真实桌面运行时分别验证配置文件读写、外部编辑 revision 冲突、媒体预览授权和实际认证探测结果。
