# Windows OpenClaw 运行时迁移审查

## BUG-WRM-01 · 中等 · 数据迁移锁死 Node.js 和 Git 新路径

**位置**：`src/components/setup/StorageSetupGate.tsx`、`src-tauri/src/commands/storage.rs`

迁移现有 OpenClaw 数据时，界面和后端都要求 Node.js、Git、npm 缓存保持原位置，无法完成“保留数据并重新安排依赖目录”的用户目标。

**修复**：迁移只固定 OpenClaw 状态、工作区和内部运行时的相对布局；独立的 Node.js、Git、npm 缓存与 npm prefix 允许重新选择，并继续执行绝对路径和目录隔离校验。

## BUG-WRM-02 · 严重 · 新 npm prefix 不会迁移 OpenClaw

**位置**：`src-tauri/src/commands/storage.rs`、`src-tauri/src/commands/setup.rs`、`src-tauri/src/commands/system.rs`

迁移时可以保存新 npm prefix，但全局 OpenClaw 包不会移动；已保存的旧二进制绝对路径仍优先，普通安装又会因为检测到旧包而跳过。

**修复**：prefix 变化后持久化“待迁移”状态，原生安装流程必须把 OpenClaw 安装到新 prefix，验证并保存新二进制后才能清除状态。

## BUG-WRM-03 · 中等 · 迁移中断后缺少续跑契约

**位置**：`src-tauri/src/paths.rs`、`src/hooks/useSetupFlow.ts`

只在前端内存记录迁移意图时，退出应用会丢失状态，下一次启动可能继续使用旧 OpenClaw。

**修复**：待迁移状态写入存储 bootstrap；启动检测与安装流程都读取该状态，成功前保持可续跑。

## BUG-WRM-04 · 严重 · 不可访问的旧 Gateway 可能绕过停止流程

**位置**：`src-tauri/src/commands/storage.rs`

同目录重新配置运行时位置时，旧 Gateway 只有在 HTTP 探测成功后才会被停止。仍有进程句柄但正在启动、卡死或健康检查失败的 Gateway 会继续使用旧 Node.js 和 OpenClaw 路径。

**修复**：只要原生运行时位置发生变化就执行统一停止与端口释放确认；HTTP 可达性只决定失败后的恢复策略，不再决定是否停止。

## BUG-WRM-05 · 严重 · 存储迁移与包迁移可以并发覆盖完成状态

**位置**：`src-tauri/src/commands/storage.rs`、`src-tauri/src/commands/setup.rs`、`src-tauri/src/paths.rs`

存储迁移和 OpenClaw 安装使用不同的互斥锁。安装到 prefix A 期间若保存 prefix B，A 完成后可能无条件清除 B 的待迁移标记。

**修复**：OpenClaw 安装加入 Gateway 全局操作锁，并以安装开始时的 prefix 选择作为完成条件；当前 bootstrap 已变化时拒绝清除待迁移标记。

## BUG-WRM-06 · 中等 · 便携 Node.js 缺少 npm 时无法自愈

**位置**：`src-tauri/src/commands/system.rs`、`src-tauri/src/commands/setup.rs`

自定义目录只要存在兼容的 `node.exe` 就被视为可用，即使配套 `npm-cli.js` 缺失。没有系统 npm 时安装流程会重复失败，有系统 npm 时则会混用两个运行时。

**修复**：显式便携 Node.js 必须与其 npm 成对检测；缺少 npm 时重新部署完整便携运行时，不再回退到系统 npm。

## BUG-WRM-07 · 中等 · 终端启动器更新前过早提交迁移完成

**位置**：`src-tauri/src/commands/setup.rs`、`src-tauri/src/commands/terminal_integration/mod.rs`

新 OpenClaw 验证成功后先清除待迁移标记，再写终端启动器。Windows 用户 PATH 或启动器写入失败时，旧启动器仍可能指向旧状态目录和旧二进制，但迁移已被标记为完成。

**修复**：使用已验证的新二进制同步或移除终端启动器，成功后再原子清除待迁移标记。

## BUG-WRM-08 · 低 · 路径身份与迁移提交规则分散

**位置**：`src-tauri/src/paths.rs`、`src-tauri/src/commands/storage.rs`、`src-tauri/src/commands/setup.rs`

Windows 路径等价判断分别实现了大小写、分隔符和 canonicalize 规则；迁移提交使用嵌套 `Option` 在安装函数内串联多个步骤。后续增加安装入口或路径类型时容易只更新其中一处。

**修复**：路径身份、可选路径身份和目录重叠统一由 `paths` 模块提供；OpenClaw 重定位使用显式请求对象捕获 prefix，并由单一提交方法完成物理校验、终端同步、二进制持久化和状态清除。
