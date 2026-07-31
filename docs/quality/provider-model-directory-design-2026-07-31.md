# 提供商模型目录设计记录

## 依据

- `src/pages/ConfigManager/ProviderModelEditor.tsx` 已使用固定列的模型编辑表，能够编辑模型别名、图片输入能力和默认路由。
- `src/components/shared/provider-identity/ProviderIcon.tsx` 是提供商图标的唯一实现：内置提供商使用应用打包的官方 SVG，自定义提供商使用本地持久化的受限标记。

## 原行为

“模型与别名”概览将模型引用、别名、主模型、图片模型和删除操作压缩在可换行标签中。长模型名和多个动作会改变行高，无法稳定扫描，也与各提供商内的模型编辑表重复。

## 目标行为

概览改为只负责跨提供商浏览和快捷路由操作的固定列目录：提供商、模型 ID、别名和操作。模型按提供商及模型 ID 排序；窄窗口保持固定最小宽度并横向滚动，不把操作换行。模型详情和别名编辑仍由提供商卡片内的 `ProviderModelEditor` 负责。

## 验证

- `ConfiguredModelDirectory.test.ts` 覆盖提供商分组排序和异常模型引用保留。
- 已通过定向目录测试和 `ProvidersTab.design.test.ts`。
- 已通过 `pnpm lint`、`pnpm build` 和 `git diff --check`。
