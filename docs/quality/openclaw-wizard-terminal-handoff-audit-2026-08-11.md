# OpenClaw Wizard 终态交接审计

更新时间：2026-08-14

## 范围与依据

本次审计覆盖首次配置中的 `wizard.next`、授权步骤投影、官方终态、Gateway 服务交接、认证连接核验和失败重试。协议依据为 OpenClaw 官方 `WizardSession`、Gateway Wizard handler 和钉钉官方连接器设备授权实现；当前安装版本只用于复现，不作为能力开关。

## 严重问题

### BUG-WIZ-01：官方终态后的失败会重新启动 Wizard

位置：`src/hooks/useSetupFlow/useWizardSession.ts`

当前行为：官方结果已经是 `done` 时，JunQi 继续执行 Gateway 服务交接。交接或认证连接核验失败后，页面仍暴露通用 Wizard“重试”；由于官方会话已被回收，重试会调用新的 `wizard.start`，使用户重新配置已经完成的模型、凭据、工作区和渠道。

影响：可能重复进入有持久副作用的官方配置流程，也会把 JunQi 本地连接失败错误描述成 OpenClaw 配置失败。

目标：官方终态只消费一次。后续失败只能重新执行 Gateway 交接、重连和身份核验，不得启动、恢复或重放 Wizard。

### BUG-WIZ-02：交接后的认证连接未使用统一生命周期收敛

位置：`src/hooks/useSetupFlow/useWizardSession.ts`

当前行为：终态处理直接调用 Tauri 交接命令，然后通过局部轮询检查 `gateway.getStatus().connected`。如果旧连接在交接命令返回后才关闭，局部轮询不会再次解析新凭据并建立连接，最终报告认证连接超时。

影响：Gateway 进程和官方服务可能已经就绪，但首次配置仍停在失败页面。

目标：交接后通过全局 Gateway 生命周期协调器重新解析当前运行时目标和凭据，并等待新的已认证、已核验连接；随后再执行 selected runtime 探测。

## 中等问题

### BUG-WIZ-03：授权步骤提交后仍展示旧二维码

位置：`src/pages/SetupPage/WizardScreen.tsx`、`src/hooks/useSetupFlow/useWizardSession.ts`

当前行为：客户端提交授权步骤后，OpenClaw 会清除服务端当前步骤并等待插件轮询产生下一步；JunQi 在请求返回前继续渲染旧步骤，所以二维码和“下一步”语义同时保留。

目标：提交当前步骤后立即进入绑定该步骤标识的等待投影，不再把旧步骤显示为仍可交互。授权成功、失败、取消或新步骤到达时由官方响应收敛状态。

## 未验证边界

- macOS 官方服务交接与新连接建立仍需使用本地安装包真机验证。
- Windows 服务交接、Credential Manager 和安装后首次授权仍需 Windows 真机验证。
- 钉钉二维码有效期和扫码终态继续由官方插件拥有；JunQi 不实现第二套渠道轮询或成功推断。

## 实施结果

- 官方 `done` 结果进入独立的 Runtime 恢复模式。交接失败页面只提供“重新核验”，该操作不再调用任何 Wizard 启动、恢复或步骤提交接口。
- 服务交接后优先复用当前已核验 Gateway 连接；只有连接失效时才通过全局生命周期协调器以 `selected-runtime` 目标范围重新解析当前端点和凭据并重连。所选 Runtime、配置终态和真实模型核验均绑定同一连接标识。
- 授权步骤提交后，旧步骤和二维码替换为等待投影。`wizard.next` 不再使用客户端固定时限，插件仍拥有扫码轮询、过期和终态。
- 只有 Gateway 生命周期重连和所选 Runtime 探测全部成功后，才清除 onboarding requirement 并进入 Ready。

## 自动化验证

- OpenClaw Wizard 服务测试、首次配置界面测试与设置流程回归测试通过。
- 完整 `pnpm test`、`pnpm lint` 与 `pnpm build` 通过。
- Rust 代码未修改，因此本次没有重复执行 Rust 测试。

## 2026-08-12 终态连接竞态修复

### 复现证据

- 官方 Wizard 返回 `done` 后，系统服务重启完成，所选 Gateway 的健康探测通过。
- 新服务日志没有出现 JunQi 的新 WebSocket `hello-ok`，页面却把无具体错误的生命周期失败统一显示为认证连接超时。
- 安装阶段尚未挂载仪表盘的常驻 Gateway 管理器。直接调用 `reconnect()` 时，未激活的生命周期会丢弃探测结果，无法驱动新的连接。
- 统一协调器在已有操作期间会共享较弱请求的结果。Wizard 终态重连因此可能取得前一项恢复或重启的终态，而不是属于本次交接的新连接结果。

### 当前行为

- 终态交接先捕获当前已核验连接；只有连接缺失时才使用 `reconnectAfterCurrent`，不再把健康连接强制转换成新的等待条件。
- 安装阶段的显式重连会按需激活连接管理器，运行时探测能够驱动新的 WebSocket 连接。
- 系统服务交接命令返回 `false` 时立即保留真实交接失败，不再继续执行并误报为认证连接超时。
- 官方终态只执行一次服务交接。后续“重新核验”只核验当前连接、所选 Runtime、配置终态和真实模型；连接失效时才重连，不再重复交接、重启或调用 Wizard。
- 被其他运行时操作替代的核验单独显示真实状态，不再伪装为连接超时。
- 交接重连不再沿用历史手动连接目标。官方 Wizard 写入或轮换连接配置后，连接管理器会重新读取当前所选 Runtime，再等待新的认证连接。

### 验证结果

- Gateway 管理器、生命周期协调器、连接收敛、Wizard 终态和配置页面定向测试共 95 项通过。
- macOS 安装包中的真实终态交接仍需重新构建后验证；Windows 与 Linux 系统服务交接仍未真机验证。

## 2026-08-12 安装包 GIF 复验与阶段性修复

### 复现证据

- 用户提供的 `/Users/wei/Desktop/流程.gif` 记录了一次约 224 秒的真实首次配置：钉钉授权与后续官方步骤正常推进，提交 `Done` 后界面等待约两分钟，随后显示“Gateway 进程已就绪，但 JunQi 未能在限定时间内完成经认证的 Gateway 连接”。
- 用户点击重试后，界面重新进入 `QuickStart`、模型、搜索、安全和 `Done` 等完整官方流程，没有进入 Dashboard。
- 代码检查确认，提交期间 Gateway 连接源变化时，JunQi 会尝试恢复旧 `sessionId`；一旦收到 `WIZARD_NOT_FOUND`，旧实现直接调用新的 `wizard.start`。因此本地连接竞态被错误转换成了有持久副作用的完整配置重放。
- OpenClaw 当前主线在 Wizard handler 中使用 `retainGatewayWorkUntilSettled`，避免配置重载过早清除进程内会话。当前安装版本仍可复现会话先被回收的兼容差异，客户端不能假定一定能收到原 `done` 响应。

### 阶段性行为

- `WIZARD_NOT_FOUND` 不再自动调用 `wizard.start`，也不再构造或缓存本地 `done` 结果。
- 该阶段曾在恢复所选 Runtime 的认证连接后调用项目自定义配置检测，并据此尝试区分完成与仍需 onboarding。
- 后续协议复核确认该检测方法未被 OpenClaw 注册，因此这部分行为已由下节的终态未知模型取代，不能作为当前实现依据。
- 删除 `OpenClawWizardClient.restartAfterSessionLoss()`，避免其他调用方重新引入隐式重放路径。

### 当时验证结果

- 会话丢失、显式重启、终态交接、页面操作和取消围栏定向测试共 107 项通过。
- `npm run lint` 通过，包含模块边界、版本一致性和 TypeScript 检查。
- 修复后的 macOS 安装包与 GIF 同路径真实复验尚未执行；Windows 与 Linux 仍未真机验证。

## 2026-08-12 协议复核与终态未知加固

本节记录的是旧 Runtime 兼容问题。关于最新版 OpenClaw 默认 guided inference 和正式 setup RPC 的当前结论，以 [OpenClaw 原生安装对齐审计](openclaw-native-installation-alignment-audit-2026-08-12.md) 为准。

### 复核结论

- 新 GIF 共约 137 秒。官方渠道步骤已经推进到 `Done`，但确认该步骤的 `wizard.next` 没有取得 `done` 终态；Gateway 连接源变化后，原进程内 `sessionId` 已不存在。
- `Done` 是 `WizardSessionPrompter.outro` 产生的普通 `note`。Runner 只有在该步骤被确认并完成后续逻辑后才进入 `done`，因此标题、配置文件、端口健康和连接恢复均不能替代终态响应。
- 最新 OpenClaw 主线通过 `retainGatewayWorkUntilSettled` 保持 Gateway 工作准入，官方注释明确说明配置 reload 可能清除进程内 Wizard 会话。本机安装的 OpenClaw `2026.7.1-2` 没有该保护，只作为本次兼容差异的复现证据。
- 当时本机安装版没有注册 `openclaw.setup.detect` 与 `openclaw.setup.verify`，把该 Runtime 的 `unknown method` 转换成“官方检测仍要求继续配置”属于错误推断。OpenClaw 最新主线现已正式注册这些方法，因此不能把旧版运行结果推广为当前官方契约。

### 修正目标

- 对当时本机旧 Runtime，删除无法调用的方法及其猜测性响应映射；最新版默认流程需要按正式 setup RPC 重新接入。
- 首次配置默认进入官方 Wizard。同一次流程只有官方终态可以清除 onboarding requirement。
- 会话丢失后只保留终态未知，不从配置、健康、文本或本地旧步骤推断成功或仍需配置。
- 终态未知不会自动重放。用户显式重新开始时，界面通过可取消的二次确认说明可能重复执行持久配置步骤。
- 使用包含官方工作准入修复的 OpenClaw 运行时是避免该竞态的根治条件；JunQi 不复制上游 Session 状态机。

### 未验证边界

- 当前正式发布版 OpenClaw 是否已经包含主线工作准入修复，需要在打包和真机复验时按实际源码重新核对，不能以版本字符串推断。
- 旧运行时丢失进程内会话后不存在官方恢复终态的协议，JunQi 只能保留未知状态。

## 2026-08-12 完成交接后的组件重建

本节以下记录已被删除的 Classic 默认路径，仅用于说明历史根因。当前 Guided 与 Classic 已改为复用统一的认证连接、Runtime、官方配置和模型核验交接门禁，不再使用进程内完成凭据作为配置事实。

### 根因

- 官方 Wizard 终态与 Gateway 交接已经核验成功，但 JunQi 只修改了当前 Hook 的 onboarding 状态。
- 首次设置组件重建后默认门禁恢复，自动启动 effect 在没有活动 `sessionId` 时再次调用 `wizard.start`。

### 修复

- 历史实现曾在官方终态与 Gateway 交接后记录进程内完成凭据，用于阻止组件重建时再次启动 Classic Wizard。
- 当前实现已删除该凭据；是否需要配置由正式 `setup.detect` 决定，配置终态由统一交接门禁核验。

### 验证

- 该历史路径的定向测试曾通过，现已由原生安装对齐测试取代。
- 应用进程内组件重建路径尚待 macOS 安装包真机验证。

## 2026-08-14 活动配置与认证连接接管审计

### 官方源码依据

- 基准为 OpenClaw `origin/main` 提交 `b3d5265f58522bab67e06168d436b3b328cbae60`。相对前一基线的新增提交只涉及 Docker 安全加固，下列 Wizard、配置应用、重载与认证轮换契约没有变化。
- `WizardSessionPrompter.outro` 产生的 `Done` 仍是 `done: false` 的普通 note；Runner 返回后下一次 `wizard.next` 才提供 `done: true` 终态。
- Wizard 写入 `gateway.auth`、端口或 bind 后需要 Runtime 重载。Hosted Wizard 会保留活动工作，正常重启可延后至 Runner 收敛之后，最长活动工作等待为五分钟。
- `config.get.configRevisionHash` 与 `appliedConfigHash` 相等是活动 Runtime 已采用磁盘修订的正式证据。`config.get.hash` 只属于写入冲突控制，不能证明活动修订。
- 认证配置轮换可能在实际进程重启前关闭旧共享认证连接，因此向导前仍健康的 socket 和旧 token 都不能作为完成证据。

### 根因

- 旧交接只检查连接和健康探测，没有核对活动配置修订，可能在 OpenClaw 官方重启尚未发出前把旧连接误报为 Ready。
- 旧交接在较短窗口后显式重启 Gateway，可能与 OpenClaw 已排队的官方重启竞态，造成双重重启、会话丢失或认证连接反复切换。
- 连接收敛层没有把 Runtime Identity 核验失败绑定到当前连接代次，用户只能看到通用 60 秒超时；进程观察的瞬时错误又可能过早终止仍会成功的 WebSocket 认证。
- Guided 供应商 Wizard 曾把 `status: done` 单独视为终态，可能跳过仍需确认的官方步骤。
- 手工输入的 Gateway shared token 曾写入设备凭据持久层，混淆两类 secret 的所有权和生命周期。

### 当前实现

- Guided、Classic 与渠道 Wizard 都只接受 `done === true` 的终态；非终态步骤继续呈现，不从标题或 status 猜测完成。
- 交接重新解析当前所选 Runtime 的端点与凭据，在同一已核验连接上要求非空 `configRevisionHash === appliedConfigHash`。
- 官方重载等待、连接轮换、最多一次补偿重启、模型核验和最终二次修订核验共享一个六分钟绝对截止时间。普通等待超时不主动重启；只有正式配置 `gateway.reload.mode: off` 或官方健康响应 `configReload.hotReloadStatus: disabled` 明确重载关闭时才通过唯一生命周期协调器补发一次重启。
- 生命周期屏障携带真实重启尝试代次。代次只在协调器调用原生 `manager.restart()` 前递增，恢复动作内部重启、结果未知的重启和两次屏障之间快速完成的重启都会禁止同一交接事务再次补偿。
- Runtime Identity 核验失败立即返回当前连接的具体诊断；连接尝试终态失败和重试耗尽才结束收敛，进程观察瞬时错误只保留为待定诊断。
- 进入 Ready 前再次在同一连接围栏读取活动配置修订；只有连接标识和已核验修订都未改变才可完成，修订漂移时回到同一事务重新核验。
- WebSocket 只有在仍处于打开状态且 Runtime Identity 核验完成后才发布连接可用；核验等待期间连接关闭或换代会作废待定身份，迟到结果不能残留为已核验 Runtime。
- Gateway Manager 只管理连接轮次，Connection 独占 WebSocket 尝试、退避与耗尽。进程健康观察不会重置退避或并发发起连接；显式同目标连接先断开再重建，不能因底层无操作而停在探测状态。
- 新的 `connect` 响应被接受后立即清除旧配对等待，后续协议或身份失败进入有界普通重试，不能无限按配对间隔轮询。普通配对取消通过 Manager 统一收敛活动握手与 timer gap，且只有用户显式恢复才开启新轮次。
- 管理写请求使用临时特权连接时，在握手完成后、发送 RPC 前再次核对主连接标识、端点和凭据；来源换代后只允许拒绝，不能事后报告失败却已经发送副作用。
- shared token 只用于当前进程重连，设备凭据只接受 OpenClaw 握手签发并存入设备凭据边界。

### 验证边界

- 定向连接安全、生命周期、配置应用和 Wizard 回归已通过。
- 完整 `pnpm lint` 已通过，包含模块边界、版本一致性和 TypeScript 类型检查。
- 完整 `pnpm test` 已通过，共覆盖 2790 项前端测试和 238 项脚本测试。
- `pnpm build` 与 `pnpm verify:openclaw-docs` 已通过；生产构建同时验证了协作插件和钉钉业务插件产物。
- 本机安装的 OpenClaw `2026.7.1-2` 缺少活动配置修订字段，只能复现“证据不可用”分支，不能验证新版成功接管链路。
- 最新 OpenClaw、macOS 安装包、Windows 和 Linux 上的真实 token 轮换、官方延迟重启与新认证连接仍需真机端到端验证。
