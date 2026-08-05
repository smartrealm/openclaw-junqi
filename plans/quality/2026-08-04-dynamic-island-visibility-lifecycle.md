# 灵动岛显隐生命周期计划

日期：2026-08-04

## 执行顺序

- [x] 审查 OpenClaw 官方 `session.observer` 协议、JunQi 状态投影、辅助窗口事件和 Rust
  生命周期锁，确认窗口显隐不属于 Gateway 契约。
- [x] 复现显隐请求可跨窗口乱序到达的路径，并确认预览计时器没有代际围栏。
- [x] 增加仅由主窗口调用的串行可见性控制器，并把辅助窗口关闭改为意图回传。
- [x] 为过期打开和过期计时器增加行为回归测试。
- [x] 执行全量验证、扫描无引用代码和 Emoji，记录结果并以中文提交。

## 文件范围

- `src/dynamic-island/DynamicIslandVisibilityController.ts`
- `src/dynamic-island/DynamicIslandVisibilityController.test.ts`
- `src/dynamic-island/DynamicIslandRuntime.tsx`
- `src/dynamic-island/DynamicIsland.tsx`
- `src/dynamic-island/DynamicIslandActions.ts`
- `src/dynamic-island/DynamicIsland.test.ts`
- `src/dynamic-island/DynamicIslandPreview.ts`
- `src/dynamic-island/DynamicIslandPreview.test.ts`
- 本规格、计划、审计记录及三层索引

## 非目标

- 不新增或修改 OpenClaw Gateway 协议。
- 不修改 Tauri 窗口样式、平台打包、系统权限或用户设置的数据模型。
