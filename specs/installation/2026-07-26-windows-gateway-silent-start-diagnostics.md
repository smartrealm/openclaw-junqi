# Windows Gateway Silent Start Diagnostics Spec

## BUG-WGS-01 · 无法判断静默 Gateway child 卡在哪里

**Current**：spawn 成功后只监听行输出、进程退出、端口和最终 timeout。无输出且不绑定端口时没有活动证据。

**Target**：记录有限、脱敏、可导出的启动诊断快照。

**Acceptance**：
- [ ] spawn 前记录 node/package/entry/state/config/cwd 的存在性与文件 metadata，不记录文件内容。
- [ ] 记录参数名和值是否为公开值；不记录 token 和 env value。
- [ ] Windows 上按 PID 采样 CPU、内存、累计磁盘读取/写入字节。
- [ ] 每个 heartbeat 记录 output/bound-port/port-available/process snapshot。
- [ ] timeout cleanup 前后都记录快照和清理结果。
- [ ] 进程采样失败不影响 Gateway 启动，只在诊断中明确 unavailable。
- [ ] 现有 120 秒 first-output 判断不因本变更延长。
