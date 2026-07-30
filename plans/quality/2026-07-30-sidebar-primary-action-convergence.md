# 侧栏主操作一致性实施计划

日期：2026-07-30

## 实施

- [x] 盘点展开侧栏各页签顶部主操作的实现与主题语义。
- [x] 新增单一职责的 `SidebarPrimaryAction` 组件。
- [x] 替换工作台、智能体和工具页签的重复按钮实现。
- [x] 增加共享组件使用与固定样式清理的回归测试。
- [x] 完成完整 lint、测试和生产构建。
- [ ] 完成 macOS 真机逐页签视觉验收。

## 文件范围

- `src/components/Layout/SidebarPrimaryAction.tsx`
- `src/components/Layout/NavSidebar.tsx`
- `src/components/Layout/NavSidebarPanels.tsx`
- `src/components/Layout/*test.ts`
- `docs/quality/`、`specs/quality/`、`plans/quality/`
