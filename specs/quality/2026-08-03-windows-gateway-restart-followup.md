# Windows OpenClaw Gateway 重启后续规格

日期：2026-08-03

## 目标行为

1. Native Windows 重启必须绑定已核验的 OpenClaw state/config/runtime 和同一
   Scheduled Task。
2. 任务状态为 stopped 或 unknown 时，先调用官方 `gateway stop` 完成幂等结束、残留
   Gateway 进程清理和端口释放，再对已核验任务执行 `schtasks /Run`。
3. 任务状态明确为 running 时使用官方 `gateway restart`，不自行替换官方运行时逻辑。
4. 重启成功必须同时通过选定配置的健康/凭据检查和官方服务运行态、runtime 身份复核。
5. `OPENCLAW_WINDOWS_TASK_NAME` 在状态、停止和启动命令中保持一致；自定义任务名只做
   精确匹配，默认任务名允许官方 profile 后缀。

## 失败行为

- 服务归属、任务注册、任务状态或端点身份无法核验时，不启动未选定的任务，不切换到
  其他 runtime，也不把端口占用当作成功。
- 官方停止、任务启动、端点健康或服务复核任一阶段失败，返回失败并保留诊断上下文。

## 未验证边界

Windows Task Scheduler、权限提升、杀毒软件拦截、用户登录态和真实冷启动仍需 Windows
真机验证。
