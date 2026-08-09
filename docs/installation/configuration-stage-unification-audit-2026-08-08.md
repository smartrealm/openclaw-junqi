# 首次引导配置阶段统一记录

日期：2026-08-08

## 问题

运行时启动完成后，状态机先进入 `gateway-ready` 并由 `ProgressScreen` 呈现“Gateway 已就绪”，用户点击下一步后再进入 `configure-openclaw` 并由 `WizardScreen` 呈现“配置 OpenClaw”。这两个页面描述的是同一个用户目标的相邻检查点，却使用不同页面组件和不同场景键，造成重复进入和自动跳转的视觉感受。

## 依据

- JunQi `useSetupFlow.continueAfterGatewayReady` 已将 Gateway 就绪后的配置核验与官方 Wizard 启动分开：先执行配置完成门禁，只有 `onboarding-required` 才进入官方 Wizard。
- JunQi `useWizardSession` 是官方 Wizard 的唯一启动者，且只在 `configure-openclaw` 状态创建或恢复会话。
- OpenClaw 配置、模型验证和 Wizard 的结果均由 Gateway 提供；JunQi 只能重新组织客户端呈现，不能合并其成功语义。

## 设计结论

保留 `gateway-ready` 作为运行时状态，但将其投影到“配置 OpenClaw”步骤。空闲、核验中与失败时显示同一配置容器内的 Gateway 检查状态；需要配置时原地交给现有官方 Wizard 呈现器。二者共享场景键，因此状态变化只替换内容，不重建页面或产生导航动画。

首次配置只发起默认 `wizard.start`。OpenClaw 的完整向导会话包含可选渠道选择；JunQi 不再在模型核验后创建单独的渠道步骤，也不发送 `flow` 或 `skipChannels` 参数。Gateway 若跳过渠道，会返回同一会话中的结构化说明步骤，JunQi 使用按 `step.type` 注册的渲染器展示该说明。渲染器按 `note`、`text`、`select`、`multiselect`、`confirm`、`progress`、`action` 划分，不能按渠道或步骤 id 推断上游流程。

## 验证边界

- 已通过统一配置容器的空闲、核验中、失败三态服务端渲染回归，以及配置场景键、引导呈现状态、安装控制台和首次引导回归测试。
- 默认 `wizard.start` 请求与渠道跳过 `note` 步骤均有协议回归测试；独立渠道向导的本地状态、页面、存储和文档已删除。
- 已通过 `pnpm lint`、完整 `pnpm test`、`pnpm build`、官方 OpenClaw 文档链接验证、语言 JSON 解析、`git diff --check` 和本次修改文件完整 Emoji 扫描。
- 真实 Gateway 的模型验证、官方 Wizard、亮暗主题、窄窗口和键盘焦点仍需在 Tauri 桌面应用中验收；自动化不替代这些结果。
