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
