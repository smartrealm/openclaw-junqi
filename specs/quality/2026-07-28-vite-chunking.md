# Vite 生产分包规格

状态：代码与自动化完成

日期：2026-07-28

## 目标行为

- 手工分包只描述稳定的第三方依赖边界，不按 `src/` 路径强制拆分业务模块。
- 应用模块由 Rollup 的真实入口与依赖图自动分配，不能产生人工制造的跨 chunk 循环。
- 单个生产 JavaScript chunk 不超过项目 550 kB 预算。
- 不得通过提高预算、关闭报告或过滤构建输出来假装修复。
- locale 资源不得以三份完整静态 JSON 聚合到同一个启动 chunk；初始语言与英文回退
  必须在渲染前可用，其余支持语言按需加载。
- 分包路径匹配必须兼容 Windows 和 Unix，并避免相似包名误命中。

## 验收

- [x] `settingsStore`、`gatewayDataStore`、Gateway service、theme 和 processing 不再拥有固定 chunk 名。
- [x] 第三方 chunk 策略抽取为可独立测试的纯函数。
- [x] React、i18n、PDF.js、xterm、CodeMirror、图表、motion、图标和 markdown 等既有第三方边界保留。
- [x] 路径规范化、精确包边界、CodeMirror language 和 d3 子包有回归覆盖。
- [x] Vite 生产构建没有 circular chunk warning。
- [x] Vite 生产构建没有 chunk size warning。
- [x] 最大 JavaScript chunk 为按需加载的 `pdfjs` 513.31 kB，低于 550 kB。
- [x] circular chunk 或 JavaScript chunk 超预算会让构建失败，而不是留下可忽略的 warning。
- [x] locale 资源加载器按语言拆分 JSON chunk，启动等待初始语言与英文回退。
- [x] 懒加载语言失败时不改变当前语言或持久化偏好。

## 未验证边界

本规格不改变运行时代码、Tauri IPC、签名或发布流程。生产前端产物已构建，未因此声明 Tauri 安装包或目标平台真机通过。
