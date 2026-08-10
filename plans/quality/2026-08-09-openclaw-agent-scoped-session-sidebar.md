# OpenClaw 智能体作用域会话侧栏实施计划

日期：2026-08-09

## 执行顺序

### 阶段一：纯领域投影

| 问题 | 文件 | 调整 |
| --- | --- | --- |
| BUG-SS-01 | `src/components/Layout/sidebarUtils.ts` | 增加智能体作用域过滤与选择解析 |
| BUG-SS-02 | `src/components/Layout/sidebarUtils.ts` | 使用已确认主会话 key 构造固定首行 |
| BUG-SS-03 | `src/components/Layout/sidebarUtils.ts` | 删除日期分桶，按 `category` 单一归属分组 |
| BUG-SS-04 | `src/components/Layout/sidebarUtils.ts` | 增加创建时间和最近更新排序 |
| BUG-SS-07 | `src/components/Layout/sidebarUtils.ts` | 优先按 Gateway `createdAt` 排序，仅为缺失时间的旧会话维护稳定次级顺序，并支持已确认新会话提升 |

### 阶段二：侧栏交互

| 问题 | 文件 | 调整 |
| --- | --- | --- |
| BUG-SS-01 | `src/components/Layout/NavSidebar.tsx` | 增加智能体选择并绑定新建会话 |
| BUG-SS-02 | `src/components/Layout/NavSidebar.tsx` | 主会话固定第一 |
| BUG-SS-04 | `src/components/Layout/SessionScopeControls.tsx` | 增加分组与排序菜单 |
| BUG-SS-05 | `src/components/Layout/NavSidebar.tsx` | 增加 `/sessions` 入口 |
| BUG-SS-06 | `src/components/Layout/SessionScopeControls.tsx` | 将纯选择器恢复为包含智能体切换、新建和设置的完整菜单 |
| BUG-SS-07 | `src/components/Layout/NavSidebar.tsx` | 持有侧栏稳定创建顺序，并在新会话确认后提升对应 key |

### 阶段三：清理与文案

- 删除日期分桶类型、工具函数、本地存储和专属测试。
- 删除工作台侧栏中被新会话作用域头部取代的重复入口。
- 更新简体中文、繁体中文和英文文案。

### 阶段四：验证

- 运行侧栏纯函数和交互契约测试。
- 增加真实 `createdAt` 覆盖首次活动顺序、缺失时间、轮询重排和新会话提升的回归测试。
- 运行 TypeScript、模块边界、完整前端测试和生产构建。
- 执行 `git diff --check` 和 Emoji 扫描。
- 回写根目录 `PROJECT_STATUS.md`。
