# 托管发布 Provider Catalog 构建验证

日期：2026-08-01

## 依据

- `scripts/generate-provider-catalog.js` 显式再生成时要求 OpenClaw CLI 的 `models list --all --json` 成功，缺失或不完整的 CLI 输出会失败关闭。
- `src/generated/providerCatalog.generated.ts` 与 `src/generated/mediaCatalog.generated.ts` 是仓库已提交的生成物。
- 2026-08-01 的 `v1.5.3` 标签发布在 Windows runner 中失败：该 runner 的 OpenClaw CLI 输出不是有效 JSON，导致 Tauri 的 `beforeBuildCommand` 在打包前退出。
- `packages/junqi-collab/package.json` 将 OpenClaw 固定为精确版本；再生成脚本必须验证该版本与工作区已安装包一致，不能回退到开发机全局 CLI。

## 当前行为

- 本地、常规 CI 与标签发布的 `pnpm build` 都执行 `generate:provider-catalog -- --if-missing`。两个已提交的生成物存在时，只复用它们，不读取本机 CLI，也不改写 `src/generated`。
- 标签发布使用 `src-tauri/tauri.hosted-release.conf.json` 覆盖 `beforeBuildCommand` 为 `pnpm run build:hosted-release`。
- 如果任一生成物缺失，`--if-missing` 会进入严格的工作区再生成路径；已安装 OpenClaw 与锁定版本不一致时，提示执行 `pnpm install --frozen-lockfile` 后失败退出。
- 有意更新 Catalog 时使用 `pnpm run generate:provider-catalog`。默认只接受工作区锁定的 OpenClaw；`OPENCLAW_BIN` 是显式覆盖，生成物会记录该 CLI 报告的版本。

## 验证

- `scripts/windows-install-hardening.test.mjs` 断言常规与托管构建均复用受版本控制的 Catalog，并确认标签工作流实际加载受控配置。
- `scripts/generate-provider-catalog.test.mjs` 断言锁定版本不匹配会失败退出，防止安装目录漂移改写生成源码。
- 仍需由新的不可变标签在 GitHub Windows runner 上完成真实打包验证；上一失败标签 `v1.5.3` 不移动、不复写。
