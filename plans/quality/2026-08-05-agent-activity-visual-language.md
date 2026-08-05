# Agent 活动视觉语言实施计划

日期：2026-08-05

## 范围

- `src/components/shared/AgentActivityIndicator.tsx`
- `src/components/Chat/ThinkingBubble.tsx`
- `src/components/Chat/ExecutionProcessGroup.tsx`
- `src/dynamic-island/`
- `src/pages/AgentHub/index.tsx`
- Aegis 共享样式、依赖锁和第三方声明
- 对应自动化、文档和规格

## 实施顺序

1. 锁定并审阅 `thinking-orbs` 0.2.0，记录许可证、主题、Reduced Motion 和性能行为。
2. 建立 JunQi 包装组件，只暴露有真实状态来源的活动类型。
3. 接入 Chat 思考与执行汇总，删除同一状态上的重复动画。
4. 接入灵动岛结构化阶段，空闲和注意状态保留既有语义。
5. 接入 Agent Hub 聚合运行卡片，不扩散到普通加载操作。
6. 使用 Aegis Token 收敛活动边框，不接入 Border Beam 运行时。
7. 运行定向测试、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check` 和 Emoji 扫描。

## 验证计划

自动化：

```bash
node --import ./test-setup.ts --import tsx --test \
  src/components/shared/AgentActivityIndicator.test.tsx \
  src/components/Chat/agentActivityPresentation.test.ts \
  src/components/Chat/executionProcessViewport.test.ts \
  src/dynamic-island/DynamicIsland.test.ts
pnpm lint
pnpm test
pnpm build
git diff --check
```

人工验收：

- Light、Dark、Eyecare 和 Midnight。
- Chat 长消息滚动、灵动岛紧凑与展开、Agent Hub 树状与网格视图。
- 窄窗口、键盘焦点和系统 Reduced Motion。
- Windows 125% 与 150% 缩放及低性能设备。

## 停止条件

如果 Canvas 在消息滚动、灵动岛辅助窗口或低性能 Windows 上出现明显掉帧、模糊或高功耗，则保持业务组件接口不变，暂停扩大范围并替换包装组件内部实现。
