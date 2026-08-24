# JunQi Desktop 文档

本目录只保留当前实现、运行和合规所需的文档。OpenClaw 的功能、协议和运行时语义以其官方文档、官方源码与正式协议为准；JunQi 不维护平行的功能清单或逐项转述。

## 当前入口

- [目标环境证据与副作用链路代码审查](quality/target-environment-evidence-code-audit-2026-08-24.md)：禁止代理本地环境取证后的静态审查范围、Node.js 精确契约写入缺口、DWS 已取消调用副作用和修复顺序。
- [目标环境证据与副作用链路修复规格](../specs/2026-08-24-target-environment-evidence-bugfix.md)：Node.js 目标契约先行与 DWS 写操作中止待核验的验收条件。
- [目标环境证据与副作用链路修复计划](../plans/2026-08-24-target-environment-evidence-bugfix.md)：P0、P1 修复顺序与验证边界。
- [目标运行环境 Node.js 决策审查](quality/target-runtime-node-resolution-2026-08-24.md)：目标机器探测、目标包 `engines.node`、自带 npm 配对、安装前复核与三语诊断边界。
- [目标运行环境 Node.js 决策规格](../specs/2026-08-24-target-runtime-node-resolution.md)：现有运行时复用、不兼容提示和不得依赖开发机环境的验收条件。
- [目标运行环境 Node.js 决策计划](../plans/2026-08-24-target-runtime-node-resolution.md)：根因、实现顺序和目标平台验证范围。
- [钉钉工作台状态审查](quality/dingtalk-workbench-state-audit-2026-08-21.md)：目录空状态、详情权限边界、schema 异步围栏、Session 草稿隔离与 DWS 操作生命周期。
- [钉钉工作台状态收敛规格](../specs/2026-08-21-dingtalk-workbench-state-hardening.md)：状态来源、请求代次、忙碌门禁和缓存回收的验收条件。
- [钉钉工作台状态收敛计划](../plans/2026-08-21-dingtalk-workbench-state-hardening.md)：行为测试、实现顺序和验证范围。
- [协作插件服务启动失败审计](quality/collaboration-service-startup-failure-audit-2026-08-21.md)：schema 不兼容、统一 Gateway 生命周期、真实进度、本地化错误和精确回滚边界。
- [协作插件服务启动失败规范](../specs/2026-08-21-collaboration-service-startup-failure.md)：结构化失败码、数据保护、生命周期和界面验收条件。
- [协作插件服务启动失败修复计划](../plans/2026-08-21-collaboration-service-startup-failure.md)：插件、前端、固定包和验证的实施顺序。
- [业务审计与模型选择器状态审计](quality/business-audit-and-model-picker-state-audit-2026-08-21.md)：审计错误与空结果互斥、模型目录和运行参数的独立滚动边界。
- [业务审计与模型选择器状态规范](../specs/2026-08-21-business-audit-and-model-picker-state.md)：互斥状态、多语言、滚动可达性和主题边界。
- [业务审计与模型选择器状态修复计划](../plans/2026-08-21-business-audit-and-model-picker-state.md)：回归测试、实施顺序和验证范围。
- [三点二一标签发布验证](quality/tag-release-validation-2026-08-20-v3.2.1.md)：`v3.2.1` 的补丁版本依据、不可变标签发布顺序、自动化证据和签名验收边界。
- [三点二零标签发布验证](quality/tag-release-validation-2026-08-20.md)：`v3.2.0` 的版本依据、不可变标签发布顺序、自动化证据和签名验收边界。
- [运行时契约收敛审计](quality/runtime-contract-convergence-audit-2026-08-20.md)：官方进度卡、DWS 终态顺序、全局语音路由、费用提示、当前配置开关和会话回放安全边界。
- [已发布 Gateway 进度卡兼容规格](../specs/2026-08-20-openclaw-progress-card-release-compatibility.md)：持久化进度卡与官方计划流的能力门禁、竞态和清空验收条件。
- [已发布 Gateway 进度卡兼容计划](../plans/2026-08-20-openclaw-progress-card-release-compatibility.md)：协议解码、运行事件接入、能力收敛和验证顺序。
- [钉钉 Agent 授权收敛审计](quality/dingtalk-agent-authorization-convergence-audit-2026-08-17.md)：指定 Agent 的普通与 sandbox 工具门禁、最小配置补丁、`discovery` 与 `tool-discovery` 注册语义、有效工具投影、统一 Gateway 重启进度与工作区放行范围。
- [DWS 安装与工作区恢复审计](quality/dws-install-and-workspace-recovery-2026-08-19.md)：DWS 安装输出、终态事件竞态、Gateway 重启后同会话快照、Profile 预热及受限钉钉 Markdown 深链的桌面打开边界。
- [用量仪表盘恢复记录](quality/usage-dashboard-recovery-2026-08-19.md)：OpenClaw Token 与费用边界、部分未估价时的趋势选择、Agent 图标乱码和业务错误布局修复。
- [OpenClaw 运行时命令导航](quality/openclaw-runtime-command-navigation-2026-08-19.md)：`commands.list` 的官方目录分组、左侧导航和不可用状态边界。
- [智能体工位空间化对齐审计](quality/agent-office-star-office-alignment-2026-08-18.md)：Star Office 的空间状态看板映射、原创像素角色与办公室素材、配置身份、协作许可和只读运行投影的边界。
- [消息预览宽度调整](quality/chat-message-preview-resize-2026-08-18.md)：主会话预览分隔条、可访问键盘调整、宽度边界与窄窗口覆盖式行为。
- [OpenClaw 消息队列运行时对齐审计](quality/openclaw-native-message-queue-alignment-2026-08-18.md)：官方 `queueMode` 契约、当前 Gateway 参数拒绝、发送与会话变更原子门禁及未验证边界。
- [工作区布局与结构化会话记录审计](quality/workspace-layout-and-structured-transcript-audit-2026-08-14.md)：主要工作区页面的动态宽度契约、长工具结果的原始结构恢复和通用格式化边界。
- [会话组织与 transcript 展示审计](quality/session-transcript-and-organization-audit-2026-08-14.md)：会话操作回执、历史定位、新建空会话和结构化内容展示的当前契约与缺陷。
- [OpenClaw 原生安装对齐审计](quality/openclaw-native-installation-alignment-audit-2026-08-12.md)：最新版默认 guided inference、正式 setup RPC、经典 Wizard、npm 安装与 JunQi 当前差异。
- [OpenClaw 原生安装对齐规格](../specs/2026-08-12-openclaw-native-installation-alignment.md)：默认安装状态机、完成门禁、安全边界与验收条件。
- [OpenClaw 原生安装对齐计划](../plans/2026-08-12-openclaw-native-installation-alignment.md)：P0、P1 修复顺序、旧路径删除和跨平台验证安排。
- [安装与首次启动流程](installation/junqi-installation-flow.md)：JunQi 的桌面职责、官方 Wizard 交接与未验证平台边界。
- [OpenClaw Wizard 流程](installation/openclaw-wizard-start-flow.md)：`wizard.start`、步骤循环、取消恢复、完整配置与渠道流程的官方契约及 JunQi 适配边界。
- [OpenClaw Wizard 终态交接审计](quality/openclaw-wizard-terminal-handoff-audit-2026-08-11.md)：官方终态、Gateway 后置核验、重试边界与授权等待投影的缺陷和验证记录。
- [OpenClaw 渠道二维码生命周期审计](quality/openclaw-channel-qr-lifecycle-audit-2026-08-11.md)：Web 扫码开始、监听、二维码轮换、成功回调和界面恢复的协议差异与修复记录。
- [协作插件更新与 OpenClaw Peer Link 审计](quality/collaboration-plugin-peer-link-update-audit-2026-08-14.md)：更新前回滚归档、官方 host link、插件版本身份和跨平台验证边界。
- [OpenClaw 第三方渠道支持](channels/openclaw-third-party-channel-support.md)：官方目录、外部插件、国内重点渠道、扫码能力和 JunQi 呈现边界。
- [Gateway 生命周期验证](gateway/gateway-lifecycle-unification-validation-2026-08-10.md)：统一恢复、重启和身份核验的当前证据。
- [AI 原生交互参考与 JunQi 映射](design/ai-native-interaction-reference.md)：展示交互的可复用原则与 OpenClaw 数据边界。
- [AI 原生交互示例代码归档](design/ai-native-interaction-examples.md)：用户提供的交互组件结构与关键实现片段。
- [AI 原生交互全量审查](design/ai-native-interaction-audit-2026-08-11.md)：当前 UI/UX 范围、真实状态边界和问题分级。
- [AI 原生交互实施计划](../plans/2026-08-11-ai-native-interaction-rollout.md)：按会话、控制面、任务与文件、工作台分批的实施顺序。
- [本地 AgentRun 对齐规格](../specs/openclaw-agent-run-alignment.md)：本地 PTY、工作树与任务路径替换为 OpenClaw 会话、托管工作树和 ACP 的边界。
- [本地 AgentRun 对齐计划](../plans/openclaw-agent-run-alignment.md)：调用图审查、协议接入、遗留删除与验证顺序。
- [钉钉业务工作台术语](business/CONTEXT.md)：DWS、Gateway 和业务投影的边界。
- [架构决策](adr/)：仍在生效的长期决策。
- [流程预览](previews/)：安装流程和业务工作台的静态预览。
- [中国大陆网络与安装源策略](installation/mainland-china-network-policy.md)
- [Windows 内部测试签名流程](installation/windows-internal-test-signing.md)
- [Windows 本地语音唤醒契约与验证](quality/windows-native-voice-wake-2026-08-19.md)

## 使用规则

- 当前行为以代码、测试、`PROJECT_STATUS.md` 和上述最小记录为准。
- 新增较大变更时，只保留一份包含上游依据、JunQi 边界、验证结果和未验证项的当前记录；被其取代的审计、规格和计划在同一变更中删除。
- 已完成的逐项审计、临时规格和实施计划不再保留为产品文档；需要追溯时使用 Git 历史。
