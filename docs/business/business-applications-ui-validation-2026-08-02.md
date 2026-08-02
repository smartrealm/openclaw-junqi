# 业务应用 UI 验证记录

日期：2026-08-02

## 已实现

- 新增 `/business-applications` 顶级路由、feature flag、顶部“业务应用”Tab 和对应上下文侧栏。
- 页面使用 catalog 驱动的应用选择、详情和操作记录；当前 catalog 列出钉钉工作台、飞书和 Google Workspace。应用选择采用与仪表盘一致的内容区布局，不再与全局侧栏叠加形成独立三栏页面。
- 三个平台均明确处于等待运行时、配置或授权的展示状态，页面不调用第三方 API、不读取凭据、不伪造探测结果。
- 在能力页选择“交给 AI 规划”会保留当前会话既有草稿，追加脱敏的计划请求，然后跳转到 Chat。
- 页面、导航和请求提示均具备简体中文、繁体中文和英文资源；展示图标为项目既有 Lucide 图标，不使用 Emoji。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `pnpm exec tsc --noEmit` | 通过。 |
| `node --import ./test-setup.ts --import tsx --test src/business-applications/*.test.ts` | 通过，覆盖 catalog 稳定性与 Chat 草稿追加。 |
| `pnpm build` | 通过，包含 collaboration bundle、TypeScript 与 Vite 生产构建。 |
| 本机 macOS 制品 | `pnpm tauri build --bundles app,dmg --no-sign` 已生成 arm64 `.app` 与 DMG；DMG 通过 `hdiutil verify`。制品未使用开发者证书签名或公证。 |
| `git diff --check` | 通过。 |
| JSON 解析 | 三份语言资源通过解析。 |
| Emoji 扫描 | 通过。 |

## 未验证边界

- 当前自动化环境无可用浏览器实例，未产生交互截图或进行像素级桌面验收。
- 未接入 Tauri `BusinessIntegrationRegistry`、DWS、飞书 OAuth、Google Workspace OAuth、系统凭据库或任何第三方平台读写操作。
- 因此“交给 AI 规划”仅完成业务页到 Chat 的可见草稿桥接，不构成 AI 调用第三方业务能力的声明。
