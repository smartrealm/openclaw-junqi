# 项目交接状态

更新时间：2026-08-11

## 当前目标

收敛 GitHub Dependabot 与 npm audit 报告的公开依赖风险，并保证安全升级不破坏 JunQi 桌面端、文件预览和 OpenClaw 插件构建。

## 已完成内容

- 已核对 22 个远端公开告警的直接和传递依赖路径。
- 直接依赖已升级为 `dompurify 3.4.13`、`pdfjs-dist 6.2.108` 和 `react-router-dom 7.18.2`。
- 项目锁定的 pnpm 9 通过根 `package.json` 的精确版本选择器，将 OpenClaw 传递依赖收敛到 `@hono/node-server 2.0.10`、`tar 7.5.21` 与 `undici 8.9.0`；其余已报告的传递依赖同样收敛到公告修复版本。
- PDF.js 6 已移除 `PDFDocumentProxy.destroy`；文件预览改为调用其公开的 `cleanup` 契约，加载任务仍由自身 `destroy` 取消，并新增清理成功和失败的行为回归测试。
- 已新增依赖安全的文档、规格和实施计划记录。

## 关键技术决策

- OpenClaw Runtime 保持官方已发布的 `2026.7.1-2`，本次只调整依赖解析，不扩展或替代其协议和能力。
- 上游使用精确版本声明时，pnpm 9 必须使用带原始版本的覆盖选择器，通用范围覆盖不能保证安全版本被采用。
- 本机全局 pnpm 11 与项目锁定 pnpm 9 的配置读取位置不同；锁文件生成和安全审计以项目锁定的 pnpm 9 为唯一证据。

## 核心文件

- `package.json`
- `pnpm-lock.yaml`
- `src/components/FileExplorer/PdfPreview.tsx`
- `src/components/FileExplorer/pdfDocumentLifecycle.ts`
- `src/components/FileExplorer/filePreviewResourceRegression.test.ts`
- `docs/quality/dependency-security-remediation-2026-08-11.md`
- `specs/quality/2026-08-11-dependency-security-remediation.md`
- `plans/quality/2026-08-11-dependency-security-remediation.md`

## 测试与验证

- `npx --yes pnpm@9.15.9 install --frozen-lockfile` 通过。
- `npx --yes pnpm@9.15.9 audit --json` 返回低、中、高、严重风险均为零。
- `npx --yes pnpm@9.15.9 lint` 通过：模块边界扫描 922 个文件，版本一致性和 TypeScript 检查通过。
- `npx --yes pnpm@9.15.9 test` 通过。
- `npx --yes pnpm@9.15.9 build` 通过。
- `npx --yes pnpm@9.15.9 collab:test`、`dingtalk:test`、`collab:validate` 和 `dingtalk:validate` 通过。
- `git diff --check` 通过。

## 已知问题与未验证边界

- 远端 Dependabot 会在提交并推送后异步重新扫描；当前尚未推送，因此远端告警数量尚未刷新。
- 尚未完成本轮 macOS、Windows、Linux 的桌面安装包和真机 PDF 视觉验收。

## 失败方案

- 将覆盖配置只写入 `pnpm-workspace.yaml`：项目锁定的 pnpm 9 不会据此生成可复现的覆盖锁文件。
- 只使用通用包名覆盖上游的精确依赖：精确声明会保留旧版本，必须按原始版本选择器覆盖。
- 保留 PDF.js 5 的 `PDFDocumentProxy.destroy` 调用：PDF.js 6 类型契约不再提供该方法。

## 下一步顺序

1. 审查最终差异和完整 Emoji 扫描。
2. 经用户授权后提交并推送，等待 GitHub Dependabot 完成异步重扫。
3. 在桌面真机打开 PDF，验证预览、切页、缩放和关闭标签后的资源释放。
