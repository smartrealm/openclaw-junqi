# 文件预览收敛规格

状态：代码与自动化完成，待桌面交互验收

日期：2026-07-29

## 目标行为

- 工作台、智能体工作区和文件管理器目录模式继续共用 `FileViewer`。
- 托管输出、上传文件和聊天文件结果共用一个只读预览联合类型、加载入口和渲染组件。
- Markdown 文件统一使用 `MarkdownPreview`；HTML 文件保持 scoped protocol 与 sandbox；image、audio、video、PDF 使用同一媒体分支。
- 同一种真实文件格式在文件管理器和聊天结果中具有相同的可预览判断。
- 终端文件树打开文件时进入文件管理器目录模式，并由 `FileViewer` 打开目标文件。
- 文件预览路由只接受项目根目录内的目标文件。
- 记忆详情、聊天正文和生成式 artifact 不冒充工作区文件。

## 验收

- [x] 删除 `ResultMarkdownPreview` 和 `FileMarkdownPreview`。
- [x] 文件管理器删除 binary/HTML/text 三套并行预览状态和 effect。
- [x] 聊天文件结果支持 PDF、音频和视频，并复用只读预览组件。
- [x] `view=tree&path=...&file=...` 能稳定打开共享文件预览。
- [x] 根目录外的 `file` 参数不会创建页签。
- [x] 定向和全量自动化验证通过。
- [ ] 完成 Tauri 桌面交互验收。

## 未验证边界

Tauri scoped preview URL、系统 PDF WebView 和终端路由需要桌面真机走查；自动化通过不能替代该结论。
