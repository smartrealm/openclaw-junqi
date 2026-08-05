# 会话产物选择器稳定性修复

日期：2026-08-05

## 问题

`SessionContextBar` 在读取当前会话尚未加载的产物时，通过 Zustand selector 返回新建的
空数组。外部状态快照在没有数据变化时仍持续变更引用，React 会将其判定为不稳定快照，
并触发更新深度错误。

## 修复

`gatewayDataStore` 提供 `selectSessionArtifacts`，缺失会话产物时返回模块级冻结空数组。
组件只使用该选择器，因此同一状态的连续读取保持同一引用；实际 Gateway 产物数组仍直接
按会话键返回。

## 验证

- `gatewayDataStore.test.ts` 验证缺失会话产物的两次选择结果引用相同。
- 已运行定向状态测试和 `pnpm lint`。
- 仍需在真实 Desktop 窗口打开聊天页，确认错误边界不再显示 React 更新深度错误。
