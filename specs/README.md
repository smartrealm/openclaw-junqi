# 规格与验收索引

`specs/` 保存问题定义、目标、约束和验收条件。实施顺序位于 [`../plans/`](../plans/README.md)，背景审计与验证记录位于 [`../docs/`](../docs/README.md)。

```text
specs/
├── installation/    安装、首次启动、Wizard 与卸载
├── gateway/         Gateway 生命周期与服务归属
├── collaboration/   多智能体协作与发布证据
├── business/        企业业务应用集成
└── quality/         产品模块与运行质量
```

## Installation

- [Setup onboarding 加固](installation/2026-07-20-setup-onboarding-hardening.md)
- [Setup onboarding 二次复审](installation/2026-07-20-setup-onboarding-second-pass.md)
- [安装诊断](installation/2026-07-21-install-diagnostics-bugfix.md)
- [Windows Native 安装](installation/2026-07-21-windows-native-install-bugfix.md)
- [Windows OpenClaw Wizard](installation/2026-07-23-openclaw-windows-wizard-bugfix.md)
- [Windows 首次安装](installation/2026-07-24-openclaw-windows-first-run-bugfix.md)
- [首次安装底部操作区响应式修复](installation/2026-08-02-setup-footer-responsive-actions.md)
- [Windows 卸载流程](installation/2026-07-26-windows-uninstall-flow-bugfix.md)
- [Setup runtime 与渠道兼容](installation/2026-07-27-setup-runtime-and-channel-compatibility.md)

## Gateway

- [Gateway 生命周期](gateway/2026-07-18-openclaw-gateway-lifecycle-bugfix.md)
- [Gateway 服务归属](gateway/2026-07-24-openclaw-gateway-service-ownership-bugfix.md)

## Collaboration

- [OpenClaw 多智能体协作](collaboration/2026-07-16-openclaw-agent-collaboration-bugfix.md)
- [协作发布证据](collaboration/2026-07-18-openclaw-collaboration-release-evidence-bugfix.md)
- [本机 System Service 协作启用归属修复](collaboration/2026-07-31-local-system-service-collaboration-enablement.md)

## Business

- [业务应用 UI 与 Chat 双入口](business/2026-08-02-business-applications-ui.md)

## Quality

- [维护中心](quality/2026-07-14-maintenance-center-hardening.md)
- [Dashboard operations](quality/2026-07-20-dashboard-operations.md)
- [Session origin aggregation](quality/2026-07-20-session-origin-aggregation.md)
- [会话分组与后台活动下钻](quality/2026-07-31-session-background-activity-drilldown.md)
- [会话渠道来源呈现](quality/2026-07-31-session-channel-presentation.md)
- [OpenClaw 原生会话体验对齐](quality/2026-08-02-openclaw-native-session-experience.md)
- [Chat production hardening](quality/2026-07-21-chat-production-hardening.md)
- [JunQi namespace](quality/2026-07-21-junqi-namespace-bugfix.md)
- [Voice runtime](quality/2026-07-21-voice-runtime-bugfix.md)
- [跨平台语音唤醒宿主](quality/2026-08-02-cross-platform-voice-wake-host.md)
- [Tauri listener lifecycle](quality/2026-07-22-tauri-listener-lifecycle-bugfix.md)
- [Tauri command boundary](quality/2026-07-27-tauri-command-boundary-bugfix.md)
- [字体设置与 Orca 对齐](quality/2026-07-28-font-settings-orca-parity.md)
- [设置与运行时一致性](quality/2026-07-28-settings-runtime-consistency.md)
- [Vite 生产分包](quality/2026-07-28-vite-chunking.md)
- [工作台可靠性](quality/2026-07-29-workspace-reliability.md)
- [无引用代码与终端类型收敛](quality/2026-07-29-dead-code-convergence.md)
- [加载指示器收敛](quality/2026-07-29-loading-indicator-convergence.md)
- [萌宠文字与聊天窗口恢复](quality/2026-07-29-pet-caption-and-chat-window-recovery.md)
- [会话模型选择器与 OpenClaw 对齐](quality/2026-07-30-session-model-picker-openclaw-parity.md)
- [侧栏主操作一致性](quality/2026-07-30-sidebar-primary-action-convergence.md)
- [会话模型切换闪动修复](quality/2026-07-30-session-model-switch-flicker.md)
- [主窗口关闭 ACL 修复](quality/2026-07-30-main-window-close-acl.md)
- [设置页面多语言完整性](quality/2026-07-30-settings-localization-completeness.md)
- [全局专注上下文与任务简报](quality/2026-07-30-focus-context-and-task-briefs.md)
- [Chat 执行计划](quality/2026-07-30-chat-execution-plan.md)
- [ReAct 任务检查点与恢复](quality/2026-08-02-react-task-checkpoint-recovery.md)
- [Gateway AI 诊断](quality/2026-07-30-gateway-ai-diagnostics.md)
- [终端与工作台 Chrome 一致性](quality/2026-07-30-terminal-workbench-chrome-convergence.md)
- [Chat 消息预览与 OpenClaw 对齐](quality/2026-07-30-chat-message-preview-openclaw-parity.md)
- [Chat 输出文件预览](quality/2026-08-02-chat-output-file-preview.md)
- [JunQi Desktop 登录自启动](quality/2026-08-02-junqi-app-autostart.md)
- [Chat 响应追溯与人工审核](quality/2026-07-31-chat-response-trace-and-human-review.md)
- [OpenClaw 审计账本对齐](quality/2026-08-03-openclaw-audit-ledger.md)
- [OpenClaw 压缩事件追溯](quality/2026-08-03-openclaw-compaction-trace.md)
- [OpenClaw Talk 能力目录对齐](quality/2026-08-03-openclaw-talk-catalog.md)
- [OpenClaw 会话用量范围对齐](quality/2026-08-03-openclaw-sessions-usage-range.md)
- [OpenClaw 会话操作事件对齐](quality/2026-08-03-openclaw-session-operation.md)
- [OpenClaw 原生会话压缩对齐](quality/2026-08-04-openclaw-native-session-compaction.md)
- [OpenClaw 原生会话中止对齐](quality/2026-08-03-openclaw-native-session-abort.md)
- [OpenClaw 原生会话预览对齐](quality/2026-08-03-openclaw-native-session-preview.md)
- [OpenClaw 原生有效工具目录对齐](quality/2026-08-03-openclaw-native-tools-effective.md)
- [OpenClaw 原生工具目录对齐](quality/2026-08-03-openclaw-native-tools-catalog.md)
- [OpenClaw 原生产物协议对齐](quality/2026-08-03-openclaw-native-artifacts.md)
- [OpenClaw 原生记忆检索对齐](quality/2026-08-03-openclaw-native-memory-search.md)
- [安装、仪表盘、聊天、模型与渠道运行时边界](quality/2026-07-31-installation-dashboard-chat-provider-channel-runtime-boundaries.md)
- [语音唤醒工作台](quality/2026-07-31-voice-wake-workspace.md)
- [业务引导平台](quality/2026-07-31-business-onboarding-platform.md)
- [发布 CI 与安装包构建收敛](quality/2026-08-01-release-ci-build-convergence.md)
- [Chat 通知幂等与消息操作栏](quality/2026-08-01-chat-notification-idempotency-and-message-actions.md)
- [OpenClaw Gateway IPC 出口收敛](quality/2026-08-02-openclaw-gateway-ipc-boundary-convergence.md)
- [OpenClaw 技能运行时出口收敛](quality/2026-08-02-openclaw-skills-runtime-convergence.md)
- [OpenClaw 工作区记忆收敛](quality/2026-08-02-openclaw-workspace-memory-convergence.md)
- [定时任务 OpenClaw Agent 路由](quality/2026-08-02-cron-openclaw-agent-routing.md)
