# OpenClaw Wizard 终态交接审计

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
- 服务交接后改用全局 Gateway 生命周期协调器重新解析目标和凭据、建立认证连接，再探测所选 Runtime；删除终态后的局部连接轮询完成条件。
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

- 终态交接使用 `reconnectAfterCurrent`：先等待已有生命周期收敛，再发起并等待一项来源明确的新重连。
- 安装阶段的显式重连会按需激活连接管理器，运行时探测能够驱动新的 WebSocket 连接。
- 系统服务交接命令返回 `false` 时立即保留真实交接失败，不再继续执行并误报为认证连接超时。
- 官方终态只执行一次服务交接。后续“重新核验”只重新建立认证连接并核验所选 Runtime，不再重复交接、重启或调用 Wizard。
- 被其他运行时操作替代的核验单独显示真实状态，不再伪装为连接超时。

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

### 复核结论

- 新 GIF 共约 137 秒。官方渠道步骤已经推进到 `Done`，但确认该步骤的 `wizard.next` 没有取得 `done` 终态；Gateway 连接源变化后，原进程内 `sessionId` 已不存在。
- `Done` 是 `WizardSessionPrompter.outro` 产生的普通 `note`。Runner 只有在该步骤被确认并完成后续逻辑后才进入 `done`，因此标题、配置文件、端口健康和连接恢复均不能替代终态响应。
- 最新 OpenClaw 主线通过 `retainGatewayWorkUntilSettled` 保持 Gateway 工作准入，官方注释明确说明配置 reload 可能清除进程内 Wizard 会话。本机安装的 OpenClaw `2026.7.1-2` 没有该保护，只作为本次兼容差异的复现证据。
- `openclaw.setup.detect` 与 `openclaw.setup.verify` 不在当前安装版或最新官方 Gateway 方法注册表中。上一轮把 `unknown method` 转换成“官方检测仍要求继续配置”，属于错误的协议推断。

### 修正目标

- 删除两个未注册 RPC 及其专属客户端、测试和文档。
- 首次配置默认进入官方 Wizard。同一次流程只有官方终态可以清除 onboarding requirement。
- 会话丢失后只保留终态未知，不从配置、健康、文本或本地旧步骤推断成功或仍需配置。
- 终态未知不会自动重放。用户显式重新开始时，界面通过可取消的二次确认说明可能重复执行持久配置步骤。
- 使用包含官方工作准入修复的 OpenClaw 运行时是避免该竞态的根治条件；JunQi 不复制上游 Session 状态机。

### 未验证边界

- 当前正式发布版 OpenClaw 是否已经包含主线工作准入修复，需要在打包和真机复验时按实际源码重新核对，不能以版本字符串推断。
- 旧运行时丢失进程内会话后不存在官方恢复终态的协议，JunQi 只能保留未知状态。
