# JunQi Desktop 文档索引

本目录按领域保存架构设计、问题审计、实现说明和验证记录。

```text
docs/
├── README.md          文档总索引
├── installation/     安装、首次启动、Windows 与网络策略
├── gateway/          Gateway 生命周期、服务归属与验证
├── collaboration/    多智能体协作设计、审计与发布证据
├── business/          特定业务领域的集成设计、契约与验收记录
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
- [安装向导存储页导航可见性验证](installation/setup-storage-navigation-visibility-validation-2026-08-02.md)
- [设备审批、Ready 导航、智能体与渠道加载体验复审](installation/device-approval-experience-audit-2026-08-03.md)
- [首次安装二次复审](installation/openclaw-setup-second-pass-audit.md)
- [Windows 首次安装观测复审](installation/openclaw-windows-first-run-observation-audit.md)
- [Windows Node 探测补充审计](installation/openclaw-windows-node-probe-audit.md)
- [Windows Wizard 链路审计](installation/openclaw-windows-wizard-audit.md)
- [Windows OpenClaw Wizard 可视化链路复审](installation/windows-openclaw-wizard-visual-audit-2026-08-03.md)
- [安装与 Wizard 第四轮审计](installation/openclaw-install-wizard-fourth-pass-audit-2026-07-29.md)
- [安装与 Wizard 第五轮审计](installation/openclaw-install-wizard-fifth-pass-audit-2026-07-29.md)
- [安装与 Wizard 第六轮审计](installation/openclaw-install-wizard-sixth-pass-audit-2026-07-29.md)
- [Windows 卸载流程与性能复审](installation/windows-uninstall-flow-audit-2026-07-26.md)
- [Windows 内部测试签名流程](installation/windows-internal-test-signing.md)
- [安装诊断链路审计](installation/install-diagnostics-audit.md)
- [Wizard 流程与 Gateway 生命周期全量审查](installation/wizard-and-gateway-lifecycle-full-audit-2026-08-02.md)
- [Wizard 配置、重启与 Gateway 重装链路加固方案](installation/wizard-config-restart-reinstall-hardening-2026-08-01.md)
- [首次安装底部操作区响应式修复](installation/setup-footer-responsive-actions-2026-08-02.md)
- [Setup runtime 与渠道兼容审计](installation/openclaw-setup-runtime-and-channel-audit-2026-07-27.md)
- [中国大陆网络与安装源策略](installation/mainland-china-network-policy.md)

对应规格与计划：

- [`../specs/installation/2026-07-24-openclaw-windows-first-run-bugfix.md`](../specs/installation/2026-07-24-openclaw-windows-first-run-bugfix.md)
- [`../plans/installation/2026-07-24-openclaw-windows-first-run.md`](../plans/installation/2026-07-24-openclaw-windows-first-run.md)
- [`../specs/installation/2026-07-26-windows-uninstall-flow-bugfix.md`](../specs/installation/2026-07-26-windows-uninstall-flow-bugfix.md)
- [`../plans/installation/2026-07-26-windows-uninstall-flow.md`](../plans/installation/2026-07-26-windows-uninstall-flow.md)
- [`../specs/installation/2026-08-03-windows-internal-test-signing.md`](../specs/installation/2026-08-03-windows-internal-test-signing.md)
- [`../plans/installation/2026-08-03-windows-internal-test-signing.md`](../plans/installation/2026-08-03-windows-internal-test-signing.md)
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
4. [Windows Gateway 重启等待契约加固](quality/windows-gateway-restart-hardening-2026-08-03.md)
5. [Tauri Adapter IPC 契约加固](quality/tauri-adapter-ipc-contract-hardening-2026-08-03.md)
6. [Gateway 凭据绑定失败关闭](quality/gateway-credential-binding-fail-closed-2026-08-03.md)
7. [Gateway Client 平台身份对齐](quality/gateway-client-platform-identity-alignment-2026-08-03.md)
8. [OpenClaw Operator Protocol v4 对齐](quality/openclaw-operator-protocol-v4-alignment-2026-08-03.md)

对应规格与计划：

- [`../specs/gateway/2026-07-18-openclaw-gateway-lifecycle-bugfix.md`](../specs/gateway/2026-07-18-openclaw-gateway-lifecycle-bugfix.md)
- [`../specs/gateway/2026-07-24-openclaw-gateway-service-ownership-bugfix.md`](../specs/gateway/2026-07-24-openclaw-gateway-service-ownership-bugfix.md)
- [`../plans/gateway/2026-07-24-openclaw-gateway-service-ownership.md`](../plans/gateway/2026-07-24-openclaw-gateway-service-ownership.md)

## 多智能体协作

目录：[`collaboration/`](collaboration/)

- [协作系统设计](collaboration/openclaw-agent-collaboration-design.md)
- [协作待决事项投影](collaboration/2026-08-02-needs-you-projection.md)
- [CodexLoom、OpenClaw 与 JunQi 对齐记录](quality/codexloom-openclaw-junqi-alignment-2026-08-03.md)
- [Agent Profile 与 OpenClaw 边界对齐](quality/agent-profile-openclaw-parity-2026-08-03.md)
- [Agent 主会话投影修复](quality/agent-main-session-projection-2026-08-03.md)
- [OpenClaw tools.invoke 能力对齐](quality/openclaw-tools-invoke-parity-2026-08-03.md)
- [协作系统审计](collaboration/openclaw-agent-collaboration-audit.md)
- [协作实施计划](collaboration/openclaw-agent-collaboration-implementation-plan.md)
- [本机 System Service 协作启用归属修复验证](collaboration/local-system-service-collaboration-enablement-validation-2026-07-31.md)
- [Agent Office 只读协作投影设计与验证记录](collaboration/agent-office-read-only-projection-design-2026-08-03.md)
- [发布证据审计](collaboration/openclaw-collaboration-release-evidence-audit.md)
- [Workflow Template 与 Run 边界 ADR](adr/0001-workflow-template-and-run-boundary.md)

根目录 [`CONTEXT.md`](../CONTEXT.md) 定义协作领域的规范术语。

## 特定业务

目录：[`business/`](business/)

- [业务应用多平台 UI 设计](business/business-applications-ui-design-2026-08-02.md)
- [业务应用 UI 验证记录](business/business-applications-ui-validation-2026-08-02.md)
- [钉钉 OA 请假审批接入设计](business/dingtalk-leave-approval-integration-design-2026-08-02.md)
- [业务集成运行时多态架构](business/business-integration-runtime-design-2026-08-02.md)

这里保存面向明确企业业务场景的 Markdown 文档。每个业务目录记录其上游契约、数据与权限边界、实施分期、验收条件和未验证事项；不把租户 ID、审批编号、用户标识、密钥或真实审批内容写入仓库。

## 产品模块与运行质量

目录：[`quality/`](quality/)

- [ReAct 任务中断与恢复审计](quality/react-task-checkpoint-recovery-audit-2026-08-02.md)
- [OpenClaw Stop 检查点与队列对齐](quality/openclaw-stop-checkpoint-queue-alignment-2026-08-03.md)
- [OpenClaw Stop 会话身份围栏审计](quality/openclaw-stop-session-identity-fence-2026-08-03.md)
- [OpenClaw Composer 队列权威与灵动岛预览可见性审计](quality/openclaw-composer-queue-authority-2026-08-03.md)
- [OpenClaw 本地发送队列交付原子性审计](quality/openclaw-local-send-queue-dispatch-atomicity-audit-2026-08-04.md)
- [维护中心审计](quality/maintenance-center-audit.md)
- [定时任务与 OpenClaw Agent 路由审计](quality/cron-openclaw-agent-routing-audit-2026-08-02.md)
- [定时任务 OpenClaw Agent 路由验证](quality/cron-openclaw-agent-routing-validation-2026-08-02.md)
- [Cron 调度器状态与任务列表](quality/cron-status-scheduler-2026-08-03.md)
- [Cron 事件状态投影加固](quality/cron-event-state-projection-hardening-2026-08-03.md)
- [Dashboard 运行审计](quality/dashboard-operations-audit.md)
- [Chat 生产加固审计](quality/chat-production-hardening-audit.md)
- [Chat 流式渲染性能审计](quality/chat-stream-rendering-performance-audit-2026-08-03.md)
- [业务引导审计](quality/business-guide-audit-2026-08-02.md)
- [Chat 通知幂等与消息操作栏修复](quality/chat-notification-idempotency-and-message-actions-2026-08-01.md)
- [OpenClaw Gateway IPC 出口收敛](quality/openclaw-gateway-ipc-boundary-convergence-2026-08-02.md)
- [OpenClaw 技能运行时出口收敛](quality/openclaw-skills-runtime-convergence-2026-08-02.md)
- [OpenClaw 技能归档上传能力对齐](quality/openclaw-skills-upload-parity-2026-08-03.md)
- [OpenClaw 工作区记忆出口收敛](quality/openclaw-workspace-memory-convergence-2026-08-02.md)
- [OpenClaw Memory 只读诊断能力对齐](quality/openclaw-memory-diagnostics-parity-2026-08-03.md)
- [会话 Agent 状态卡一致性记录](quality/chat-agent-status-tooltip-parity-2026-08-01.md)
- [Chat 消息预览与 OpenClaw 对齐](quality/chat-message-preview-openclaw-parity-2026-07-30.md)
- [Chat 输出文件预览](quality/chat-output-file-preview-2026-08-02.md)
- [Provider Catalog 构建可复现性验证](quality/provider-catalog-build-reproducibility-2026-08-03.md)
- [JunQi Desktop 登录自启动](quality/junqi-app-autostart-2026-08-02.md)
- [OpenClaw 原生会话体验对齐](quality/openclaw-native-session-experience-alignment-2026-08-02.md)
- [原生新建会话列表竞态修复验证](quality/native-session-list-race-validation-2026-08-03.md)
- [Chat 响应追溯与人工审核](quality/chat-response-trace-and-human-review-2026-07-31.md)
- [OpenClaw 审批控制能力对齐](quality/openclaw-approval-controls-parity-2026-08-03.md)
- [安装、仪表盘、聊天、模型与渠道运行时边界修复](quality/installation-dashboard-chat-provider-channel-runtime-boundary-remediation-2026-07-31.md)
- [会话来源聚合审计](quality/session-origin-aggregation-audit.md)
- [会话分组与后台活动下钻设计](quality/session-background-activity-drilldown-design-2026-07-31.md)
- [会话渠道来源呈现记录](quality/session-channel-presentation-2026-07-31.md)
- [Tauri Listener 生命周期审计](quality/tauri-listener-lifecycle-audit.md)
- [Tauri Command 边界审计](quality/tauri-command-boundary-audit-2026-07-27.md)
- [PTY 锁毒化加固](quality/pty-lock-poisoning-hardening-2026-08-03.md)
- [Voice Runtime 审计](quality/voice-runtime-audit.md)
- [Voice Runtime 审计计划](quality/voice-runtime-audit-plan.md)
- [跨平台语音唤醒宿主验证](quality/2026-08-02-cross-platform-voice-wake-host.md)
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
- [导航与页签平滑动效设计](quality/navigation-and-tab-motion-design-2026-08-02.md)
- [主窗口关闭 ACL 审计](quality/main-window-close-acl-audit-2026-07-30.md)
- [提供商模型目录设计记录](quality/provider-model-directory-design-2026-07-31.md)
- [设置页面多语言完整性审计](quality/settings-localization-completeness-2026-07-30.md)
- [全局专注上下文与任务简报验证](quality/focus-context-and-task-briefs-validation-2026-07-30.md)
- [Focus Context 与 Task Brief 来源盘点](quality/current-branch-focus-task-brief-change-inventory-2026-07-30.md)
- [Chat 执行计划协议审计](quality/chat-execution-plan-protocol-audit-2026-07-30.md)
- [依赖漏洞分诊与修复](quality/dependency-vulnerability-triage-2026-08-01.md)
- [执行计划终态修复与灵动岛接入](quality/execution-plan-terminal-state-and-island-2026-08-01.md)
- [会话执行追溯的 OpenClaw 能力拓展分析](quality/chat-response-trace-openclaw-extension-analysis-2026-07-31.md)
- [OpenClaw 审计账本与 JunQi 追溯对齐](quality/openclaw-audit-ledger-alignment-2026-08-03.md)
- [OpenClaw 压缩事件追溯对齐](quality/openclaw-compaction-trace-alignment-2026-08-03.md)
- [OpenClaw Talk 能力目录对齐](quality/openclaw-talk-catalog-alignment-2026-08-03.md)
- [OpenClaw 原生 TTS 客户端对齐](quality/openclaw-native-tts-client-alignment-2026-08-03.md)
- [OpenClaw 原生 TTS 状态对齐](quality/openclaw-native-tts-status-alignment-2026-08-03.md)
- [OpenClaw 原生 TTS 偏好对齐](quality/openclaw-native-tts-preferences-alignment-2026-08-03.md)
- [OpenClaw 原生模型认证状态对齐](quality/openclaw-native-model-auth-status-alignment-2026-08-03.md)
- [OpenClaw 原生提供方配额对齐](quality/openclaw-native-provider-usage-alignment-2026-08-03.md)
- [OpenClaw 客户端本机用量旁路退役](quality/openclaw-client-local-usage-sidechannel-retirement-2026-08-03.md)
- [OpenClaw 工具入口权威对齐](quality/openclaw-tools-route-authority-alignment-2026-08-03.md)
- [OpenClaw 运行时命令目录对齐](quality/openclaw-runtime-command-catalog-alignment-2026-08-03.md)
- [OpenClaw 会话用量范围对齐](quality/openclaw-sessions-usage-range-alignment-2026-08-03.md)
- [OpenClaw 会话操作事件对齐](quality/openclaw-session-operation-alignment-2026-08-03.md)
- [OpenClaw 原生会话压缩对齐](quality/openclaw-native-session-compaction-alignment-2026-08-04.md)
- [OpenClaw 会话压缩异步反馈审计](quality/openclaw-session-compaction-feedback-audit-2026-08-04.md)
- [OpenClaw 原生压缩检查点只读对齐](quality/openclaw-native-compaction-checkpoint-read-alignment-2026-08-03.md)
- [OpenClaw Session Observer 与灵动岛对齐](quality/openclaw-session-observer-dynamic-island-alignment-2026-08-03.md)
- [OpenClaw 原生会话中止对齐](quality/openclaw-native-session-abort-alignment-2026-08-03.md)
- [OpenClaw 原生会话分组与 Jarvis 对齐](quality/openclaw-native-session-groups-jarvis-alignment-2026-08-03.md)
- [OpenClaw 全局语音唤醒触发词与 JunQi 对齐](quality/openclaw-voicewake-global-trigger-alignment-2026-08-03.md)
- [OpenClaw 原生会话转向核验对齐](quality/openclaw-native-session-steer-reconciliation-2026-08-03.md)
- [OpenClaw 原生会话队列对齐](quality/openclaw-native-session-queue-alignment-2026-08-03.md)
- [OpenClaw 原生会话预览对齐](quality/openclaw-native-session-preview-alignment-2026-08-03.md)
- [OpenClaw 原生有效工具目录对齐](quality/openclaw-native-tools-effective-alignment-2026-08-03.md)
- [OpenClaw 原生工具目录对齐](quality/openclaw-native-tools-catalog-alignment-2026-08-03.md)
- [OpenClaw 原生工具调用对齐](quality/openclaw-native-tools-invoke-alignment-2026-08-03.md)
- [OpenClaw 原生产物协议对齐](quality/openclaw-native-artifacts-alignment-2026-08-03.md)
- [OpenClaw 原生记忆检索对齐](quality/openclaw-native-memory-search-alignment-2026-08-03.md)
- [OpenClaw 原生会话检索对齐](quality/openclaw-native-session-search-alignment-2026-08-03.md)
- [OpenClaw 原生记忆诊断对齐](quality/openclaw-native-memory-diagnostics-alignment-2026-08-03.md)
- [OpenClaw 原生技能目录字段对齐](quality/openclaw-native-skill-catalog-fidelity-2026-08-03.md)
- [OpenClaw 技能归档上传能力对齐](quality/openclaw-skills-upload-parity-2026-08-03.md)
- [OpenClaw 原生技能卡对齐](quality/openclaw-native-skill-card-alignment-2026-08-03.md)
- [OpenClaw 原生技能生命周期对齐](quality/openclaw-native-skill-curator-alignment-2026-08-03.md)
- [OpenClaw 原生技能提案清单对齐](quality/openclaw-native-skill-proposal-manifest-alignment-2026-08-03.md)
- [OpenClaw 原生技能提案范围对齐](quality/openclaw-native-skill-proposal-scope-alignment-2026-08-03.md)
- [OpenClaw 原生技能提案详情对齐](quality/openclaw-native-skill-proposal-inspect-alignment-2026-08-03.md)
- [OpenClaw 原生技能提案事件对齐](quality/openclaw-native-skill-proposal-events-alignment-2026-08-03.md)
- [OpenClaw 原生审批对齐](quality/openclaw-native-approvals-alignment-2026-08-03.md)
- [OpenClaw 审批最小权限对齐](quality/openclaw-approval-scope-alignment-2026-08-03.md)
- [OpenClaw 原生任务账本对齐](quality/openclaw-native-task-ledger-alignment-2026-08-03.md)
- [OpenClaw 原生 Cron 运行语义对齐](quality/openclaw-native-cron-run-alignment-2026-08-03.md)
- [OpenClaw Cron 日历投影审计](quality/openclaw-cron-calendar-projection-audit-2026-08-03.md)
- [OpenClaw Cron 日历投影验证](quality/openclaw-cron-calendar-projection-validation-2026-08-03.md)
- [OpenClaw Cron 调度器状态对齐](quality/openclaw-cron-scheduler-status-alignment-2026-08-03.md)
- [OpenClaw Cron 调度器状态验证](quality/openclaw-cron-scheduler-status-validation-2026-08-03.md)
- [OpenClaw Cron 写操作授权与日历一致性审计](quality/openclaw-cron-mutation-authority-audit-2026-08-03.md)
- [OpenClaw Cron 写操作授权与日历一致性验证](quality/openclaw-cron-mutation-authority-validation-2026-08-03.md)
- [Tauri 适配器遗留 IPC 审计](quality/tauri-adapter-legacy-ipc-audit-2026-08-03.md)
- [Tauri 适配器遗留 IPC 验证](quality/tauri-adapter-legacy-ipc-validation-2026-08-03.md)
- [Chat 响应追溯与 OpenClaw 审计账本](quality/chat-response-trace-audit-ledger-2026-08-03.md)
- [OpenClaw 跨运行审计账本](quality/openclaw-cross-run-audit-ledger-2026-08-03.md)
- [Collaboration Bootstrap Target 子域拆分](quality/collaboration-bootstrap-target-slice-2026-08-03.md)
- [Collaboration Bootstrap Agent Policy 子域拆分](quality/collaboration-bootstrap-agent-policy-slice-2026-08-03.md)
- [Collaboration Bootstrap Package 子域拆分](quality/collaboration-bootstrap-package-slice-2026-08-03.md)
- [Gateway Task Ledger 与活动中心](quality/gateway-task-ledger-activity-center-2026-08-03.md)
- [Gateway Task Ledger 详情对齐](quality/task-ledger-details-2026-08-03.md)
- [Windows Gateway 重启后续加固](quality/windows-gateway-restart-followup-2026-08-03.md)
- [会话维护与 OpenClaw 官方接口对齐](quality/session-maintenance-openclaw-parity-2026-08-03.md)
- [新建会话生命周期审计](quality/new-session-lifecycle-audit-2026-08-03.md)
- [OpenClaw 会话上下文只读能力对齐](quality/openclaw-session-inspection-parity-2026-08-03.md)
- [OpenClaw 会话产物能力对齐](quality/openclaw-artifacts-parity-2026-08-03.md)
- [OpenClaw session.operation 能力对齐](quality/openclaw-session-operation-parity-2026-08-03.md)
- [OpenClaw 上下文压缩追溯对齐](quality/openclaw-compaction-trace-parity-2026-08-03.md)
- [OpenClaw 响应用量追溯对齐](quality/openclaw-response-usage-trace-parity-2026-08-03.md)
- [OpenClaw Talk 会话替换能力对齐](quality/openclaw-talk-session-replacement-parity-2026-08-03.md)
- [OpenClaw 会话 Steering 能力对齐](quality/openclaw-session-steering-parity-2026-08-03.md)
- [OpenClaw 实际工具集能力对齐](quality/openclaw-tools-effective-parity-2026-08-03.md)
- [OpenClaw 工具目录能力对齐](quality/openclaw-tools-catalog-parity-2026-08-03.md)
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
