# Vite 生产分包实施计划

日期：2026-07-28

## 任务

- [x] 复现并记录完整 Vite circular chunk 与 size warning。
- [x] 核对 Vite 6.4.3 和 Rollup `manualChunks` 契约。
- [x] 删除按应用源码路径强制分包的规则。
- [x] 抽取第三方 chunk 解析器，并处理跨平台路径和精确包边界。
- [x] 增加分包策略回归测试。
- [x] 将 circular chunk 和 JavaScript chunk 预算升级为构建失败门禁。
- [x] 重新生成生产产物并核对 chunk 清单。
- [x] 运行完整 lint、测试、生产构建和 diff 检查。
- [x] 将完整 locale JSON 从同步 i18n 入口移到按需资源加载器，保持初始语言与英文
  回退的启动可用性。

## 主要影响文件

- `vite.config.ts`
- `scripts/vite-chunk-strategy.mjs`
- `scripts/vite-chunk-strategy.test.mjs`

## 回滚与验证边界

回滚时应整体恢复原分包策略与其测试，不能只删除测试或调高体积阈值。当前验证只覆盖前端生产构建，不覆盖 Tauri 安装包与签名流程。
