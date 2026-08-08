# Windows Gateway 冷启动与默认主会话固定实施计划

## 顺序

1. 为 Gateway 地址别名与选定运行时 token 绑定增加失败回归测试。
2. 为默认主会话首位、关闭保护、重排保护和官方 `mainKey` 收敛增加状态层回归测试。
3. 统一 Gateway 端点身份比较，删除字符串全等判定。
4. 在 `chatStore` 建立单一默认主会话页签规范化入口，并由 OpenClaw 官方智能体快照更新身份。
5. 让 `ChatTabs` 直接消费状态层规范顺序，移除仅供渲染的临时排序。
6. 运行最小相关测试，再运行完整前端检查与构建。
7. 回写审计记录、索引和 `PROJECT_STATUS.md`，列出 Windows 真机未验证边界。

## 核心文件

- `src/services/gateway/GatewayConnectionTargetResolver.ts`
- `src/services/gateway/GatewayConnectionTargetResolver.test.ts`
- `src/stores/chatStore.ts`
- `src/stores/chatStore.test.ts`
- `src/components/Chat/ChatTabs.tsx`
- `src/App.tsx`
