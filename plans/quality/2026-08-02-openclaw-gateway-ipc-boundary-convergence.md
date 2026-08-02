# OpenClaw Gateway IPC 出口收敛计划

1. 将已选运行时 Gateway 探测、进程状态、普通重启、配置读取和 SecretRef token 解析定义为共享类型化 command wrapper。
2. 替换 Setup、Wizard、环境审查、配置 Resolver 和适配器中的直接 IPC。
3. 以跨层契约测试、TypeScript 与 Rust 检查验证命令注册、参数、返回类型和 reader 边界。
4. 将渠道受管插件包选择保留在 Rust，并通过官方 catalog capability 驱动前端安装入口。
5. 将 Provider/Channel JSON 读取收敛到服务解析器，并用源码契约测试防止页面或 Hook 重新直连运行时对象。
6. 将选中运行时的配置文件读取、校验、解析和写入收敛到 `openclawConfigRuntime`，并保留本地连接偏好与设备凭据迁移的独立兼容边界。
7. 将连接执行器和 Wizard 重连改为直接使用 typed runtime config/token/credential 边界，并将管理器副作用端口注入化；状态订阅轮询作为独立后续迁移，必须保留其串行和重启事件语义。
8. 让 Gateway 错误页复用 selected-runtime 观测端口，以认证就绪状态判定恢复，并删除其兼容桥接状态订阅。
9. 将 App 恢复、聊天与命令面板重连、渠道日志清空及本地 URL 偏好分别收敛到观测端口、连接管理器、typed command 和本地偏好边界。
10. 抽取可注入的连接目标解析器，统一显式 URL、保存 URL、选中运行时 token 与系统设备凭据的优先级。
11. 收敛 Gateway 救援、媒体预览、监督器快照、Control UI 与旧凭据迁移的 command 出口；让设备 token 轮换通过可注入的共享持久化规则执行，并用跨层契约测试防回退。
12. 将兼容适配器降为历史 API 形状层，委托共享解析器完成 endpoint 等价、credential scope、旧凭据迁移与 token 持久化。
13. 删除不存在对应 Rust command 的 Secret 审计与热重载兼容 API；配置页面只读展示已加载的 provider 声明，不能推断第三方 secret provider 的刷新结果。
13. 删除配对全局兼容出口；让配对屏由 App 单点持久化 token，协作实例凭据绑定由带 identity fence 的共享服务执行。
14. 将 Control UI 打开动作收敛为 selected-runtime 认证探测后的共享服务，并删除兼容全局入口。
15. 删除无实际区分的 Electron 日志兼容入口，用一个类型化 state 目录服务供设置页和 Gateway 错误页复用。
16. 删除没有产品调用方的 OpenClaw 配置、Provider、Channel、Gateway 和设置全局桥，保留 typed command、配置运行时和 credential resolver 作为唯一业务出口。
17. 将 Chat 文件打开、显示、读取和 scoped preview 收敛到 `managedFileRuntime`，删除旧 `managedFiles` 兼容桥，并以跨层静态契约测试阻止回退。
18. 将 Chat 截图收敛到 `screenshotRuntime`，在服务层统一 native 错误语义，删除旧截图全局桥并补跨层契约测试。
19. 将 Agent/Skill 共享包收敛到 `sharePackagesRuntime` 与 Rust DTO，删除旧共享包全局桥并补跨层契约测试。
