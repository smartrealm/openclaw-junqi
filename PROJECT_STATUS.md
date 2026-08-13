# 项目交接状态

更新时间：2026-08-14

## 当前目标

完成 OpenClaw 官方配置终态到 JunQi 工作台的单一、可核验 Gateway 接管链路。当前重点是消除官方延迟重启、认证凭据轮换、连接换代和活动配置修订之间的竞态；配置模式继续依据正式 RPC 响应协商，不绑定版本号。

## 已完成内容

- Guided、Classic 与渠道 Wizard 共用严格终态谓词：只有 `done === true` 且状态为官方终态时才结束会话；携带正式步骤的 `done: false` 不会因 `status: done` 被提前消费。
- 官方终态后重新解析当前所选 Runtime 的端点、共享凭据和设备凭据；解析失败时停止交接，不复用向导前的内存目标、历史手工地址或另一 Runtime 的凭据。
- 新增活动配置应用门禁：同一已核验连接上的 `config.get.configRevisionHash` 与 `appliedConfigHash` 必须非空且相等，才能证明当前 Runtime 已采用磁盘修订。
- 官方重载等待、连接轮换、Guided 探测、真实模型核验和最终修订核验共用一个六分钟绝对截止时间，所有异步步骤都消费同一剩余预算。
- 普通等待超时不再主动重启 Gateway。只有 `gateway.reload.mode: off` 或官方 `health.configReload.hotReloadStatus: disabled` 明确重载关闭时，才通过全局唯一生命周期协调器补发一次重启。
- 生命周期屏障以真实 `manager.restart()` 调用点维护单调重启代次。若同一交接事务已经等待过恢复内部重启，或两次屏障之间发生过快速重启，后续配置等待只重新核验，不补发第二次重启。
- 进入 Ready 前再次核对同一连接和同一活动修订。验证期间修订从 A 变化为 B 时，在原事务预算内重新完成探测与模型证据，不提交旧修订的成功状态。
- Gateway 主连接只有在 WebSocket 仍打开且 Runtime Identity 核验完成后才发布为 connected。核验等待期间连接关闭或换代会作废待定身份，迟到结果不能残留为可用 Runtime。
- Gateway Manager 只拥有连接轮次，WebSocket 退避与耗尽只由 Connection 持有；进程健康观察不再重置退避。显式同目标连接会先结束旧传输再建立新轮，不能停在无后续事件的探测状态。
- 新的 `connect` 响应被 Gateway 接受后立即清除旧配对等待；后续协议或身份失败进入有界普通重试，不再无限按配对间隔轮询。用户取消普通配对统一经 Manager 收敛活动握手与等待定时器，取消后只有显式恢复才能开启新连接轮次。
- 生命周期连接收敛只把目标解析失败、当前连接身份失败和传输重试耗尽当作终态；进程观察瞬时错误只保留为诊断。
- 特权临时连接在发送管理 RPC 前再次核对主连接标识、端点与凭据；临时握手期间来源换代时拒绝请求，不能在写操作已经发送后才报告围栏失效。
- 手工输入的 Gateway shared token 仅用于当前进程重连，不再写入设备凭据存储；设备凭据只接受 OpenClaw 握手签发。
- Guided 候选梯子跳过明确无凭据项，并在已有默认模型激活失败后停止自动替换；自动激活成功后保留用户确认当前路径或改选的边界。
- Guided 和 Classic 共用 setup admission busy 分类；不可用候选、官方修复入口、推荐安装和取消操作均保留正式协议语义。
- 首次设置运行时页面原地完成 Gateway 认证与身份核验；只有 Guided 可操作状态或 Classic 首个官方步骤准备完成后才进入配置页，不显示空配置页后自动跳变。
- 官方步骤、二维码、日志、数据位置表单和页面方向过渡继续遵循当前首次启动规格；本轮未新增平行 Gateway 重启入口或客户端成功推断。

## 关键技术决策

- Wizard 终态、Gateway 进程健康、认证连接、Runtime Identity 和活动配置修订是不同事实，必须按顺序分别核验。
- `config.get.hash` 是配置写入冲突控制值，不是活动 Runtime 修订证据；缺失 `configRevisionHash` 或 `appliedConfigHash` 时失败关闭并要求更新 OpenClaw。
- `installDaemon: false` 只关闭 Wizard 的 daemon 安装分支，不关闭 OpenClaw 自身的配置监听和进程内重启；JunQi 不得因此抢跑重启。
- OpenClaw 可能为活动 Wizard 工作延迟官方重启，并可能在实际重启前轮换共享认证代次。旧 socket 仍在线、旧 token 可用或重启命令返回成功都不能证明接管完成。
- 只有官方结构化配置或健康状态可以证明重载被禁用；文本、超时和空结果不能升级为显式重启依据。
- 所有恢复、重连和重启继续经 `GatewayLifecycleCoordinator`；业务页面不得直接控制 Gateway 进程或系统服务。
- 是否已经发生过重启由协调器在真实原生副作用调用点记录，不按外层动作名称、进程状态或最终返回值推断；结果失败或未知也不能自动重放同一次补偿。
- Gateway 连接重试只有一个所有者。健康轮询只提供端点事实，不能在 Connection 的尝试、退避或耗尽阶段并发创建第二轮连接。
- 任何管理写请求都必须在副作用发送前通过当前连接来源围栏，事后拒绝不能撤销已发生的写入。

## 核心文件

- `src/services/setup/openClawSetupHandoff.ts`
- `src/services/gateway/OpenClawConfigApplicationClient.ts`
- `src/services/gateway/OpenClawConfigSnapshot.ts`
- `src/services/gateway/Connection.ts`
- `src/services/gateway/GatewayConnectionSettlement.ts`
- `src/services/gateway/GatewayLifecycleCoordinator.ts`
- `src/services/gateway/GatewayConnectionManager.ts`
- `src/services/gateway/runtimeIdentity.ts`
- `src/services/gateway/index.ts`
- `src/runtime/gatewayLifecycle.ts`
- `src/hooks/useSetupFlow/useWizardSession.ts`
- `src/hooks/useSetupFlow/useGuidedSetupSession.ts`
- `src/services/openclawWizard.ts`
- `docs/quality/openclaw-wizard-terminal-handoff-audit-2026-08-11.md`
- `specs/2026-08-12-openclaw-native-installation-alignment.md`
- `plans/2026-08-12-openclaw-native-installation-alignment.md`

## 测试与验证

- 定向连接安全、连接收敛、生命周期协调、活动配置应用、终态交接和 Guided Wizard 回归已通过。
- OpenClaw 官方远端 `main` 已核对到提交 `b3d5265f58522bab67e06168d436b3b328cbae60`。它相对上一审计基线仅包含 Docker 安全加固，Wizard 终态、Hosted 工作保留、配置应用修订、重载和认证代次契约没有变化。
- `pnpm lint` 已通过，包含 904 个文件的模块边界检查、版本一致性和 TypeScript 类型检查。
- `pnpm test` 已通过，包含 2790 项前端测试和 238 项脚本测试。
- `pnpm build` 已通过，包含协作插件、钉钉业务插件、TypeScript 与 Vite 生产构建；`pnpm verify:openclaw-docs` 已通过。
- `git diff --check`、本次修改文件的 Emoji 扫描和多语言 JSON 解析已通过。
- 本轮未修改 Rust；既有 Rust 验证结果不能替代本次 TypeScript 接管链路验证，本轮不重复声称 Rust 真机通过。

## 已知问题与未验证边界

- 最新 OpenClaw 上的真实 Guided provider、浏览器授权、官方活动工作延迟重启、token 轮换和新认证连接尚未完成 macOS 安装包端到端验证。
- 当前本机已安装 Runtime 缺少活动配置修订字段，只能验证“证据不可用”分支，不能证明最新版 Runtime 的成功接管链路。
- macOS、Windows、Linux 与 Docker 的系统服务、凭据库、连接轮换和首次进入工作台仍需分别在目标环境真机验证。
- 真实渠道插件授权、Classic Wizard 收尾、暗色主题、窄窗口、键盘焦点和减少动态效果不属于本轮自动化能够证明的范围。
- 本轮未构建、签名、公证或发布安装包。

## 下一步顺序

1. 在最新版 OpenClaw Runtime 上执行真实配置终态、官方延迟重启和活动修订收敛验证。
2. 覆盖共享 token 轮换、设备凭据连接、主连接换代和管理员临时写请求的真实 Gateway 场景。
3. 重新生成安装包后验证 macOS 首次安装，再分别完成 Windows、Linux 与 Docker 真机验收。
4. 未经明确要求不推送、打 tag 或发布。
