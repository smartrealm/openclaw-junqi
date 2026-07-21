# 安装诊断链路审计

## 🔴 BUG-INSTALL-LOG-01 · 实时控制台过早丢失日志

**位置**：`src/stores/app-store.ts`、`src/components/setup/SetupFlowPanels.tsx`

内存只保留 220 条，界面和复制操作只使用最后 100 条。OpenClaw 的 npm 依赖安装通常会产生数百条网络记录，真正的首个慢请求会在安装结束前被淘汰。

**修复**：控制台保留完整的有界诊断窗口，渲染窗口与复制范围解耦，并标识诊断行。

## 🟡 BUG-INSTALL-LOG-02 · 磁盘日志缺少一次安装的统一时间线

**位置**：`src-tauri/src/commands/setup_progress.rs`、`src-tauri/src/commands/setup.rs`

Node、Git、OpenClaw 分别写文件，无法按时间还原完整安装；OpenClaw 新安装开始时没有重置自己的步骤日志。

**修复**：在保留步骤日志的同时写入滚动的 `setup-session.log`，并在 OpenClaw 安装锁内重置步骤日志。

## 🟡 BUG-INSTALL-LOG-03 · 网络慢只能看到结果，缺少统计

**位置**：`src-tauri/src/commands/setup.rs`

下载日志没有响应头耗时、平均速度；npm 只逐行转发，没有请求数、缓存命中、平均耗时和最慢请求汇总。

**修复**：记录连接/响应、实时吞吐、总耗时，并对 npm fetch 行生成脱敏汇总。

## 🟡 BUG-INSTALL-LOG-04 · 用户无法直接取得完整持久化日志

**位置**：`src-tauri/src/commands/setup_progress.rs`、`src/components/setup/SetupFlowPanels.tsx`

控制台只能复制已保留的内存日志，没有打开磁盘诊断目录的入口。

**修复**：增加只返回 JunQi 诊断目录的 Tauri 命令，并在安装控制台提供打开目录按钮。

## 🟡 BUG-INSTALL-LOG-05 · Gateway 启动日志只存在于内存

**位置**：`src-tauri/src/commands/gateway.rs`

安装最后阶段的 Gateway 输出只发送给当前窗口，应用退出后无法与依赖安装日志一起复盘。

**修复**：Gateway 日志统一经过脱敏记录器，同时进入界面、内存状态和安装会话时间线。
