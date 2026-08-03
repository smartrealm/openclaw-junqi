# OpenClaw 稳定性诊断只读投影实施计划

## 实施顺序

1. 查阅 OpenClaw 当前官方 protocol、诊断 handler 与 recorder，确认 `operator.read`、空参数默认值、
   有界环形快照和脱敏边界。
2. 新增严格 `OpenClawDiagnosticStabilityClient`，经现有 `requestFenced` 调用；只投影快照骨架、
   事件序号/时间/类型和 `summary.byType`。
3. 新增按需 hook 与维护中心面板。首次挂载不读取，用户点击后才请求；无连接、方法不支持、
   围栏替换和无效响应分别保留真实失败语义。
4. 补齐三语文案、客户端/组件回归测试和维护中心接线测试。
5. 更新 docs/specs/plans 索引，执行定向测试、TypeScript、lint、完整测试、构建、官方链接校验、
   diff 检查和 Emoji 扫描后使用中文提交。

## 文件范围

- `src/services/gateway/OpenClawDiagnosticStabilityClient.ts`
- `src/services/gateway/OpenClawDiagnosticStabilityClient.test.ts`
- `src/services/gateway/index.ts`
- `src/hooks/useOpenClawDiagnosticStability.ts`
- `src/components/settings/OpenClawDiagnosticStabilityPanel.tsx`
- `src/components/settings/OpenClawDiagnosticStabilityPanel.test.tsx`
- `src/components/settings/MaintenanceCenter.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引

## 验证与边界

自动化覆盖协议解码、方法广告省略、连接身份围栏、断线、无效响应、显式读取与安全投影。
它不能代替真实 Gateway recorder 数据，也不能代替 macOS、Windows、CentOS、Ubuntu 的真机
视觉与权限验收。本计划不声明这些平台已经实测。
