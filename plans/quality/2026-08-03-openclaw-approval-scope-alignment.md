# OpenClaw 审批最小权限对齐计划

日期：2026-08-03

## 顺序

- [x] 阅读项目根文档、审批 client/store/UI、Gateway connection、transient requester 和现有测试。
- [x] 核对 OpenClaw 当前 protocol、client guide、method scope、approval authorization 与 handler。
- [x] 确认 admin transient 覆盖 approvals-only 协议的最小权限缺陷；实时 observer 的后续
  收敛见 `2026-08-04-openclaw-approval-surface-convergence.md`。
- [x] 扩展 transient requester 以接收受类型约束的调用方 scope，默认保持 admin。
- [x] 为 approval client 创建 approvals-only requester，不改变其他管理调用。
- [x] 补 scope 连接回归、更新验证记录、执行全量检查与中文提交。

## 文件范围

- `src/services/gateway/index.ts`
- `src/services/gateway/gatewayCredentialSecurity.test.ts`
- `docs/quality/openclaw-native-approvals-alignment-2026-08-03.md`
- 本审计、规格、计划和三层索引

## 不做的事情

- 不为审批事件提升日常 socket 的 scope；事件 observer 的实际边界由
  `2026-08-04-openclaw-approval-surface-convergence.md` 定义。
- 不以 `operator.admin` fallback 绕过 reviewer binding、device identity 或 scope 拒绝。
- 不新建本地审批账本、伪造 approval event，或修改 Gateway policy、session、tool 副作用。
