# Windows Gateway 重启后续加固计划

## 实施

- [x] 对已停止或运行态未知的选定 Windows 任务复用官方 `gateway stop` 清理阶段。
- [x] 清理完成后只对已核验的 Scheduled Task 执行 `/Run`。
- [x] 统一 `OPENCLAW_WINDOWS_TASK_NAME` 的命令传递、注册探测和任务名匹配。
- [x] 保留端点健康、凭据和服务 runtime 的三重成功门禁。
- [x] 添加 Rust 和 TypeScript 回归覆盖，并记录 Windows 真机未验证边界。

## 范围外

不改变 OpenClaw 官方任务 XML、端口、token、Native/Docker 选择或 Windows 之外的服务
生命周期语义。
