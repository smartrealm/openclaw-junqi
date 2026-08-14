# 会话组织与 transcript 展示实施计划

## 实施顺序

1. 以 OpenClaw schema、Gateway handler 和 Control UI 核对组织字段、归档身份围栏及分叉契约。
2. 将组织响应核验改为官方时间戳字段，并补充所有正反向回归用例。
3. 向归档链路透传已知 `sessionId`，修正归档文案与用户错误映射。
4. 收紧新建空会话的空 transcript 事实保留，补充创建与列表竞态测试。
5. 将历史首次尾部定位延后到当前会话时间线条目已渲染，并补充入口条件测试。
6. 增加 transcript JSON 只读格式化投影，接入 assistant 正文与工具输出。
7. 运行定向测试、完整前端测试、lint、构建和差异检查。
8. 更新 `PROJECT_STATUS.md`，记录自动化结果与未完成的真机视觉验证。

## 文件范围

- `src/services/gateway/OpenClawSessionOrganizationClient.ts`
- `src/services/gateway/index.ts`
- `src/stores/chatGatewayOperations.ts`
- `src/stores/chatStore.ts`
- `src/components/Chat/session-actions/SessionActionsMenu.tsx`
- `src/components/Layout/NavSidebar.tsx`
- `src/pages/ChatView.tsx`
- `src/components/Chat/MessageInput.tsx`
- `src/processing/buildSemanticBlocks.ts`
- `src/components/Chat/ToolCallBubble.tsx`
- `src/utils/confirmedEmptyTranscript.ts`
- transcript 格式化辅助模块、对应测试和本地化资源

## 验证边界

- 自动化验证协议响应、状态投影、格式化与首次定位条件。
- 本机开发运行验证新建会话、打开历史会话和会话菜单。
- 长历史连续抓帧、暗色主题、窄窗口和目标平台真机结果分别记录，不以构建通过代替。
