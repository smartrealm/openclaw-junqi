# 加载指示器收敛计划

日期：2026-07-29

## 任务

- [x] 盘点按钮、页面、状态图标、文件预览和媒体加载实现。
- [x] 提取无外部依赖的共享 SVG 加载组件。
- [x] 为尺寸、颜色继承、无障碍和 reduced-motion 建立契约。
- [x] 迁移核心共享边界并删除被替代的按钮/媒体 spinner。
- [x] 补充回归测试与行为记录。
- [x] 运行 TypeScript、全量前端测试和生产构建。
- [ ] 完成桌面视觉走查。

## 影响文件

- `src/components/shared/LoadingIndicator.tsx`
- `src/components/shared/button/Button.tsx`
- `src/components/shared/StatusIcon.tsx`
- `src/components/FileExplorer/`
- `src/components/Chat/ChatImage.tsx`
- `src/components/Chat/ChatVideo.tsx`
- `src/components/Layout/AppLayout.tsx`
- `src/styles/index.css`

## 回滚边界

变更仅涉及前端加载指示器渲染，不修改持久化、IPC、Gateway 或文件内容。回滚不需要数据迁移。
