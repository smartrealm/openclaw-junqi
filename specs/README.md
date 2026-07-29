# 规格与验收索引

`specs/` 保存问题定义、目标、约束和验收条件。实施顺序位于 [`../plans/`](../plans/README.md)，背景审计与验证记录位于 [`../docs/`](../docs/README.md)。

```text
specs/
├── installation/    安装、首次启动、Wizard 与卸载
├── gateway/         Gateway 生命周期与服务归属
├── collaboration/   多智能体协作与发布证据
└── quality/         产品模块与运行质量
```

## Installation

- [Setup onboarding 加固](installation/2026-07-20-setup-onboarding-hardening.md)
- [Setup onboarding 二次复审](installation/2026-07-20-setup-onboarding-second-pass.md)
- [安装诊断](installation/2026-07-21-install-diagnostics-bugfix.md)
- [Windows Native 安装](installation/2026-07-21-windows-native-install-bugfix.md)
- [Windows OpenClaw Wizard](installation/2026-07-23-openclaw-windows-wizard-bugfix.md)
- [Windows 首次安装](installation/2026-07-24-openclaw-windows-first-run-bugfix.md)
- [Windows 卸载流程](installation/2026-07-26-windows-uninstall-flow-bugfix.md)
- [Setup runtime 与渠道兼容](installation/2026-07-27-setup-runtime-and-channel-compatibility.md)

## Gateway

- [Gateway 生命周期](gateway/2026-07-18-openclaw-gateway-lifecycle-bugfix.md)
- [Gateway 服务归属](gateway/2026-07-24-openclaw-gateway-service-ownership-bugfix.md)

## Collaboration

- [OpenClaw 多智能体协作](collaboration/2026-07-16-openclaw-agent-collaboration-bugfix.md)
- [协作发布证据](collaboration/2026-07-18-openclaw-collaboration-release-evidence-bugfix.md)

## Quality

- [维护中心](quality/2026-07-14-maintenance-center-hardening.md)
- [Dashboard operations](quality/2026-07-20-dashboard-operations.md)
- [Session origin aggregation](quality/2026-07-20-session-origin-aggregation.md)
- [Chat production hardening](quality/2026-07-21-chat-production-hardening.md)
- [JunQi namespace](quality/2026-07-21-junqi-namespace-bugfix.md)
- [Voice runtime](quality/2026-07-21-voice-runtime-bugfix.md)
- [Tauri listener lifecycle](quality/2026-07-22-tauri-listener-lifecycle-bugfix.md)
- [Tauri command boundary](quality/2026-07-27-tauri-command-boundary-bugfix.md)
- [字体设置与 Orca 对齐](quality/2026-07-28-font-settings-orca-parity.md)
- [设置与运行时一致性](quality/2026-07-28-settings-runtime-consistency.md)
- [Vite 生产分包](quality/2026-07-28-vite-chunking.md)
- [工作台可靠性](quality/2026-07-29-workspace-reliability.md)
- [无引用代码与终端类型收敛](quality/2026-07-29-dead-code-convergence.md)
- [加载指示器收敛](quality/2026-07-29-loading-indicator-convergence.md)
- [萌宠文字与聊天窗口恢复](quality/2026-07-29-pet-caption-and-chat-window-recovery.md)
