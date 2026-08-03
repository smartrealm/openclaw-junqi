# Provider Catalog 构建可复现性

日期：2026-08-03

## 问题

`src/generated/providerCatalog.generated.ts` 是受版本控制的生成物。普通 `pnpm build` 曾每次调用再生成脚本，脚本从本机可执行的 OpenClaw CLI 读取版本并写回该文件。工作区 `node_modules` 与锁定版本不一致时，即使应用源码未变，也会产生与开发机相关的生成差异。

## 目标

- 普通构建、CI 构建和托管发布构建只使用已提交的两个 Catalog 生成物，不改写它们。
- 仅显式执行 `pnpm run generate:provider-catalog` 时再生成。
- 默认再生成只使用 `packages/junqi-collab` 中锁定的精确 OpenClaw 版本；已安装包版本不一致时失败退出并给出恢复命令。
- `OPENCLAW_BIN` 保留为有意的显式 CLI 覆盖，不能由 `PATH` 自动选择全局版本。

## 非目标

- 不在本次修改中更新现有 Catalog 内容。
- 不修改锁文件、安装目录或发布版本。

## 验收

- `pnpm build` 后 `src/generated/providerCatalog.generated.ts` 与 `src/generated/mediaCatalog.generated.ts` 不发生改写。
- 默认再生成遇到锁定版本与工作区安装版本不一致时失败，错误提示包含 `pnpm install --frozen-lockfile`。
- 相关脚本测试、TypeScript 检查和生产构建通过。
