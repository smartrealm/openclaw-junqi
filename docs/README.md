# JunQi Desktop 文档

本目录只保留当前实现、运行和合规所需的文档。OpenClaw 的功能、协议和运行时语义以其官方文档、官方源码与正式协议为准；JunQi 不维护平行的功能清单或逐项转述。

## 当前入口

- [安装与首次启动流程](installation/junqi-installation-flow.md)：JunQi 的桌面职责、官方 Wizard 交接与未验证平台边界。
- [OpenClaw Wizard 流程](installation/openclaw-wizard-start-flow.md)：`wizard.start`、步骤循环、取消恢复、完整配置与渠道流程的官方契约及 JunQi 适配边界。
- [OpenClaw 第三方渠道支持](channels/openclaw-third-party-channel-support.md)：官方目录、外部插件、国内重点渠道、扫码能力和 JunQi 呈现边界。
- [Gateway 生命周期验证](gateway/gateway-lifecycle-unification-validation-2026-08-10.md)：统一恢复、重启和身份核验的当前证据。
- [AI 原生交互参考与 JunQi 映射](design/ai-native-interaction-reference.md)：展示交互的可复用原则与 OpenClaw 数据边界。
- [AI 原生交互示例代码归档](design/ai-native-interaction-examples.md)：用户提供的交互组件结构与关键实现片段。
- [AI 原生交互全量审查](design/ai-native-interaction-audit-2026-08-11.md)：当前 UI/UX 范围、真实状态边界和问题分级。
- [AI 原生交互实施计划](../plans/2026-08-11-ai-native-interaction-rollout.md)：按会话、控制面、任务与文件、工作台分批的实施顺序。
- [钉钉业务工作台术语](business/CONTEXT.md)：DWS、Gateway 和业务投影的边界。
- [架构决策](adr/)：仍在生效的长期决策。
- [流程预览](previews/)：安装流程和业务工作台的静态预览。
- [中国大陆网络与安装源策略](installation/mainland-china-network-policy.md)
- [Windows 内部测试签名流程](installation/windows-internal-test-signing.md)

## 使用规则

- 当前行为以代码、测试、`PROJECT_STATUS.md` 和上述最小记录为准。
- 新增较大变更时，只保留一份包含上游依据、JunQi 边界、验证结果和未验证项的当前记录；被其取代的审计、规格和计划在同一变更中删除。
- 已完成的逐项审计、临时规格和实施计划不再保留为产品文档；需要追溯时使用 Git 历史。
