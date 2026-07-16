# Windows/macOS 运行时聚合执行计划

日期：2026-07-16

## 执行顺序

### 阶段 A — 修复表面成功但实际无效

| 问题 | 文件 | 修复 |
|---|---|---|
| BUG-RP-01 | `managed_runtime.rs`、`system.rs`、设置页 | 根据活动来源决定是否允许托管更新，系统工具可用时不下载未使用副本 |

### 阶段 B — 统一领域语义

| 问题 | 文件 | 修复 |
|---|---|---|
| BUG-RP-04 | `system.rs`、设置页 | 将来源改为 `system`、`managed`、`custom` 明确枚举 |
| BUG-RP-05 | `node_runtime.rs`、`git_runtime.rs`、`storage.rs`、`managed_runtime.rs` | 集中 Windows/macOS 托管能力判断 |

### 阶段 C — 聚合源和平台制品

| 问题 | 文件 | 修复 |
|---|---|---|
| BUG-RP-02 | `node_runtime.rs`、`setup.rs` | 用单一平台模型生成索引键、文件名、格式和顶层目录 |
| BUG-RP-03 | `node_runtime.rs`、`git_runtime.rs`、`managed_runtime.rs`、`setup.rs` | URL、日志和 UI 顺序从同一结构化源目录派生 |

### 阶段 D — 回归与清理

- 每个 BUG 增加对应测试。
- 清理旧 `local` 来源、重复源列表、重复平台映射和重复能力表达。
- 执行 Rust、TypeScript、前端脚本、生产构建和差异检查。
