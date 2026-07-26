# Dashboard 数据与操作区执行计划

## 执行顺序

| 阶段 | 问题 | 文件 | 调整 |
| --- | --- | --- | --- |
| A | BUG-DASH-02 | `src/stores/gatewayDataStore.ts`、`src/services/gateway/index.ts` | 统一全智能体费用/用量查询范围并补齐类型 |
| B | BUG-DASH-03 | `src/pages/Dashboard/dashboardData.ts`、`index.tsx` | 规范费用日期桶并按“有日期”决定图表挂载 |
| C | BUG-DASH-01 | `src/pages/Dashboard/index.tsx` | 复用统一智能体展示名称解析 |
| D | BUG-DASH-04 | `src/pages/Dashboard/index.tsx`、`components.tsx` | 重构活动数据与紧凑双行呈现 |
| E | BUG-DASH-05 | `src/pages/Dashboard/index.tsx`、本地化资源 | 扩展真实快速操作并尊重功能开关 |
| F | 全部 | Dashboard / Gateway 聚焦测试、生产构建、浏览器截图 | 验证数据契约、交互、桌面与窄屏布局 |
