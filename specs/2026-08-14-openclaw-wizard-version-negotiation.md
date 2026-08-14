# OpenClaw Wizard 版本协商规格

日期：2026-08-14

## WIZ-COMPAT-01 · setup 启动参数协商

当前：JunQi 始终发送 `installDaemon:false`，stable 在 schema 校验阶段拒绝后终止整个配置流程。

目标：

1. setup Wizard 首次请求保留主线 `installDaemon:false`。
2. 只有 `GatewayRpcError.code` 为 `INVALID_REQUEST`，且消息精确为 `invalid wizard.start params: at root: unexpected property 'installDaemon'` 时，才在同一 `start` 操作中省略该字段重试一次。
3. 重试前再次检查操作代次；已经被页面切换或新操作取代时不得发送第二次请求。
4. 第二次请求的响应必须经过与主线响应相同的严格解析和会话持久化。
5. `flow:'channels'` 不参与该协商。

验收：

- 主线成功时只有一次 `wizard.start`。
- stable 精确拒绝时恰好两次 `wizard.start`，第二次只包含公共字段。
- workspace 在第二次请求中保持规范化值。
- 其他 schema、权限、连接和业务错误没有第二次请求。

## WIZ-COMPAT-02 · 删除永久不兼容投影

当前：精确字段拒绝进入 `protocol-incompatible` 恢复模式，隐藏主操作并显示永久阻断文案。

目标：字段拒绝由客户端协议适配层内部消费；状态机只接收协商后的成功结果或真实最终失败。

验收：

- `WizardRecoveryMode` 不再包含 `protocol-incompatible`。
- 首次设置页面不再有该模式的专属按钮和文案分支。
- `wizardFailureDestination` 只处理仍有真实消费者的恢复模式。

## WIZ-COMPAT-03 · daemon 所有权语义

当前：文档无条件声称 Classic Wizard 已通过 `installDaemon:false` 关闭 daemon 分支。

目标：主线支持参数时由 JunQi 显式关闭；stable 公共参数模式下由官方 Wizard 完整呈现 daemon 选择，JunQi 不改写答案或伪报关闭。

验收：相关审计、安装流程、规格、预览和项目状态使用同一描述，不再要求用户等待 stable 更新才能运行 Classic Wizard。
