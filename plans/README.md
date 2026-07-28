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
