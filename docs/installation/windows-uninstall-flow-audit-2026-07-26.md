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

### 🔴 BUG-WUF-01 · CRITICAL — Docker 模式卸载会留下可重启的 JunQi 容器

**位置**：`src-tauri/src/commands/uninstall.rs`、`src-tauri/src/commands/docker.rs`

Docker Gateway 由 JunQi 创建并带完整 ownership/state labels，同时使用 `--restart unless-stopped`。卸载 cleanup 只移除终端集成和 Native 官方服务，不检查或移除当前选中状态对应的 Docker 容器。

**影响**：
- 卸载桌面应用后 OpenClaw 仍可能继续运行；
- Docker daemon 重启后容器可能再次启动；
- 重装时旧容器继续占用稳定名称和 Gateway 端口。

**修复**：卸载 helper 在选中 Docker runtime 时，必须根据完整 JunQi ownership labels 与 selected state identity 验证容器归属，验证成功后 `docker rm -f`；foreign、无法验证或不同 state 的容器不得删除。

### 🔴 BUG-WUF-02 · CRITICAL — NSIS 忽略 cleanup 失败并继续删除唯一修复程序

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

## 真实 Windows 边界

代码回归不能替代真实 NSIS 验收。修复后仍需在 ARM64 Windows 上分别验证 Native 与 Docker：安装、开启/关闭自启动、卸载失败重试、成功卸载、重装和端口/任务/容器残留。
