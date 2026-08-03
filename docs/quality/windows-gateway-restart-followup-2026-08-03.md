# Windows Gateway 重启后续加固

日期：2026-08-03

## 依据

本机锁定的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。该版本的 Windows
Scheduled Task `restart` 流程会先结束任务、清理任务对应的 Gateway 进程和端口，
再执行任务启动。任务已停止时，直接执行 `/Run` 不包含清理阶段，可能留下旧进程、
端口占用或第二个启动竞争。

## 当前行为

JunQi 先通过官方 `gateway status --json --no-probe` 核对服务属于当前选定的
state/config/runtime。Windows 任务已停止或运行态无法从平台输出可靠解析时，确认任务
注册后调用官方 `gateway stop`，复用 OpenClaw 的任务结束、残留监听清理和端口释放契约，
再对同一任务执行 `schtasks /Run`。运行态明确为 running 时继续使用官方
`gateway restart`。

任务启动完成后仍必须同时满足：选定端点通过健康和凭据校验、官方服务再次确认属于当前
runtime 且状态为 running。仅端口可连接或 `/Run` 命令退出成功不会被报告为重启成功。

OpenClaw 的 `OPENCLAW_WINDOWS_TASK_NAME` 覆盖也会随 JunQi 的所有服务命令传递，并在
注册探测、启动和登录项检测中使用同一任务身份；默认任务的 profile 后缀仍按官方兼容
规则处理，覆盖值不再通过前缀匹配兄弟任务。

## 验证边界

- Rust 全量测试通过：709 项中 705 项通过、4 项忽略；其中
  `gateway_service` 相关测试覆盖任务名身份、停止/未知状态清理条件和服务归属门禁。
- Gateway TypeScript 回归门禁通过：59 项通过。
- 前端与脚本全量测试通过：前端 2373 项、脚本 234 项均通过；lint、模块边界、版本一致性、
  生产构建和 `git diff --check` 均通过。
- 当前开发机不是 Windows，尚未执行真实 Scheduled Task、UAC、杀毒软件、登录项和
  残留进程冷启动验收；这些仍需 Windows 真机验证。
