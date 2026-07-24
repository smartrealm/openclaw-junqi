# Windows First Run Bugfix Spec

## BUG-WFR-01 · Privileged pairing continuation

**Target**：`PAIRING_REQUIRED` 后每 5 秒重新建立 admin transient 连接，批准成功后继续原 RPC；5 分钟超时或用户取消后终止。

**Acceptance**：
- [x] 原管理 RPC 在批准前不发送，批准后只发送一次。
- [x] admin 握手成功事件关闭配对界面；取消会停止当前配对重试。
- [x] 非配对授权错误仍立即失败。

## BUG-WFR-02 · Wizard reconnect gate

**Target**：`wizard.next` 与 `wizard.back` 和 start/resume/retry 使用同一已验证连接门禁。

**Acceptance**：
- [x] Gateway 进程内重启期间不会本地提交管理 RPC。
- [x] 连接恢复后继续当前操作，超时后保留可重试错误。

## BUG-WFR-03 · Wizard error action

**Target**：错误位于向导内容顶部，主动作明确变为“重试”。

**Acceptance**：
- [x] 长页面无需滚到底即可看到错误。
- [x] 错误状态不会把主动作标为“下一步”。

## BUG-WFR-04 · Windows service timeout

**Target**：Windows 服务命令预算为 60 秒，其他平台保持 30 秒。

**Acceptance**：
- [x] 31 秒的正常 Windows 状态检查不会被桌面端提前清理。
- [x] 超时仍使用受控进程树清理并 fail closed。

## BUG-WFR-05 · Recovery classification

**Target**：仅当服务命令超时且清理已确认时建议 Retry；清理未确认不得降级。

**Acceptance**：
- [x] 已清理超时不启动 `openclaw update repair`。
- [x] 插件/载荷损坏仍建议 Repair。

## BUG-WFR-06 · npm progress and log density

**Target**：以 fetch、install/lifecycle、package summary 三类真实输出推进单调进度；HTTP 请求聚合到单一可替换 UI 行。

**Acceptance**：
- [x] npm 活动不再全程固定在 42%。
- [x] 每条 HTTP fetch 仍在原始进程日志中，但不逐条进入 UI。
- [x] 聚合摘要不包含 registry 凭据或完整 URL。
