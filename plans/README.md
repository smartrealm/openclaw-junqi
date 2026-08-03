# 实施计划索引

`plans/` 保存文件级实施顺序和验证步骤。问题定义与验收条件位于 [`../specs/`](../specs/README.md)，审计和设计背景位于 [`../docs/`](../docs/README.md)。

```text
plans/
├── installation/   安装、首次启动、Wizard 与卸载
├── gateway/        Gateway 服务归属
├── collaboration/  多智能体协作安装与运行边界
├── business/       企业业务应用集成
├── quality/        产品模块与运行质量
└── workbench/      AI 工作台、文件平台与开发工具基础设施
```

## Installation

- [Windows OpenClaw runtime 加固](installation/2026-07-18-windows-openclaw-runtime-hardening.md)
- [Setup onboarding 加固](installation/2026-07-20-setup-onboarding-hardening.md)
- [Setup onboarding 二次复审](installation/2026-07-20-setup-onboarding-second-pass.md)
- [安装诊断完整性](installation/2026-07-21-install-diagnostics-completeness.md)
- [Windows OpenClaw Wizard](installation/2026-07-23-openclaw-windows-wizard.md)
- [Windows OpenClaw Wizard 可视化加固](installation/2026-08-03-windows-openclaw-wizard-visual-hardening.md)
- [Windows 首次安装](installation/2026-07-24-openclaw-windows-first-run.md)
- [设备审批与首次进入体验](installation/2026-08-03-device-approval-experience.md)
- [首次安装底部操作区响应式修复](installation/2026-08-02-setup-footer-responsive-actions.md)
- [Windows 卸载流程](installation/2026-07-26-windows-uninstall-flow.md)
- [Setup runtime 与渠道兼容](installation/2026-07-27-setup-runtime-and-channel-compatibility.md)

## Gateway

- [Gateway 服务归属](gateway/2026-07-24-openclaw-gateway-service-ownership.md)

## Collaboration

- [本机 System Service 协作启用归属修复](collaboration/2026-07-31-local-system-service-collaboration-enablement.md)
- [Agent Office 只读协作投影](collaboration/2026-08-03-agent-office-read-only-projection.md)

## Business

- [业务应用 UI 实施计划](business/2026-08-02-business-applications-ui.md)

## Workbench

- [AI 工作台与共享文件平台](workbench/2026-07-28-ai-workspace-and-shared-files-platform.md)

## Quality

- [P0 IPC 与 Gateway 边界收敛](quality/2026-08-03-p0-ipc-and-gateway-boundary.md)
- [本地 main 对齐与客户端边界](quality/2026-08-04-local-main-alignment-and-client-boundary.md)
- [OpenClaw Gateway 挑战与策略对齐](quality/2026-08-04-openclaw-gateway-challenge-policy-alignment.md)

- [Dashboard operations](quality/2026-07-20-dashboard-operations.md)
- [Session origin aggregation](quality/2026-07-20-session-origin-aggregation.md)
- [会话分组与后台活动下钻](quality/2026-07-31-session-background-activity-drilldown.md)
- [会话渠道来源呈现](quality/2026-07-31-session-channel-presentation.md)
- [OpenClaw 原生会话体验对齐](quality/2026-08-02-openclaw-native-session-experience.md)
- [原生新建会话列表竞态修复](quality/2026-08-03-native-session-list-race.md)
- [新建会话生命周期加固](quality/2026-08-03-new-session-lifecycle-hardening.md)
- [Chat 流式渲染性能](quality/2026-08-03-chat-stream-rendering-performance.md)
- [Tauri listener lifecycle](quality/2026-07-22-tauri-listener-lifecycle.md)
- [Tauri command boundary](quality/2026-07-27-tauri-command-boundary.md)
- [字体设置与 Orca 对齐](quality/2026-07-28-font-settings-orca-parity.md)
- [设置与运行时一致性](quality/2026-07-28-settings-runtime-consistency.md)
- [Vite 生产分包](quality/2026-07-28-vite-chunking.md)
- [工作台可靠性](quality/2026-07-29-workspace-reliability.md)
- [无引用代码与终端类型收敛](quality/2026-07-29-dead-code-convergence.md)
- [加载指示器收敛](quality/2026-07-29-loading-indicator-convergence.md)
- [用户消息恢复操作](quality/2026-07-29-user-message-recovery-actions.md)
- [萌宠文字与聊天窗口恢复](quality/2026-07-29-pet-caption-and-chat-window-recovery.md)
- [会话模型切换权限修复](quality/2026-07-29-session-model-switch-permissions.md)
- [会话模型选择器与 OpenClaw 对齐](quality/2026-07-30-session-model-picker-openclaw-parity.md)
- [侧栏主操作一致性](quality/2026-07-30-sidebar-primary-action-convergence.md)
- [会话模型切换闪动修复](quality/2026-07-30-session-model-switch-flicker.md)
- [主窗口关闭 ACL 修复](quality/2026-07-30-main-window-close-acl.md)
- [设置页面多语言完整性](quality/2026-07-30-settings-localization-completeness.md)
- [全局专注上下文与任务简报](quality/2026-07-30-focus-context-and-task-briefs.md)
- [Chat 执行计划](quality/2026-07-30-chat-execution-plan.md)
- [ReAct 任务检查点与恢复](quality/2026-08-02-react-task-checkpoint-recovery.md)
- [OpenClaw Stop 检查点与队列对齐](quality/2026-08-03-openclaw-stop-checkpoint-queue-alignment.md)
- [OpenClaw Stop 会话身份围栏](quality/2026-08-03-openclaw-stop-session-identity-fence.md)
- [OpenClaw Composer 队列权威对齐](quality/2026-08-03-openclaw-composer-queue-authority.md)
- [OpenClaw 本地发送队列交付原子性](quality/2026-08-04-openclaw-local-send-queue-dispatch-atomicity.md)
- [Gateway AI 诊断](quality/2026-07-30-gateway-ai-diagnostics.md)
- [终端与工作台 Chrome 一致性](quality/2026-07-30-terminal-workbench-chrome-convergence.md)
- [Chat 消息预览与 OpenClaw 对齐](quality/2026-07-30-chat-message-preview-openclaw-parity.md)
- [Chat 输出文件预览](quality/2026-08-02-chat-output-file-preview.md)
- [JunQi Desktop 登录自启动](quality/2026-08-02-junqi-app-autostart.md)
- [Chat 响应追溯与人工审核](quality/2026-07-31-chat-response-trace-and-human-review.md)
- [OpenClaw 审计账本对齐](quality/2026-08-03-openclaw-audit-ledger.md)
- [OpenClaw 压缩事件追溯](quality/2026-08-03-openclaw-compaction-trace.md)
- [OpenClaw Talk 能力目录对齐](quality/2026-08-03-openclaw-talk-catalog.md)
- [OpenClaw 原生 TTS 客户端对齐](quality/2026-08-03-openclaw-native-tts-client.md)
- [OpenClaw 原生 TTS 状态对齐](quality/2026-08-03-openclaw-native-tts-status.md)
- [OpenClaw 原生 TTS 偏好对齐](quality/2026-08-03-openclaw-native-tts-preferences.md)
- [OpenClaw 原生模型认证状态对齐](quality/2026-08-03-openclaw-native-model-auth-status.md)
- [OpenClaw 原生提供方配额对齐](quality/2026-08-03-openclaw-native-provider-usage.md)
- [OpenClaw 客户端本机用量旁路退役](quality/2026-08-03-openclaw-client-local-usage-sidechannel-retirement.md)
- [OpenClaw 工具入口权威对齐](quality/2026-08-03-openclaw-tools-route-authority.md)
- [OpenClaw 会话用量范围对齐](quality/2026-08-03-openclaw-sessions-usage-range.md)
- [OpenClaw 会话操作事件对齐](quality/2026-08-03-openclaw-session-operation.md)
- [OpenClaw 原生会话压缩对齐](quality/2026-08-04-openclaw-native-session-compaction.md)
- [OpenClaw 会话压缩异步反馈](quality/2026-08-04-openclaw-session-compaction-feedback.md)
- [OpenClaw 原生压缩检查点只读](quality/2026-08-03-openclaw-native-compaction-checkpoint-read.md)
- [OpenClaw Session Observer 灵动岛](quality/2026-08-03-openclaw-session-observer-dynamic-island.md)
- [OpenClaw 原生会话中止对齐](quality/2026-08-03-openclaw-native-session-abort.md)
- [OpenClaw 原生会话分组与 Jarvis 对齐](quality/2026-08-03-openclaw-native-session-groups-jarvis.md)
- [OpenClaw 全局语音唤醒触发词对齐](quality/2026-08-03-openclaw-voicewake-global-triggers.md)
- [OpenClaw 原生会话转向核验对齐](quality/2026-08-03-openclaw-native-session-steer-reconciliation.md)
- [OpenClaw 原生会话队列对齐](quality/2026-08-03-openclaw-native-session-queue-alignment.md)
- [OpenClaw 原生会话预览对齐](quality/2026-08-03-openclaw-native-session-preview.md)
- [OpenClaw 原生有效工具目录对齐](quality/2026-08-03-openclaw-native-tools-effective.md)
- [OpenClaw 原生工具目录对齐](quality/2026-08-03-openclaw-native-tools-catalog.md)
- [OpenClaw 运行时命令目录对齐](quality/2026-08-03-openclaw-runtime-command-catalog.md)
- [OpenClaw 原生工具调用对齐](quality/2026-08-03-openclaw-native-tools-invoke.md)
- [OpenClaw 原生产物协议对齐](quality/2026-08-03-openclaw-native-artifacts.md)
- [OpenClaw 原生记忆检索对齐](quality/2026-08-03-openclaw-native-memory-search.md)
- [OpenClaw 原生记忆诊断](quality/2026-08-03-openclaw-native-memory-diagnostics.md)
- [OpenClaw 原生会话检索对齐](quality/2026-08-03-openclaw-native-session-search.md)
- [OpenClaw 原生技能目录字段对齐](quality/2026-08-03-openclaw-native-skill-catalog-fidelity.md)
- [OpenClaw 技能归档上传](quality/2026-08-03-openclaw-skills-upload.md)
- [OpenClaw 原生技能卡对齐](quality/2026-08-03-openclaw-native-skill-card.md)
- [OpenClaw 原生技能生命周期对齐](quality/2026-08-03-openclaw-native-skill-curator.md)
- [OpenClaw 原生技能提案清单对齐](quality/2026-08-03-openclaw-native-skill-proposal-manifest.md)
- [OpenClaw 原生技能提案范围对齐](quality/2026-08-03-openclaw-native-skill-proposal-scope.md)
- [OpenClaw 原生技能提案详情对齐](quality/2026-08-03-openclaw-native-skill-proposal-inspect.md)
- [OpenClaw 原生技能提案事件对齐](quality/2026-08-03-openclaw-native-skill-proposal-events.md)
- [OpenClaw 原生审批](quality/2026-08-03-openclaw-native-approvals.md)
- [OpenClaw 审批最小权限对齐](quality/2026-08-03-openclaw-approval-scope-alignment.md)
- [OpenClaw 原生任务账本](quality/2026-08-03-openclaw-native-task-ledger.md)
- [OpenClaw 原生 Cron 运行语义](quality/2026-08-03-openclaw-native-cron-run.md)
- [OpenClaw Cron 日历投影](quality/2026-08-03-openclaw-cron-calendar-projection.md)
- [OpenClaw Cron 调度器状态](quality/2026-08-03-openclaw-cron-scheduler-status.md)
- [OpenClaw Cron 写操作授权与日历一致性](quality/2026-08-03-openclaw-cron-mutation-authority.md)
- [Tauri 适配器遗留 IPC 契约](quality/2026-08-03-tauri-adapter-legacy-ipc.md)
- [Collaboration Bootstrap Target 子域拆分](quality/2026-08-03-collaboration-bootstrap-target-slice.md)
- [Collaboration Bootstrap Agent Policy 子域拆分](quality/2026-08-03-collaboration-bootstrap-agent-policy-slice.md)
- [Collaboration Bootstrap Package 子域拆分](quality/2026-08-03-collaboration-bootstrap-package-slice.md)
- [安装、仪表盘、聊天、模型与渠道运行时边界](quality/2026-07-31-installation-dashboard-chat-provider-channel-runtime-boundaries.md)
- [语音唤醒工作台](quality/2026-07-31-voice-wake-workspace.md)
- [跨平台语音唤醒宿主](quality/2026-08-02-cross-platform-voice-wake-host.md)
- [业务引导平台](quality/2026-07-31-business-onboarding-platform.md)
- [发布 CI 与安装包构建收敛](quality/2026-08-01-release-ci-build-convergence.md)
- [Chat 通知幂等与消息操作栏](quality/2026-08-01-chat-notification-idempotency-and-message-actions.md)
- [OpenClaw Gateway IPC 出口收敛](quality/2026-08-02-openclaw-gateway-ipc-boundary-convergence.md)
- [OpenClaw 技能运行时出口收敛](quality/2026-08-02-openclaw-skills-runtime-convergence.md)
- [OpenClaw 技能归档上传](quality/2026-08-03-openclaw-skills-upload.md)
- [全局协作 Activity 与 Needs You](quality/2026-08-03-global-collaboration-activity.md)
- [OpenClaw 上下文压缩追溯](quality/2026-08-03-openclaw-compaction-trace.md)
- [OpenClaw 审计终态追溯投影](quality/2026-08-03-openclaw-audit-status-projection.md)
- [OpenClaw 响应用量追溯](quality/2026-08-03-openclaw-response-usage-trace.md)
- [OpenClaw 跨运行审计账本](quality/2026-08-03-cross-run-audit-ledger.md)
- [OpenClaw 工作区记忆收敛](quality/2026-08-02-openclaw-workspace-memory-convergence.md)
- [定时任务 OpenClaw Agent 路由](quality/2026-08-02-cron-openclaw-agent-routing.md)
- [Cron 事件状态投影](quality/2026-08-03-cron-event-state-projection.md)
- [Gateway 凭据绑定失败关闭](quality/2026-08-03-gateway-credential-binding-fail-closed.md)
- [Gateway Client 平台身份](quality/2026-08-03-gateway-client-platform-identity.md)
- [OpenClaw Operator Protocol v4](quality/2026-08-03-openclaw-operator-protocol-v4.md)
- [Gateway Task Ledger 详情](quality/2026-08-03-task-ledger-details.md)
- [Windows Gateway 重启后续加固计划](quality/2026-08-03-windows-gateway-restart-followup.md)
- [Agent Profile 本地元数据](quality/2026-08-03-agent-profile-metadata.md)
- [Agent canonical main session 投影](quality/2026-08-03-agent-main-session-projection.md)
- [OpenClaw tools.invoke 受控调用](quality/2026-08-03-openclaw-tools-invoke.md)
- [Provider Catalog 构建可复现性](quality/2026-08-03-provider-catalog-build-reproducibility.md)
