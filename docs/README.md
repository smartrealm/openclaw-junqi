# JunQi Desktop 文档索引

本目录按领域保存架构设计、问题审计、实现说明和验证记录。

```text
docs/
├── README.md          文档总索引
├── installation/     安装、首次启动、Windows 与网络策略
├── gateway/          Gateway 生命周期、服务归属与验证
├── collaboration/    多智能体协作设计、审计与发布证据
├── quality/          产品模块审计与运行质量
├── design/           尚未完全落地的产品设计稿
├── previews/         独立 HTML 流程与视觉预览
└── adr/              架构决策记录
```

## 文档约定

- `*-design.md`：目标架构和产品/技术设计。
- `*-audit.md`：特定时间点的代码或流程审计，可能包含已修复的历史问题。
- `*-validation.md`：修复后的自动化证据和仍需真机验证的边界。
- `../specs/`：问题目标、约束和验收条件。
- `../plans/`：实施顺序和文件级变更计划。

审计文档描述的是审计时事实，不自动代表当前代码状态。阅读时应同时查看对应 spec、plan、validation 和最新代码。

## 安装、首次启动与 Windows

目录：[`installation/`](installation/)

- [Windows 安装阶段全量复审](installation/windows-installation-full-audit-2026-07-24.md)
- [Windows Native 安装审计](installation/windows-native-install-audit.md)
- [首次安装二次复审](installation/openclaw-setup-second-pass-audit.md)
- [Windows 首次安装观测复审](installation/openclaw-windows-first-run-observation-audit.md)
- [Windows Node 探测补充审计](installation/openclaw-windows-node-probe-audit.md)
- [Windows Wizard 链路审计](installation/openclaw-windows-wizard-audit.md)
- [安装与 Wizard 第四轮审计](installation/openclaw-install-wizard-fourth-pass-audit-2026-07-29.md)
- [安装与 Wizard 第五轮审计](installation/openclaw-install-wizard-fifth-pass-audit-2026-07-29.md)
- [安装与 Wizard 第六轮审计](installation/openclaw-install-wizard-sixth-pass-audit-2026-07-29.md)
- [Windows 卸载流程复审](installation/windows-uninstall-flow-audit-2026-07-26.md)
- [安装诊断链路审计](installation/install-diagnostics-audit.md)
- [Wizard 配置、重启与 Gateway 重装链路加固方案](installation/wizard-config-restart-reinstall-hardening-2026-08-01.md)
- [Setup runtime 与渠道兼容审计](installation/openclaw-setup-runtime-and-channel-audit-2026-07-27.md)
- [中国大陆网络与安装源策略](installation/mainland-china-network-policy.md)

对应规格与计划：

- [`../specs/installation/2026-07-24-openclaw-windows-first-run-bugfix.md`](../specs/installation/2026-07-24-openclaw-windows-first-run-bugfix.md)
- [`../plans/installation/2026-07-24-openclaw-windows-first-run.md`](../plans/installation/2026-07-24-openclaw-windows-first-run.md)
- [`../specs/installation/2026-07-26-windows-uninstall-flow-bugfix.md`](../specs/installation/2026-07-26-windows-uninstall-flow-bugfix.md)
- [`../plans/installation/2026-07-26-windows-uninstall-flow.md`](../plans/installation/2026-07-26-windows-uninstall-flow.md)
- [`../specs/installation/2026-07-29-install-completion-model-gate.md`](../specs/installation/2026-07-29-install-completion-model-gate.md)
- [`../plans/installation/2026-07-29-install-completion-model-gate.md`](../plans/installation/2026-07-29-install-completion-model-gate.md)
- [`../specs/installation/2026-07-29-install-cancellation-and-diagnostic-boundary.md`](../specs/installation/2026-07-29-install-cancellation-and-diagnostic-boundary.md)
- [`../plans/installation/2026-07-29-install-cancellation-and-diagnostic-boundary.md`](../plans/installation/2026-07-29-install-cancellation-and-diagnostic-boundary.md)
- [`../specs/installation/2026-07-29-setup-state-ownership.md`](../specs/installation/2026-07-29-setup-state-ownership.md)
- [`../plans/installation/2026-07-29-setup-state-ownership.md`](../plans/installation/2026-07-29-setup-state-ownership.md)

## Gateway 生命周期与服务归属

目录：[`gateway/`](gateway/)

建议按以下顺序阅读：

1. [Gateway 生命周期审计](gateway/openclaw-gateway-lifecycle-audit.md)
2. [Gateway 服务归属审计](gateway/openclaw-gateway-service-ownership-audit.md)
3. [Gateway 服务归属验证](gateway/openclaw-gateway-service-ownership-validation.md)

对应规格与计划：

- [`../specs/gateway/2026-07-18-openclaw-gateway-lifecycle-bugfix.md`](../specs/gateway/2026-07-18-openclaw-gateway-lifecycle-bugfix.md)
- [`../specs/gateway/2026-07-24-openclaw-gateway-service-ownership-bugfix.md`](../specs/gateway/2026-07-24-openclaw-gateway-service-ownership-bugfix.md)
- [`../plans/gateway/2026-07-24-openclaw-gateway-service-ownership.md`](../plans/gateway/2026-07-24-openclaw-gateway-service-ownership.md)

## 多智能体协作

目录：[`collaboration/`](collaboration/)

- [协作系统设计](collaboration/openclaw-agent-collaboration-design.md)
- [协作系统审计](collaboration/openclaw-agent-collaboration-audit.md)
- [协作实施计划](collaboration/openclaw-agent-collaboration-implementation-plan.md)
- [本机 System Service 协作启用归属修复验证](collaboration/local-system-service-collaboration-enablement-validation-2026-07-31.md)
- [发布证据审计](collaboration/openclaw-collaboration-release-evidence-audit.md)
- [Workflow Template 与 Run 边界 ADR](adr/0001-workflow-template-and-run-boundary.md)

根目录 [`CONTEXT.md`](../CONTEXT.md) 定义协作领域的规范术语。

## 产品模块与运行质量

目录：[`quality/`](quality/)

- [维护中心审计](quality/maintenance-center-audit.md)
- [Dashboard 运行审计](quality/dashboard-operations-audit.md)
- [Chat 生产加固审计](quality/chat-production-hardening-audit.md)
- [会话 Agent 状态卡一致性记录](quality/chat-agent-status-tooltip-parity-2026-08-01.md)
- [Chat 消息预览与 OpenClaw 对齐](quality/chat-message-preview-openclaw-parity-2026-07-30.md)
- [Chat 响应追溯与人工审核](quality/chat-response-trace-and-human-review-2026-07-31.md)
- [安装、仪表盘、聊天、模型与渠道运行时边界修复](quality/installation-dashboard-chat-provider-channel-runtime-boundary-remediation-2026-07-31.md)
- [会话来源聚合审计](quality/session-origin-aggregation-audit.md)
- [会话分组与后台活动下钻设计](quality/session-background-activity-drilldown-design-2026-07-31.md)
- [会话渠道来源呈现记录](quality/session-channel-presentation-2026-07-31.md)
- [Tauri Listener 生命周期审计](quality/tauri-listener-lifecycle-audit.md)
- [Tauri Command 边界审计](quality/tauri-command-boundary-audit-2026-07-27.md)
- [Voice Runtime 审计](quality/voice-runtime-audit.md)
- [Voice Runtime 审计计划](quality/voice-runtime-audit-plan.md)
- [JunQi Namespace 审计](quality/junqi-namespace-audit.md)
- [JunQi Namespace 计划](quality/junqi-namespace-plan.md)
- [技能管理入口与双路由审计](quality/skill-management-route-audit-2026-07-27.md)
- [字体设置与 Orca 对齐审计](quality/font-settings-orca-parity-audit-2026-07-28.md)
- [设置与运行时一致性审计](quality/settings-runtime-consistency-audit-2026-07-28.md)
- [Vite 生产分包审计](quality/vite-chunking-audit-2026-07-28.md)
- [工作台可靠性审计](quality/workspace-reliability-audit-2026-07-29.md)
- [无引用与废弃代码清理验证](quality/dead-code-cleanup-validation-2026-07-29.md)
- [Gateway 生命周期审计与前端重启协调器](gateway/openclaw-gateway-lifecycle-audit.md)
- [OpenClaw 配置权威源审计](quality/openclaw-config-authority-audit-2026-07-29.md)
- [加载指示器收敛记录](quality/loading-indicator-convergence-2026-07-29.md)
- [萌宠文字与聊天窗口恢复记录](quality/pet-caption-and-chat-window-recovery-2026-07-29.md)
- [默认模型已安装契约审计](quality/default-model-installed-contract-audit-2026-07-29.md)
- [全量代码审查](quality/full-codebase-audit-2026-07-29.md)
- [CLAUDE.md 全量合规审查](quality/agent-guide-compliance-audit-2026-07-31.md)
- [全量代码审查修复规格](../specs/quality/2026-07-30-full-codebase-audit-remediation.md)
- [全量代码审查修复计划](../plans/quality/2026-07-30-full-codebase-audit-remediation.md)
- [会话模型选择器与 OpenClaw 对齐记录](quality/session-model-picker-openclaw-parity-2026-07-30.md)
- [侧栏主操作一致性记录](quality/sidebar-primary-action-convergence-2026-07-30.md)
- [会话模型切换闪动审计](quality/session-model-switch-flicker-audit-2026-07-30.md)
- [主窗口关闭 ACL 审计](quality/main-window-close-acl-audit-2026-07-30.md)
- [提供商模型目录设计记录](quality/provider-model-directory-design-2026-07-31.md)
- [设置页面多语言完整性审计](quality/settings-localization-completeness-2026-07-30.md)
- [全局专注上下文与任务简报验证](quality/focus-context-and-task-briefs-validation-2026-07-30.md)
- [Focus Context 与 Task Brief 来源盘点](quality/current-branch-focus-task-brief-change-inventory-2026-07-30.md)
- [Chat 执行计划协议审计](quality/chat-execution-plan-protocol-audit-2026-07-30.md)
- [依赖漏洞分诊与修复](quality/dependency-vulnerability-triage-2026-08-01.md)
- [执行计划终态修复与灵动岛接入](quality/execution-plan-terminal-state-and-island-2026-08-01.md)
- [会话执行追溯的 OpenClaw 能力拓展分析](quality/chat-response-trace-openclaw-extension-analysis-2026-07-31.md)
- [全局改进与功能拓展计划](quality/codebase-improvement-and-extension-plan-2026-07-31.md)
- [仪表盘首次主题切换验证](quality/dashboard-first-theme-switch-validation-2026-07-30.md)
- [Gateway AI 诊断与 OpenClaw 运行时验证](quality/gateway-ai-diagnostics-openclaw-runtime-validation-2026-07-30.md)
- [终端与工作台 Chrome 一致性记录](quality/terminal-workbench-chrome-convergence-2026-07-30.md)
- [macOS Apple Silicon 本地测试包验证](quality/macos-local-package-2026-07-31.md)
- [Windows Cargo 离线预热验证](quality/windows-cargo-offline-prefetch-validation-2026-07-31.md)
- [托管发布 Provider Catalog 构建验证](quality/hosted-release-provider-catalog-validation-2026-08-01.md)
- [发布 CI 与安装包构建收敛](quality/release-ci-build-convergence-2026-08-01.md)

## 产品设计草案

目录：[`design/`](design/)

- [ComfyUI Creative Studio 设计](design/comfyui-creative-studio-design.md)
- [全局专注上下文与任务简报设计](design/focus-context-and-task-briefs-design.md)
- [Agent 分步执行计划与折叠进度设计](design/agent-execution-plan-progress-design.md)
- [语音唤醒与 Jarvis 式工作台设计及业务闭环审计](design/voice-wake-jarvis-surface-design-2026-07-31.md)
- [业务引导平台设计](design/business-onboarding-platform-2026-07-31.md)

该文档是大型设计稿，不代表所有功能已经实现。

## HTML 预览

目录：[`previews/`](previews/)

- [`junqi-first-run-flow.html`](previews/junqi-first-run-flow.html)
- [`monthly-icon-alternatives.html`](previews/monthly-icon-alternatives.html)
- [`usage-icons-preview.html`](previews/usage-icons-preview.html)

这些文件是可独立打开的流程或视觉参考，不参与应用运行时构建。

## 验收边界

自动化测试不能替代以下真实平台验证：

- Windows NSIS 安装、升级、卸载和重装；
- Windows Scheduled Task、Credential Manager、UAC 和 ARM64/x64/x86 差异；
- Docker Desktop 冷启动、容器 restart policy 与卸载残留；
- macOS 签名、公证、Keychain 和系统服务；
- 最终发布制品的签名、updater manifest 与受保护 promotion。
