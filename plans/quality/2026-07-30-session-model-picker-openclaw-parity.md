# 会话模型选择器与 OpenClaw 对齐计划

日期：2026-07-30

## 实施

- [x] 核对本机安装的 OpenClaw 版本、Control UI 尺寸、别名映射和图标资产。
- [x] 先增加紧凑布局和共享图标入口的失败契约测试。
- [x] 建立共享供应商身份、官方图标解析和本地展示元数据模块。
- [x] 将会话模型选择器收敛到官方同量级尺寸和信息密度。
- [x] 迁移共享模型下拉与模型服务设置，删除旧图标映射和无用导入。
- [x] 为新建与已有自定义供应商提供同一个图标输入控件。
- [x] 增加 52 个离线 SVG 的完整性测试并保留归属说明。
- [x] 完成全量自动化、生产构建和新的 Apple Silicon 本地预览包。
- [ ] 在 Tauri 真机中验证浅色、深色、窄窗口和大量模型场景。

## 文件边界

- `src/components/shared/provider-identity/`
- `src/components/Chat/session-runtime/SessionRuntimeControl.tsx`
- `src/components/shared/ModelDropdown.tsx`
- `src/pages/ConfigManager/ProvidersTab.tsx`
- `public/provider-icons/`
- 对应本地化、测试、规格和验证记录

## 回滚边界

回滚只移除 JunQi 展示层图标元数据和选择器布局，不修改 OpenClaw 配置、Gateway 模型目录或会话协议。
