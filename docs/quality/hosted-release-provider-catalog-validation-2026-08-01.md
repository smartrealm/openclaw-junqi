# 托管发布 Provider Catalog 构建验证

日期：2026-08-01

## 依据

- `scripts/generate-provider-catalog.js` 默认要求 OpenClaw CLI 的 `models list --all --json` 成功，缺失或不完整的 CLI 输出会失败关闭。
- `src/generated/providerCatalog.generated.ts` 与 `src/generated/mediaCatalog.generated.ts` 是仓库已提交的生成物。
- 2026-08-01 的 `v1.5.3` 标签发布在 Windows runner 中失败：该 runner 的 OpenClaw CLI 输出不是有效 JSON，导致 Tauri 的 `beforeBuildCommand` 在打包前退出。

## 当前行为

- 本地和常规 CI 的 `pnpm build` 继续执行 `generate:provider-catalog`，没有官方 Catalog 时失败关闭。
- 标签发布使用 `src-tauri/tauri.hosted-release.conf.json` 覆盖 `beforeBuildCommand` 为 `pnpm run build:hosted-release`。
- `build:hosted-release` 使用 `generate:provider-catalog -- --if-missing`。两个已提交的生成物都存在时，脚本只复用它们，不调用 runner 本地的 OpenClaw CLI，也不以模板数据改写 Catalog。
- 如果任一生成物缺失，`--if-missing` 会按原有严格路径生成；无官方 CLI 时仍会失败，不能静默发布缺少 Catalog 的安装包。

## 验证

- `scripts/windows-install-hardening.test.mjs` 断言常规构建保持严格、托管配置只指向受控脚本，并确认标签工作流实际加载该配置。
- 仍需由新的不可变标签在 GitHub Windows runner 上完成真实打包验证；上一失败标签 `v1.5.3` 不移动、不复写。
