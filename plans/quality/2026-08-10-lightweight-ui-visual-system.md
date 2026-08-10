# 全局轻量视觉系统实施计划

日期：2026-08-10

## 实施顺序

1. 调整四套主题的边框、强调表面、菜单阴影、卡片阴影、浮层阴影和遮罩令牌。
2. 缩小深色主题的表面亮度级差，保留页面、侧栏、输入区和浮层的必要区分。
3. 修改共享 `GlassCard`，降低圆角、内边距和悬停位移。
4. 修改共享 Radix 下拉菜单与对话框，统一使用 Aegis 阴影、边框、背景和遮罩。
5. 搜索高频页面中的固定大阴影、固定黑色遮罩和过大圆角，仅处理能够由共享边界替代的实现。
6. 运行主题测试、组件测试、完整静态检查、完整测试和生产构建。
7. 使用本地页面复核亮色与暗色主要视图，并记录无法替代的桌面真机验收边界。
8. 更新根目录 `PROJECT_STATUS.md`，执行 Emoji 扫描和 Git 检查后提交。

## 主要文件

- `src/styles/themes/aegis-light.css`
- `src/styles/themes/aegis-dark.css`
- `src/styles/themes/aegis-midnight.css`
- `src/styles/themes/aegis-eyecare.css`
- `src/components/shared/GlassCard.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/dialog.tsx`

## 风险控制

- 不批量替换业务组件 className，优先调整语义令牌和共享组件。
- 不删除状态色，不降低焦点环和正文对比度。
- 不用当前开发机截图代替 Windows、Linux 和 macOS 真机结论。
