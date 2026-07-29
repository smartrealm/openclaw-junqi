# 加载指示器收敛记录

日期：2026-07-29

状态：代码与自动化完成，待桌面视觉验收

## 依据与现状

[MageCDN SVG Loaders](https://magecdn.com/tools/svg-loaders) 展示了使用内联 SVG、`currentColor` 和轻量动效表达加载状态的方式。JunQi 此前同时存在 Lucide `Loader2`、按钮 CSS 圆环和聊天媒体手写圆环，颜色、动画速度、减弱动画和无障碍语义不一致。

MageCDN 仅作为视觉模式参考。JunQi 不加载其 CDN、脚本或远程 SVG，也没有复制第三方 SVG 路径，因此运行时、CSP 和离线能力不依赖该站点。

## 当前行为

- `LoadingIndicator` 是不确定进度的共享入口，使用内联 SVG 和 `currentColor`。
- `spinner` 用于按钮、运行状态和局部后台操作；`dots` 用于页面、文件和媒体内容等待。
- 组件尺寸稳定，不会因动画改变父级布局；无文本时默认是装饰元素，传入 `label` 时暴露 `role=status` 和 polite live region。
- `prefers-reduced-motion: reduce` 下停止旋转和缩放动画，保留静态可识别图形。
- `Button`、共享 `StatusIcon`、路由懒加载、工作区文件/PDF 预览和聊天图片/视频已接入。
- 刷新操作继续旋转其 `RefreshCw` 图标，以保留“当前命令正在执行”的语义；结构稳定的列表仍可使用 skeleton，不强制改成 spinner。

## 约束

- 新加载状态应复用 `LoadingIndicator` 或已有 `Button loading`，不得新增手写 border spinner。
- 不得为了加载动画引入外部请求、运行时脚本或新依赖。
- 可见加载文案由调用方通过 i18n 提供；图标不得重复朗读同一段可见文案。

## 验证

- 组件 SSR 行为测试覆盖两种变体、尺寸和无障碍属性。
- `StatusIcon` 回归确认运行状态已使用共享组件。
- TypeScript 检查、完整前端测试、生产构建与 `git diff --check` 已通过。
- 尚未运行 Tauri 桌面视觉走查，动画节奏、不同主题对比度和系统减弱动画仍需真机确认。
