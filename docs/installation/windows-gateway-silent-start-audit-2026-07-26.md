# Windows Gateway 静默启动失败审计（2026-07-26）

## 现场证据

- OpenClaw npm 安装成功并通过版本验证。
- Gateway service ownership 检查耗时约 50 秒。
- managed Gateway child 成功 spawn，但 122 秒内：
  - stdout/stderr 无任何可见行；
  - 18789 未绑定；
  - 最终被 JunQi 按启动策略终止。

因此故障位于“已验证 OpenClaw runtime → `gateway run` 子进程启动后”之间，不是下载或 npm 安装失败。

## 当前证据缺口

现有日志只有 launch contract 和最终超时分类，缺少：

- 精确、可复制且无 secret 的 argv 结构；
- child PID、进程是否仍存活、CPU/读写字节变化；
- state/config/cwd 是否在启动瞬间仍存在；
- config 文件 metadata/hash（不能记录内容）；
- 每次等待阶段的端口、child output 和进程活动快照；
- 终止前后进程与端口状态。

“无输出”不能区分 Node 卡在模块加载、Defender 扫描、配置读取阻塞、stdio 管道问题或 OpenClaw 内部死锁。

## 修复目标

本轮不猜测根因，不延长等待时间。为下一次 Windows 实机复现增加 bounded、redacted 的 Gateway 启动诊断：

1. spawn 前记录参数形状与文件 metadata；
2. spawn 后记录 PID；
3. 每 15 秒采样 child CPU、累计读写字节、内存、端口和 output 状态；
4. 只在活动变化或固定心跳时写入诊断 timeline；
5. 超时终止前、终止后各记录一次快照；
6. 不记录 token、环境变量值或 config 内容。
