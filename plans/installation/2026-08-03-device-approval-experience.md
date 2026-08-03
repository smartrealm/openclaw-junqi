# 设备审批体验实施计划

## 执行顺序

### Phase A · 状态机收敛

1. 将 privileged pairing 的授权等待预算与单次 RPC 默认预算解耦。
2. 增加立即重试入口，用户确认批准成功后不等待固定轮询。
3. 在成功、失败、超时和取消时同步清理审批界面。

### Phase B · 应用内批准

1. 新增 Tauri command，通过当前选定 OpenClaw CLI target 执行准确 request ID 的官方批准命令。
2. 在审批对话框增加主要动作“确认并继续”，保留高级手工回退。
3. 自动批准期间提供 loading、成功、失败和 disabled 状态。

### Phase C · 相邻首次运行缺陷

1. Ready 页将后台偏好操作与主导航解耦，保留进入仪表盘的最终门禁。
2. 修复 Gateway request 裸函数调用导致的 receiver 丢失。
3. 渠道目录和 runtime status 增加独立首屏 loading、骨架和错误状态。
4. 为受审 DingTalk connector 暴露未安装时的 managed install 入口。

### Phase D · 回归与文档

1. 增加 privileged requester 的长期配对等待和立即重试行为测试。
2. 增加 Tauri command 注册、参数校验和前端 IPC 契约测试。
3. 同步首次运行流程预览及验证边界。

## 验证

- 定向 TypeScript 测试。
- Rust 格式、check 和相关库测试。
- TypeScript 类型检查与模块边界。
- `git diff --check`。
- Windows 真机复测：scope upgrade、确认批准、界面自动关闭、原 Wizard 动作只执行一次。
