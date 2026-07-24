# Windows Node 探测补充审计

## BUG-WFR-12 · MEDIUM — WFR-11 未覆盖默认系统 Node

**位置**：`src-tauri/src/commands/system.rs`、`src-tauri/src/commands/setup.rs`

**问题**：显式便携 Node 使用重试探测，默认系统 Node 却由 PATH 候选串行单次探测；安装后便携 Node 校验另用单次短超时。npm 对确定性错误也执行重试。

**影响**：Windows 冷扫描可能继续造成系统 Node 误判或便携 Node 安装回滚；旧 PATH 项可按候选数累加等待；损坏的 npm 会延迟报错。

**修复**：以 JunQi 配置目录或平台 PATH 作为唯一动态路径来源；统一探测失败分类，PATH 首探并发化，只重试超时，并以行为测试覆盖重试边界。
