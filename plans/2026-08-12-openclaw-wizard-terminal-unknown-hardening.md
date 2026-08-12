# OpenClaw Wizard 终态未知加固计划

## 执行顺序

### 阶段 A：协议错误

| 缺陷 | 文件 | 修复 |
| --- | --- | --- |
| BUG-WIZ-04 | `src/services/gateway/OpenClawSetupClient.ts` | 删除 OpenClaw 未注册的 `openclaw.setup.detect` 与 `openclaw.setup.verify` 客户端。 |
| BUG-WIZ-05 | `src/services/setup/setupCompletionGate.ts` | 完成门禁只消费当前流程已经取得的官方 Wizard 终态，不再调用推测性检测。 |

### 阶段 B：终态竞态

| 缺陷 | 文件 | 修复 |
| --- | --- | --- |
| BUG-WIZ-06 | `src/hooks/useSetupFlow/useWizardSession.ts` | 会话丢失后保留“终态未知”，禁止自动完成和自动重放。 |
| BUG-WIZ-07 | `src/pages/SetupPage/WizardScreen.tsx` | 用明确风险文案和可取消的二次确认呈现终态未知，不再声称官方要求继续配置。 |

### 阶段 C：派生消费者

| 缺陷 | 文件 | 修复 |
| --- | --- | --- |
| BUG-WIZ-08 | `src/hooks/useBusinessGuideActivation.ts` | 业务引导只依赖真实的本地完成标记、认证连接和运行时身份，不再调用伪配置检测。 |

### 阶段 D：验证与文档

1. 先增加终态未知和禁止伪 RPC 的失败回归测试。
2. 更新首次启动、Wizard 审计和 HTML 流程预览。
3. 执行定向测试、静态检查、完整测试、构建和差异检查。

## 验收顺序

1. `WIZARD_NOT_FOUND` 不产生完成事实，也不自动调用 `wizard.start`。
2. 页面不再出现“官方检测仍要求继续配置”。
3. 可执行代码和测试中不存在两个伪 RPC；审计文档只把名称作为已删除问题记录。
4. 官方 `done` 后仍执行统一 Gateway 交接和身份核验。
5. 最新 OpenClaw 的会话准入修复与旧运行时未验证边界记录清楚。
