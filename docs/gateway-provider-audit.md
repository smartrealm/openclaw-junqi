# Gateway 与供应方配置链路审计

日期：2026-07-10

## 严重问题

### BUG-01 · CRITICAL — 冷启动恢复跳过原生 Gateway 启动

**位置**：`src-tauri/src/commands/ensure.rs`

**问题**：端口不可达时，恢复编排只检查托管子进程，随后直接尝试 Docker，没有调用原生 `start_gateway`。

**影响**：未安装 Docker 或系统服务损坏时，桌面端永远无法从冷启动恢复。

**修复**：端口探测失败后先启动桌面托管的原生 Gateway，并等待端口健康；只有原生启动失败才进入 Docker 兜底。

### BUG-02 · CRITICAL — 系统服务损坏时重启没有回退路径

**位置**：`src-tauri/src/commands/gateway.rs`

**问题**：`openclaw gateway restart` 退出失败或健康检查超时时直接返回错误，没有启动桌面托管进程。

**影响**：LaunchAgent/systemd/schtasks 指向失效安装路径时，所有重启入口持续失败。

**修复**：服务重启失败或超时后释放重启互斥标记，回退到 `start_gateway`，并再次等待真实端口健康。

### BUG-03 · CRITICAL — 启动日志在三层之间丢失

**位置**：`src/api/tauri-adapter.ts`、`src/services/gateway/GatewayConnectionManager.ts`、`src/components/BootTimelineOverlay.tsx`

**问题**：Rust 环形日志存在，但适配器状态查询返回空日志；Manager 快照没有附加已收集日志；恢复面板在仅有日志时不显示。

**影响**：用户只能看到“正在连接”，没有进度、错误或诊断内容。

**修复**：查询并格式化 Rust 日志，累积事件日志并透传到状态快照；只要恢复正在执行或已有日志就显示恢复面板。

## 中等问题

### BUG-04 · MEDIUM — 供应方模型声明和启用模型集合不一致

**位置**：`src/pages/ConfigManager/runtimeNormalization.ts`

**问题**：保存时只规范化 `models.providers.*.models` 的已有行，没有把同供应方的 `agents.defaults.models` 缺失项补入供应方声明。

**影响**：供应方显式模型数组只包含部分模型时，其余已启用模型无法被 Gateway 正确解析。

**修复**：按规范化供应方 ID 合并两侧模型；保留供应方显式运行时字段，仅为缺失行补充 ID、名称和输入能力。

## 验证记录

- Syntax / build：`npm run build` 通过。
- Interface / cleanup：`git diff --check` 通过；新增源码未包含机器用户路径。
- Behavior：前端 295 项测试与 15 项边界测试通过。
- Rust：82 项通过，1 项既有集成测试忽略。
- Runtime：OpenClaw 服务重装、真实重启、端口监听和 RPC 管理员握手通过。
- Desktop：新 `.app` 启动后产生 `aegis` 的 agents、sessions、history、config RPC 请求。
- Package：ad-hoc 签名和 DMG 校验通过。
