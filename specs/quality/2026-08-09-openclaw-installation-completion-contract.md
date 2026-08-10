# OpenClaw 安装完成契约规格

日期：2026-08-09

## 目标

首次启动只依据 Gateway 官方结构化检测和官方 Wizard 终态判断配置阶段是否完成。JunQi 不自行解析模型字段替代 `setupComplete`，也不在官方向导终态后增加强制实时模型验证。

## 行为契约

1. 配置核验先确认所选 Gateway 可达，再请求 `openclaw.setup.detect`。
2. 响应包含布尔 `setupComplete` 时按其结构化结果处理；畸形响应或请求失败保留真实错误，不伪报完成。方法明确不受支持时启动同一 Gateway 的官方 Wizard，不从本地状态推断完成。
3. `setupComplete=false` 时进入官方 Wizard；`setupComplete=true` 时允许进入 Ready。
4. Wizard 终态后的服务交接必须继续核验当前运行方式、经认证连接和所选 Gateway。
5. Wizard 终态后不得再次调用 `openclaw.setup.verify` 阻断用户已经在官方流程中作出的跳过或继续选择。
6. Ready 到 Dashboard 的最终交接重复执行 Gateway 与 `setupComplete` 核验，不执行模型实时验证。
7. 模型实时验证仍可由模型配置或业务引导的明确操作调用，但其结果不改写首次安装终态。
8. 恢复未完成官方 Wizard 时只能以同一 sessionId 调用无答案的 `wizard.next`；不得调用会清理会话的
   `wizard.status`，也不得重放之前的答案。

## 验收条件

- 官方向导完成后，即使模型测试被跳过，也不会出现“默认模型尚未通过实时验证”并返回配置页。
- 已连接 Gateway 返回 `setupComplete=false` 时必定进入官方 Wizard。
- 已连接 Gateway 返回 `setupComplete=true` 时不启动 Wizard。
- `openclaw.setup.detect` 畸形、失败或连接切换时，流程显示真实失败，不进入 Ready。
- Gateway 明确返回方法不存在时，不从本地配置、模型字段或完成标记回退推断 `setupComplete`，而是进入同一 Gateway 的官方 Wizard。
- 渲染进程重启后的官方 Wizard 恢复不调用 `wizard.status`，并能在 Gateway 返回下一步骤或终态时正确收敛。
- 旧的安装完成验证类型、分支、文案和专属测试全部删除。
