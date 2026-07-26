# Windows Gateway 静默启动诊断计划

1. 在 `gateway.rs` 增加跨平台安全文件 metadata 与 Windows PID 活动采样 helper。
2. spawn 前记录公开 launch argv、文件存在性、大小和修改时间。
3. heartbeat 记录 output/port/process activity 快照。
4. timeout 清理前后记录快照与端口释放结果。
5. 增加 Rust 单测与 source-contract 回归，执行完整 Rust/前端测试。
6. 构建 Windows 包后由用户复现并导出 setup diagnostics，再依据 CPU/I/O/config/port 证据定位根因。
