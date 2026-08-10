# Gateway 生命周期统一实施计划

日期：2026-08-10

- [x] 审计页面、组件、设置、首次启动、官方 Wizard、协作事务及 Tauri IPC 的 Gateway 生命周期调用图。
- [x] 将新 connection ID、官方握手和 Runtime Identity 收敛加入全局生命周期完成条件。
- [x] 将冷启动恢复、命令面板、聊天断线恢复和设置停止入口接入全局协调器。
- [x] 删除钉钉专属重连轮询、旧浏览器命令兼容桥、日志文本进度推断及其专属测试。
- [x] 增加 AST 边界扫描，限制低层 Gateway IPC 与 manager 生命周期方法的调用范围。
- [x] 补齐简体中文、繁体中文和英文生命周期进度文案。
- [x] 执行完整 TypeScript、Rust、构建与文档验证。
- [ ] 在真实 macOS Native、Docker、Windows 与 Linux 环境验证重启后新连接、停止和身份收敛。
