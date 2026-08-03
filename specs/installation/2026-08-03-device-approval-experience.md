# 设备审批体验规格

## BUG-PAIR-01 · 批准后自动恢复

**Current**：默认管理请求预算可能早于配对等待预算结束；手工批准后审批界面可能继续显示等待。

**Target**：配对等待拥有完整授权预算，批准后立即重新探测；请求终止时清理审批状态。

**Acceptance**：

- [ ] 批准前原管理 RPC 不发送，批准后最多发送一次。
- [ ] 用户确认自动批准后立即触发授权重试，不等待下一次固定轮询。
- [ ] 成功连接、请求失败、超时和取消都会关闭或更新等待界面，不显示虚假的持续重试。

## BUG-PAIR-02 · 用户确认后由 JunQi 执行批准

**Current**：界面要求用户复制并执行 `openclaw devices approve <requestId>`。

**Target**：本机当前选定 runtime 可用时，JunQi 展示权限说明并让用户确认，确认后通过官方 OpenClaw CLI 批准准确 request ID；手工命令降为高级回退。

**Acceptance**：

- [ ] 自动批准前有明确用户确认，不静默提升权限。
- [ ] 后端只使用当前选定 Native 或 Docker runtime，不进行 runtime fallback。
- [ ] request ID 作为独立参数传递并经过 identifier 校验。
- [ ] 自动批准失败显示内联错误，且不报告成功。
- [ ] 远程 Gateway 或本机 CLI 不可用时仍可展开高级手工方式。

## BUG-PAIR-03 · Ready 页面允许立即进入

**Target**：Gateway 已验证 Ready 后，后台自启动偏好操作不得禁用“进入仪表盘”；最终进入动作仍保留身份、onboarding 和模型验证。

## BUG-PAIR-04 · Gateway requester receiver

**Target**：跨模块传递 Gateway request 时必须通过闭包保留连接 receiver，首批 sessions 和 agents 数据不得因 `this.ws` 丢失而失败。

## BUG-PAIR-05 · 渠道加载和 DingTalk 入口

**Target**：渠道目录和 runtime status 完成前显示 loading 与骨架；失败显示错误而非空目录；受审 DingTalk connector 在未安装时显示可安装入口，安装后以 OpenClaw runtime 返回的真实契约为准。
