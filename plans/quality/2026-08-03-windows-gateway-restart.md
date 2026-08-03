# Windows Gateway 重启加固计划

## 目标

让 Windows Scheduled Task 重启只在官方服务命令、选定端点和服务运行态三者一致时
报告成功，避免任务停止、旧进程占端口或旧 runtime 被误判为已重启。

## 实施

- [x] 对已停止且明确核验过身份的 Windows Scheduled Task 使用 `schtasks /Run`，避免
  OpenClaw Windows `gateway start` 复用 `/End` 后对停止任务直接失败；无任务时保留官方
  登录项回退。
- [x] 对 Windows `runtime.status=unknown` 或任务注册不可验证的情况失败关闭。
- [x] 将官方 CLI 等待上限对齐 OpenClaw Windows 健康检查预算。
- [x] 端点就绪后重新读取官方服务身份与运行态，并要求当前 runtime 的 selected 状态。
- [x] 为上述顺序添加 Rust 与 TypeScript 回归测试。
- [x] 记录官方依据、自动化验证和未完成的 Windows 真机边界。

## 范围外

不改变 Native/Docker 选择、Gateway token、Scheduled Task 配置、OpenClaw 官方服务
安装方式或 Windows 之外的平台生命周期语义。
