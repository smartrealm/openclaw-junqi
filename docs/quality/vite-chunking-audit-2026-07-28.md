# Vite 生产分包审计

日期：2026-07-28

范围：Vite 6.4.3、Rollup `manualChunks`、生产 JavaScript chunk 预算

## 结论

生产构建此前不是因为业务入口缺少懒加载而超限，而是 `vite.config.ts` 按源码路径把相互依赖的 store、Gateway、theme 和 message processing 模块强制放进不同 chunk。随后又用兜底规则把剩余内部模块集中到 `app-core`，最终同时产生三个 circular chunk 警告和一个 694.30 kB 的 `app-core`。

当前策略只对稳定的第三方包边界命名。所有 `src/` 应用模块返回 `undefined`，由 Rollup 根据静态入口、动态入口和真实依赖图决定归属。修复后的生产构建没有 circular chunk 或 chunk size warning；最大 JavaScript chunk 是按需加载的 `pdfjs`，513.31 kB，低于项目既有的 550 kB 预算。

## 依据

- 项目实际安装并执行的版本是 Vite 6.4.3。
- [Vite 6 Build Options](https://v6.vite.dev/config/build-options) 说明 `build.rollupOptions` 会与内部 Rollup 配置合并，`chunkSizeWarningLimit` 只定义未压缩 JavaScript chunk 的提示阈值。
- [Rollup manualChunks](https://rollupjs.org/configuration-options/#output-manualchunks) 说明函数返回 chunk 名会影响模块及其依赖的归属，并可能改变副作用执行时机。

因此，本轮没有通过继续提高 `chunkSizeWarningLimit` 或过滤 stderr 隐藏问题，而是撤销内部源码路径的强制分包。

## 前后对比

| 项目 | 修复前 | 修复后 |
| --- | --- | --- |
| circular chunk | `store-settings -> app-core -> store-settings`；`app-core -> store-gateway-data -> app-core`；`app-core -> message-processing -> app-core` | 无 |
| 最大应用共享 chunk | `app-core` 694.30 kB / gzip 227.03 kB | 不再生成 |
| 最大 JavaScript chunk | `app-core` 694.30 kB | 懒加载 `pdfjs` 513.31 kB / gzip 155.58 kB |
| chunk size warning | 有 | 无 |

PDF worker 是 PDF.js 独立 worker 资产，大小 1,286.28 kB，不是 Vite 报告的 JavaScript 入口 chunk，也不会进入应用首屏执行链。

## 实现约束

- `scripts/vite-chunk-strategy.mjs` 是唯一手工分包规则来源。
- 规则只接受精确的 `node_modules/<package>` 边界，避免 `react-dom-extra` 等相似名称误命中。
- 路径先规范为 `/`，同一策略覆盖 Windows 和 Unix 模块 ID。
- CodeMirror 语言和 d3 子包保持独立缓存；其余未匹配依赖交给 Rollup。
- 回归测试明确要求 store、Gateway、processing 和 theme 源码不得返回手工 chunk 名。
- 550 kB 预算由配置与构建门禁共用同一常量；超限 chunk 会让构建失败，不只输出 warning。
- Rollup `CIRCULAR_CHUNK` 会升级为构建错误；其他 warning 仍交给默认处理器，不能被静默吞掉。

## 验证边界

已直接运行 Vite 生产构建并检查完整输出；完整 `pnpm build` 同时通过 collaboration bundle 合约和 TypeScript。`pnpm lint` 通过并检查 577 个源码文件，前端测试 1,694 项通过，最终脚本套件 223 项通过。该验证证明当前源码产物不再报告 circular chunk 和 chunk size warning，不代表 Tauri 安装包已经签名、公证或在各目标平台启动验证。
