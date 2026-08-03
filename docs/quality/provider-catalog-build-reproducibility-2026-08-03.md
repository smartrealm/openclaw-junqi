# Provider Catalog 构建可复现性验证

日期：2026-08-03

## 依据

- `packages/junqi-collab/package.json` 将 `openclaw` 固定为 `2026.7.1-2`。
- `pnpm-lock.yaml` 解析同一版本。
- 现场工作区已安装包报告 `2026.7.1`，与锁定版本不一致；此前普通 `pnpm build` 会把该环境差异写入 `src/generated/providerCatalog.generated.ts` 的 metadata。

## 变更

- `package.json#build` 与 `build:hosted-release` 均使用 `generate:provider-catalog -- --if-missing`，已提交的两个 Catalog 存在时不调用 CLI。
- 显式再生成默认读取工作区 OpenClaw 包，并要求其版本与协作包 manifest 的精确依赖一致。
- 默认路径不再从 `PATH` 查找全局 OpenClaw；只有用户明确设置 `OPENCLAW_BIN` 时才使用外部 CLI。
- 默认生成的 metadata 使用已校验的锁定包版本，避免把 CLI 的构建字符串当作普通构建的环境输入。

## 验证范围

- 已通过：`pnpm exec tsx --test scripts/generate-provider-catalog.test.mjs scripts/windows-install-hardening.test.mjs`，14 项通过。
- 已通过：`pnpm build`。日志确认两个 Catalog 均为 `Skip generation (already exists)`；随后 `git diff -- src/generated/providerCatalog.generated.ts src/generated/mediaCatalog.generated.ts` 无输出。
- 已通过：`pnpm lint` 与 `git diff --check`。
- 已通过：`pnpm test`，前端与脚本测试均无失败项。
- 已验证失败路径：当前工作区安装包为 `2026.7.1`，显式 `pnpm run generate:provider-catalog` 因其与锁定的 `2026.7.1-2` 不一致而失败退出，未改写生成文件。
- 未执行：本次不运行 `pnpm install --frozen-lockfile`，不修改用户工作区的 `node_modules`。因此显式再生成在当前机器上应按设计失败，直至依赖安装恢复为锁定版本。
