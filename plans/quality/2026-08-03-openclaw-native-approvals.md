# OpenClaw 原生审批实施计划

## 实施顺序

1. 依据 OpenClaw 当前官方 protocol、scope、schema 和 handler，锁定 list/resolve 的字段与
   `operator.approvals` 权限边界。
2. 新增 `OpenClawApprovalClient`，集中处理能力探测、严格响应解码、method-not-found 语义和
   resolve 回执；通过既有 `requestPrivileged` 管理员临时出口。
3. 在活动中心增加审批面板，呈现 Gateway 原生 pending 快照、真实允许决策、过期和错误状态；
   使用桌面轮询刷新，不伪装为事件订阅。
4. 补充三套 locale、定向协议测试和文档索引。
5. 执行 TypeScript、边界、完整测试、构建、官方链接校验、diff 检查和 Emoji 扫描后提交。

## 文件范围

- `src/services/gateway/OpenClawApprovalClient.ts`
- `src/services/gateway/OpenClawApprovalClient.test.ts`
- `src/services/gateway/index.ts`
- `src/components/Activity/OpenClawApprovalsPanel.tsx`
- `src/pages/ActivityCenter.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `docs/quality/openclaw-native-approvals-alignment-2026-08-03.md`
- `specs/quality/2026-08-03-openclaw-native-approvals.md`
- `plans/quality/2026-08-03-openclaw-native-approvals.md`

## 验证与边界

自动化测试只能证明 adapter 字段、权限出口和 UI 状态的代码契约。真实 Gateway 审批创建、
管理员配对、不同 host/node 的审批响应、断线重连以及 Windows、macOS、Linux 桌面行为仍需
真机验证；未取得官方事件订阅接入证据前保持轮询方案，不实现猜测性兼容。
