# 实施计划索引

`plans/` 保存文件级实施顺序和验证步骤。问题定义与验收条件位于 [`../specs/`](../specs/README.md)，审计和设计背景位于 [`../docs/`](../docs/README.md)。

```text
plans/
├── installation/   安装、首次启动、Wizard 与卸载
├── gateway/        Gateway 服务归属
├── quality/        产品模块与运行质量
└── workbench/      AI 工作台、文件平台与开发工具基础设施
```

## Installation

- [Windows OpenClaw runtime 加固](installation/2026-07-18-windows-openclaw-runtime-hardening.md)
- [Setup onboarding 加固](installation/2026-07-20-setup-onboarding-hardening.md)
- [Setup onboarding 二次复审](installation/2026-07-20-setup-onboarding-second-pass.md)
- [安装诊断完整性](installation/2026-07-21-install-diagnostics-completeness.md)
- [Windows OpenClaw Wizard](installation/2026-07-23-openclaw-windows-wizard.md)
- [Windows 首次安装](installation/2026-07-24-openclaw-windows-first-run.md)
- [Windows 卸载流程](installation/2026-07-26-windows-uninstall-flow.md)
- [Setup runtime 与渠道兼容](installation/2026-07-27-setup-runtime-and-channel-compatibility.md)

## Gateway

- [Gateway 服务归属](gateway/2026-07-24-openclaw-gateway-service-ownership.md)

## Workbench

- [AI 工作台与共享文件平台](workbench/2026-07-28-ai-workspace-and-shared-files-platform.md)

## Quality

- [Dashboard operations](quality/2026-07-20-dashboard-operations.md)
- [Session origin aggregation](quality/2026-07-20-session-origin-aggregation.md)
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
- [Gateway AI 诊断](quality/2026-07-30-gateway-ai-diagnostics.md)
