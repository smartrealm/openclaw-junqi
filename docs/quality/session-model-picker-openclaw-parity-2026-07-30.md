# 会话模型选择器与 OpenClaw 对齐记录

日期：2026-07-30

## 权威依据

- 本机实际安装版本：`OpenClaw 2026.7.1-2 (0790d9f)`。
- 已安装 Control UI 的模型选择器样式位于 `dist/control-ui/assets/index-LH4ofOKi.css`：弹层宽度上限为 420px、高度上限为 460px，供应商栏为 136px。
- 已安装 Control UI 的供应商别名和图标解析位于 `dist/control-ui/assets/chat-page-DrPkxqJK.js`。
- `dist/control-ui/provider-icons/` 含 52 个供应商 SVG 和上游 MIT 归属说明。JunQi 将这些文件逐个复制到 `public/provider-icons/`，保留 `ATTRIBUTION.md`。

## 原有问题

- 会话模型弹层宽度达到 620px，供应商和模型区域比例松散，明显大于官方桌面控件。
- 会话、共享模型下拉和模型服务设置分别维护供应商图标，新增供应商时容易出现三套结果。
- 自定义供应商没有稳定的图标展示元数据；把图标字段写进 OpenClaw provider 配置又会越过官方配置契约。

## 修改结果

- 会话模型弹层收敛为 420px 上限、460px 高度上限和 136px 供应商栏；列表密度、选中态和按钮全部使用主题语义变量。
- `ProviderIcon`、供应商标签、官方别名和自定义回退统一收口到 `components/shared/provider-identity/`。
- 内置供应商使用 OpenClaw 同源 SVG mask，并继承当前主题文字色；旧 `Icon.provider` 映射及其无用图标导入已删除。
- 自定义供应商可以在新建流程和已有供应商卡片中设置短文字或符号图标。数据仅保存在 `junqi:provider-appearance:v1` 本地展示元数据中，不写入 OpenClaw 配置，也不影响供应商连接。
- 会话顶部触发器同时显示供应商图标、模型名和 thinking 状态；当前模型仍不可重复选择。

## 验证边界

- 资产完整性测试要求 52 个 SVG 均能被统一解析器寻址。
- 模型选择器契约测试覆盖官方尺寸、共享图标入口、自定义元数据边界和已有供应商编辑入口。
- `pnpm lint` 通过，TypeScript 与模块边界无错误。
- `pnpm test` 通过：1910 项前端测试、224 项脚本测试，无失败。
- `pnpm build` 通过：8961 个模块完成生产构建，循环 chunk 与 JavaScript chunk 预算门禁均通过；52 个 SVG 和归属文件进入 `dist/provider-icons/`。
- Apple Silicon 本地预览包 `JunQi Desktop_1.4.18_aarch64.dmg` 构建成功，`hdiutil verify`、应用签名结构和 arm64 架构校验通过；SHA-256 为 `1d9c8879dcd9b818059ad7c703ac21412b7b412f76ea22de26bda2477d7ce627`。
- 该应用是 ad-hoc 签名，没有 Team Identifier，未公证，不是正式发布制品。
- Tauri 真机视觉验收待执行；当前环境的应用内浏览器运行时不可用，因此不把源码和构建通过描述成视觉验收通过。
