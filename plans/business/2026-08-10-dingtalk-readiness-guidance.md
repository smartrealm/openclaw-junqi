# 钉钉接入状态与授权引导实施计划

日期：2026-08-10

## 实施顺序

- [x] 核对 DWS Native 与无界面授权命令契约。
- [x] 核对 OpenClaw Agent 工具策略、插件配置和 `config.patch` 契约。
- [x] 增加插件状态加载门禁，删除空状态的提前判断。
- [x] 增加新 Gateway 连接与 Runtime Identity 一致性等待，再自动刷新钉钉状态。
- [x] 将 Native 授权切换到浏览器扫码流程，保留 Docker 设备码流程。
- [x] 增加当前 Agent 双层授权的单一工作台入口和失败关闭边界。
- [x] 增加 Agent 配置、重连和 readiness 回归测试。
- [x] 完成全量 TypeScript、Rust、插件、构建和差异校验。
- [ ] 在真实 Native Gateway 与钉钉租户完成扫码、重启和 Profile 自动刷新验收。
