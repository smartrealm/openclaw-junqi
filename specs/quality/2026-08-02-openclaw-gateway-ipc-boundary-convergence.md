# OpenClaw Gateway IPC 出口收敛

## 目标

所有前端业务模块通过同一类型化出口执行已选运行时 Gateway 的认证探测、进程状态读取、普通重启、配置读取和 SecretRef token 解析。

## 验收

- 调用参数与 Rust command 的 `Option<u16>`、返回 `GatewayStatus` 和 token 契约一致。
- Setup、Wizard、环境审查、配置 Resolver 和兼容适配器无上述 command 的直接 `invoke`。
- 配置 Resolver 只依赖窄类型 reader，不接收可调用任意 command 的函数。
- 前端不得维护受管渠道插件与 npm 包的映射；Rust 以 catalog capability 公开是否允许安装。
- Provider/Channel 页面和 Hook 不得直接访问 `window.aegis` 运行时对象或相应 Tauri command；未知 OpenClaw JSON 必须先经服务层规范化。
- App、Setup、配置中心、渠道中心和 Agent 设置读取、校验、解析、写入选中运行时的 OpenClaw 配置时，必须经过类型化 command 与 `openclawConfigRuntime`；本地连接偏好不可替代该配置文件契约。
- Gateway 连接执行器和 Wizard 完成重连不得通过 `window.aegis.config` 获取端点、bootstrap token 或设备凭据；管理器的执行器必须可替换，以便单独验证生命周期编排。
- Gateway 管理器必须只依赖进程 runtime port；该端口需要区分进程存活与认证就绪，并保证状态轮询串行且销毁后不再提交快照。
- Gateway 错误页必须使用与连接管理器相同的 selected-runtime 观测端口；仅进程存活不足以判定恢复，必须通过已认证的就绪探测。
- App 启动恢复、聊天页手动重连、命令面板重连和渠道日志清空不得回退到 `window.aegis.gateway/config`；本地 URL 偏好不得写入选定运行时的 OpenClaw 配置。
- 设置页和普通连接执行器必须共用端点与凭据解析器。手动 URL 不得继承选中运行时 bootstrap token；显式 token 只能用于当前请求。
- 历史 `window.aegis` 兼容层不得自行比较 Gateway endpoint、生成 credential runtime key 或迁移凭据；配对 credential mutation 不得再经过该全局对象，手工配对与协作实例绑定必须进入共享服务并接受同一 identity fence。
- Gateway 救援、OpenClaw 媒体预览、监督器快照、Control UI 探测与旧凭据迁移不得绕过 typed command 层；媒体预览失败不得退回到任意本地文件读取。
- Chat 文件打开、显示、存在检查、文本读取、预览 URL 和 Markdown 本地链接必须经 `managedFileRuntime` 调用 typed command；`window.aegis.managedFiles` 不得重新成为产品运行时出口。
- Chat 截图必须经 `screenshotRuntime` 调用 typed command，并由服务统一规范化权限拒绝、取消和运行时错误；`window.aegis.screenshot` 不得重新成为产品运行时出口。
- Agent 与 Skill 共享包必须经 `sharePackagesRuntime` 调用 typed command；`window.aegis.sharePackages` 不得重新成为产品运行时出口。
- 非 transient 握手轮换 token 和配对 token 必须共用按实例、selected runtime scope、端点顺序解析的系统凭据持久化规则；transient admin 连接不得写入凭据。
- Gateway Control UI 只能经共享服务打开，并在创建窗口前通过 selected-runtime 认证探测；App、设置页和兼容适配器不得暴露独立全局入口或裸端口就绪判断。
- Secret provider 页面只能展示当前 OpenClaw 配置的声明；没有 Rust command 的审计或热重载操作不得在 UI 或 `window.aegis` 兼容层中伪装为可执行能力。
- 日志或运行数据入口必须描述实际能力。若 desktop runtime 只能打开 selected runtime 的 state 目录，设置页与 Gateway 错误页必须复用同一个类型化服务，不得保留多个名称不同但目标相同的 Electron 兼容操作。
- 类型声明不得暴露没有 Tauri command、适配器实现和产品调用方支持的日历或其他业务能力。
- 已迁移至 typed command 与服务层的 OpenClaw 配置、Provider、Channel、Gateway 和本地设置不得在 `window.aegis` 重复暴露。凭据 endpoint 与 scope 的优先级只能由 `GatewayConnectionTargetResolver` 定义。
- 回归测试、类型检查和 Rust library 检查通过。
