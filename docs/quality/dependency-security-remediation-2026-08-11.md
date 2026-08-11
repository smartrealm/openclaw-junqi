# 依赖安全风险收敛

更新时间：2026-08-11

## 依据与边界

- 依据：GitHub Dependabot 的公开告警、`pnpm audit` 返回的 npm 公告，以及 pnpm 9 的依赖覆盖契约。
- OpenClaw 仍保持官方已发布的 `2026.7.1-2`；本次不改写 Gateway 协议、插件语义或运行时能力。
- 覆盖仅用于将上游精确锁定的传递依赖解析到公告已修复版本，不引入本地替代实现或伪造行为。

## 当前实现

直接依赖升级至公告已修复版本：

- `dompurify`：`3.4.13`
- `pdfjs-dist`：`6.2.108`
- `react-router-dom`：`7.18.2`

根 `package.json` 的 `pnpm.overrides` 由项目锁定的 pnpm `9.15.9` 读取。对 OpenClaw 精确依赖使用带原始版本的选择器，确保以下传递依赖不会被原始精确版本重新解析：

- `@hono/node-server`：`2.0.10`
- `tar`：`7.5.21`
- `undici`：`8.9.0`
- `hono`、`fast-uri`、`ip-address`、`brace-expansion`、`nanoid` 与 `postcss`：相应公告修复版本。

## 验证结果

- `npx --yes pnpm@9.15.9 install --frozen-lockfile` 通过。
- `npx --yes pnpm@9.15.9 audit --json` 返回零个低、中、高和严重风险。
- 本机全局 pnpm 为 11.17.0，与项目声明的 pnpm 9 配置读取位置不同；本次锁文件仅用项目声明的 pnpm 9 生成和验证。

## 未验证边界

- 远端 Dependabot 在提交推送后异步重新扫描；本地零风险审计不等同于远端告警已刷新。
- 尚未在 macOS、Windows、Linux 的完整桌面安装包中执行本轮真机验证。
