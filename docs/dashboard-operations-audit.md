# Dashboard 数据与操作区审查

## 审查范围

- 活跃智能体名称与会话名称的一致性
- 每日费用查询、字段映射与空状态
- 活动列表的信息密度与排序
- 快速操作的真实可用能力

## 🔴 BUG-DASH-01 · 活跃智能体绕过统一名称解析

**位置**：`src/pages/Dashboard/index.tsx`

会话标签通过 `getAgentDisplayName()` 依次读取 `agent.name`、`agent.identity.name` 和 `agent.id`；Dashboard 的活跃智能体却优先使用一组写死的 i18n 名称，活动列表也只读取 `agent.name`。同一个智能体因此可能在会话区显示配置名称，在活跃智能体区显示内置名称或 ID。

**修复**：Dashboard 的智能体卡片与活动条目统一复用 `getAgentDisplayName()`，内置翻译只作为没有配置名称时的最终兜底。

## 🔴 BUG-DASH-02 · 全局面板只查询默认智能体费用

**位置**：`src/stores/gatewayDataStore.ts`、`src/services/gateway/index.ts`

JunQi 调用 `usage.cost` 和 `sessions.usage` 时没有传 `agentScope: "all"`。OpenClaw 2026.7.1-2 在缺省情况下只读取默认智能体，而官方控制台的全局用量页会显式传入 `agentScope: "all"`。Dashboard 同时又会合并所有智能体的会话，造成智能体列表与费用/用量统计口径不一致，非默认智能体的费用可能完全缺失。

**修复**：Dashboard 中央数据源和全量分析接口显式采用全智能体范围；保留按指定智能体查询的协议能力。

## 🔴 BUG-DASH-03 · 零费用日期被误判为空数据

**位置**：`src/pages/Dashboard/index.tsx`、`src/pages/Dashboard/CostChart.tsx`

OpenClaw 会返回连续日期桶，即使某些日期费用为 0，或者模型缺少价格配置。当前页面只有在至少一天 `totalCost > 0` 时才挂载图表，因此合法的日期数据会连同 X 轴一起消失，用户只能看到“暂无费用数据”。

**修复**：是否渲染图表只取决于是否存在合法日期桶；费用为 0 时继续显示日期轴和零值曲线，真正没有日期桶时才显示空状态。

## 🟡 BUG-DASH-04 · 活动列表丢弃已有上下文

**位置**：`src/pages/Dashboard/index.tsx`、`src/pages/Dashboard/components.tsx`

活动数据已包含会话模型、精确活跃时间、智能体和 Token，但 `FeedItem` 只接收一句拼接文本、智能体名和粗粒度相对时间。列表也直接截取未排序的 `activeSessions`，并把历史累计压缩次数插到最前面，不能可靠表达“最近活动”。

**修复**：按统一活跃时间降序生成条目，展示会话、智能体、模型、Token 和本地时间；移除没有事件时间的累计压缩伪活动。

## 🟡 BUG-DASH-05 · 快速操作只有两个入口

**位置**：`src/pages/Dashboard/index.tsx`

当前只提供“压缩”和“系统状态”。项目已经有稳定的新建会话、智能体、用量分析和技能路由，但控制中心没有入口，快速操作区的信息与功能密度明显不足。

**修复**：保留真实的压缩操作，增加新建会话、智能体、用量分析和技能入口，并按产品功能开关隐藏不可用入口。

## 验证记录

- OpenClaw 2026.7.1-2 的 `usage.cost` 接受 `days`，并返回连续 `daily` 日期桶及 `inputCost`、`outputCost`、`cacheReadCost`、`cacheWriteCost`、`totalCost` 字段。
- 官方控制台的全局用量请求显式使用 `agentScope: "all"`；JunQi 已对齐该口径。
- 聚焦 Dashboard 回归 14 项通过；全量应用测试 904 项、脚本测试 30 项通过。
- `npm run build`、`npm run lint` 和本地服务 HTTP 可达性检查通过。
- 当前执行环境没有可用的 in-app Browser 后端，因此未完成截图级桌面/窄屏视觉验收。
