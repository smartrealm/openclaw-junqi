# JunQi Desktop Windows 卸载流程复审

日期：2026-07-26

## 范围

```text
NSIS PREUNINSTALL
→ 非 GUI cleanup 子进程
→ 终端集成清理
→ Native 官方 Gateway 服务清理
→ Docker managed container 清理
→ cleanup 结果门禁
→ 安装目录删除
```

## 结论

首次安装、存储、Native/Docker 选择、Node/npm/Git/OpenClaw、Gateway、Ready 最终探测和完成标记已有较完整的事务及回归覆盖。本轮在卸载闭环发现两个相连缺口。

### [critical] BUG-WUF-01 · CRITICAL — Docker 模式卸载会留下可重启的 JunQi 容器

**位置**：`src-tauri/src/commands/uninstall.rs`、`src-tauri/src/commands/docker.rs`

Docker Gateway 由 JunQi 创建并带完整 ownership/state labels，同时使用 `--restart unless-stopped`。卸载 cleanup 只移除终端集成和 Native 官方服务，不检查或移除当前选中状态对应的 Docker 容器。

**影响**：
- 卸载桌面应用后 OpenClaw 仍可能继续运行；
- Docker daemon 重启后容器可能再次启动；
- 重装时旧容器继续占用稳定名称和 Gateway 端口。

**修复**：卸载 helper 在选中 Docker runtime 时，必须根据完整 JunQi ownership labels 与 selected state identity 验证容器归属，验证成功后 `docker rm -f`；foreign、无法验证或不同 state 的容器不得删除。

### [critical] BUG-WUF-02 · CRITICAL — NSIS 忽略 cleanup 失败并继续删除唯一修复程序

**位置**：`src-tauri/installer-hooks.nsh`

`ExecWait` 已捕获 cleanup 退出码，但没有判断 `$0`。cleanup 因 Docker daemon、Node/OpenClaw runtime 或服务状态检查失败而返回非零时，NSIS 仍继续删除安装目录。

**影响**：
- 已知清理失败会被静默吞掉；
- 应用二进制被删除后，用户无法直接重试同一 ownership-aware cleanup；
- 可留下 Scheduled Task、容器或 PATH 集成。

**修复**：任一 cleanup 二进制返回非零时显示明确错误并 `Abort` 卸载；成功时才允许 NSIS 继续。

## 修复状态

- BUG-WUF-01 已修复：Docker 卸载仅删除完整 ownership labels 与 selected state identity 同时匹配的容器；foreign、legacy 或不同 state 均保留。
- BUG-WUF-02 已修复：当前/旧二进制名称共享退出码门禁；cleanup 非零或二进制缺失都会显示错误并中止卸载。
- 自动验证：Rust 613 passed / 3 ignored；Windows/发布脚本 25 passed；卸载源契约 4 passed；TypeScript、模块边界、格式和 diff hygiene 均通过。

## 已验证主安装链

- 精准安装流程回归：124/124 通过；
- Rust 全量测试：612 通过，3 ignored，0 failed；
- Windows 架构/安装包脚本：21/21 通过；
- TypeScript 与模块边界检查通过。

## 2026-08-03 性能复审

用户反馈 Windows 卸载阶段长时间停留，表现为安装器像卡住一样。按仓库锁定的 OpenClaw `2026.7.1-2` 源码重新核对后，确认 Native 路径存在两个串行冗余点。

### BUG-WUF-03 · MEDIUM — 未安装 Gateway 服务时仍启动完整 Node/OpenClaw 探测

**位置**：`src-tauri/src/commands/uninstall.rs`

持久化 runtime 为 Native 时，cleanup 无条件解析 OpenClaw binary、探测兼容 Node，再执行 `openclaw gateway status --json --no-probe`。大多数未启用系统服务的用户不需要这些步骤。Windows PATH、npm prefix 或版本管理器候选较多时，探测预算会叠加，NSIS 又在 `ExecWait` 期间缺少阶段反馈，因此呈现为无响应。

**修复**：先使用既有只读 Windows Scheduled Task 与 Startup entry 探测。明确无服务 artifact 时立即完成；存在或无法验证时才进入完整 runtime 与 ownership 证明，不能因性能优化降低 foreign service 保护。

### BUG-WUF-04 · MEDIUM — 已证明归属后重复启动四次 OpenClaw CLI

**位置**：`src-tauri/src/commands/gateway_service.rs`

旧路径依次执行 status、stop、uninstall、status。锁定版本的官方 `gateway uninstall --json` 已通过 `runServiceUninstall` 在同一进程内执行 stop-before-uninstall，并在结束前检查 service 不再 loaded。JunQi 额外的独立 stop 和第二次 status 重复支付 Node/OpenClaw 启动及配置加载成本。

**修复**：首次 status 仍负责 JunQi selected state/config/runtime ownership 门禁；通过后调用一次官方 uninstall。保留 JunQi 的端口释放后置条件，避免官方 stop 失败被内部 best-effort 处理后留下监听进程；删除重复的独立 stop 与第二次 status。

### 自动验证

- `pnpm lint` 通过；
- `pnpm test` 通过：前端与源码契约 2302 项、脚本 237 项；
- `cargo fmt -- --check` 与 `cargo check --lib` 通过；
- 合并到主线后的 `GatewayServiceInspection` 新增 `runtime_known` 字段，三个卸载权限测试初始化器未同步，曾导致 Rust 测试无法编译；已补齐明确的已知 runtime 状态。
- `cargo test --lib` 通过：700 项通过、4 项环境依赖测试忽略；
- 新增卸载性能守护，证明无 artifact 快速返回，以及已安装服务只启动一次 ownership status 与一次官方 uninstall；
- `git diff --check` 与修改文件 Emoji 扫描通过。

上述结果证明代码契约、编译与自动化行为，不代表 Windows NSIS 真机耗时已经取得实测数据。

## 真实 Windows 边界

代码回归不能替代真实 NSIS 验收。修复后仍需在 x64 Windows 上分别记录 Native 无服务、Native 已运行服务和 Docker managed container 三条卸载耗时，并验证卸载失败重试、成功卸载、重装和端口/任务/容器残留。ARM64 Windows 仍属于未验证目标边界。
