# 特定业务文档

本目录用于存放面向具体企业业务的设计、契约、实施与验收 Markdown。它与通用产品设计分离，避免把某个租户、组织或行业的规则误写成 JunQi 的全局默认行为。

## 目录规则

- 一个业务主题至少有一份主设计文档，文件名使用 `<provider>-<business>-<type>-YYYY-MM-DD.md`。
- 文档必须说明事实来源、租户隔离、身份映射、权限、人工确认、审计、失败关闭和未验证边界。
- 上游 API、模板字段、审批节点、组织人员和流程编号均为租户配置或运行时数据，不得在产品代码或文档中硬编码真实值。
- Secret、token、AppKey、AppSecret、用户手机号、身份证明、请假理由、审批附件和真实审批实例不得进入此目录。
- 通用设计仍放在 `docs/design/`；跨模块质量审计仍放在 `docs/quality/`；行为验收条件和执行计划分别放在 `specs/`、`plans/`。

## 当前主题

- [业务应用多平台 UI 设计](business-applications-ui-design-2026-08-02.md)
- [业务应用 UI 验证记录](business-applications-ui-validation-2026-08-02.md)
- [业务集成运行时多态架构](business-integration-runtime-design-2026-08-02.md)
- [钉钉 OA 请假审批接入设计](dingtalk-leave-approval-integration-design-2026-08-02.md)
