# Agent Office 只读协作投影实施计划

日期：2026-08-03

## 阶段一：建立领域投影

文件：

- `src/services/collaboration/agentOfficeProjection.ts`
- `src/services/collaboration/agentOfficeProjection.test.ts`

步骤：

1. 从 Run 快照收集具有 Planner/Synthesizer Attempt 的协调 Agent、WorkItem 指派 Agent 和其他 Attempt Agent。
2. 按权威 Attempt、WorkItem 和 Intervention 状态确定区域。
3. 确定性生成区域内工位编号。
4. 对缺失 capability metadata 执行 ID 回退，不投影 presence。
5. 使用测试覆盖参与者过滤、状态优先级、UNKNOWN 和能力缺失。

## 阶段二：接入协作详情 UI

文件：

- `src/components/Collaboration/AgentOfficeView.tsx`
- `src/components/Collaboration/CollaborationDetails.tsx`
- `src/components/Collaboration/CollaborationDetails.test.tsx`
- `src/components/Collaboration/index.ts`
- `src/components/Chat/CollaborationChatProvider.tsx`

步骤：

1. 将 `CollaborationWorkItemView` 扩展为 `graph | list | office`。
2. 在既有视图切换组中增加 Office 按钮。
3. 将当前 collaboration capabilities 的 Agent metadata 传入详情投影。
4. 使用 Aegis token 渲染区域、工位、状态和空状态。
5. 保留 Graph/List 和所有协作操作契约。

## 阶段三：国际化和文档

文件：

- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `docs/collaboration/agent-office-read-only-projection-design-2026-08-03.md`
- `docs/README.md`
- `specs/README.md`
- `plans/README.md`

步骤：

1. 增加 Office、区域、状态和权威边界文案。
2. 记录第三方许可证边界和未复用资产事实。
3. 记录自动化证据和真实 Tauri 未验证边界。

## 验证顺序

1. 投影纯函数定向测试。
2. CollaborationDetails 定向测试。
3. 协作相关前端测试。
4. `pnpm lint`。
5. `pnpm test`。
6. `pnpm build`。
7. 修改文件完整禁用 Unicode 符号扫描。
8. `git diff --check`。

本计划不包括打包、安装应用、启动或终止 Tauri 实例、重启 Gateway、修改 Collaboration Plugin、提交或推送。
