# 业务应用 UI 实施计划

> 历史计划：当前实施顺序已由[钉钉业务工作台运行时实施计划](2026-08-08-dingtalk-business-runtime.md)取代，不再执行静态多平台目录和 Chat bridge 路线。

日期：2026-08-02

对应规格：[业务应用 UI 与 Chat 双入口规格](../../specs/business/2026-08-02-business-applications-ui.md)

## 第一阶段：展示与导航

1. 增加独立 feature、路由、顶部 Tab 与上下文侧栏。
2. 以通用 catalog 渲染钉钉工作台、飞书和 Google Workspace，保持运行时未接入状态。
3. 将页面拆为目录、详情、状态、追溯和 Chat bridge 组件。
4. 验证目录切换、窄窗口横向约束、三语文案和无 Emoji 约束。

## 第二阶段：受控读取

1. 在 Rust 注册 `BusinessIntegrationRegistry` 与 typed DTO。
2. 钉钉 DWS 先实现运行时探测、授权状态、profile 列举和 capability snapshot。
3. 飞书、Google Workspace 只在官方 OAuth 和 API 配置契约已验证后实现只读身份与 capability snapshot。
4. 为运行时缺失、scope 缺失、profile 失效和回调校验失败补充契约测试。

## 第三阶段：计划、确认与执行

1. 建立跨平台 `OperationPlan`、`CapabilityGate`、`ConfirmationPolicy` 和 `BusinessOperationJournal`。
2. Chat 将结构化工具请求映射为计划，不允许直接写入平台。
3. 业务页与 Chat 共用确认页、幂等键、权威重读和 Journal 记录。
4. 针对审批、邮件、共享权限、日历写入等高影响动作进行测试租户真机验证。

## 未验证边界

- DWS 的安装、探测和 profile JSON 契约尚未接入本页面。
- 飞书和 Google Workspace 的 OAuth 回调、凭据库及管理员授权策略尚未实现。
- 第三方平台写操作、审批回读和跨设备审计未实现，不能在当前版本中视为可用。
