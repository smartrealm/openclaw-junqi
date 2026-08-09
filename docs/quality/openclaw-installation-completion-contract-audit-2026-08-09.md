# OpenClaw 安装完成契约审计

日期：2026-08-09

官方源码基线：`openclaw/openclaw` 本地镜像提交 `3075acd549a5c76ad776cd8be5edff8ee6d47b55`，版本 `2026.8.1`。

## 当前问题

### BUG-INS-01：客户端重复强制实时模型验证

JunQi 在官方 `wizard.start` 会话返回终态后，再调用 `openclaw.setup.verify`。验证失败时，客户端把已经完成的官方向导重新判定为安装失败，并阻止进入工作台。

OpenClaw `src/wizard/setup.ts` 已在向导内部调用 `offerLiveModelVerification`。该步骤允许用户拒绝测试，也允许在可选测试失败后选择继续。Gateway 的 `wizard.start`、`wizard.next` 和终态结果拥有这段流程；JunQi 再增加强制门禁会覆盖官方选择。

严重程度：高。它会造成“官方配置已完成但 JunQi 仍要求重试”的循环。

### BUG-INS-02：客户端自行推断配置完成状态

JunQi 当前从配置文件中读取 `agents.defaults.model`，据此推断是否需要官方向导。最新版 OpenClaw 通过 `openclaw.setup.detect` 返回结构化 `setupComplete`，其服务端实现使用默认智能体和有效模型解析规则。客户端字段检查无法覆盖默认智能体模型覆盖等官方语义。

严重程度：高。它可能把已完成配置误判为未完成，也可能把不完整配置误判为可进入工作台。

## 官方契约

- `packages/gateway-protocol/src/schema/openclaw.ts` 定义空参数的 `openclaw.setup.detect`，响应包含布尔字段 `setupComplete`。
- `src/gateway/server-methods/system-agent.ts` 将 `openclaw.setup.detect` 作为只读结构化检测方法，将 `openclaw.setup.verify` 作为用户需要时重跑当前推理路由的实时验证方法。
- `src/wizard/setup.ts` 和 `src/wizard/setup.inference-verification.ts` 证明实时模型验证属于官方向导内部的用户决策，不是客户端追加的安装完成条件。
- `src/gateway/server-methods/wizard.ts` 证明 Gateway 返回的 `done` 或 `status: done` 是该官方向导会话的终态。

## 目标行为

1. Gateway 可达并完成认证后，JunQi 使用 `openclaw.setup.detect.setupComplete` 判断是否需要官方配置向导。
2. `setupComplete=false` 时进入官方 `wizard.start`；客户端不从配置字段推断替代结论。
3. 官方 Wizard 返回终态后，JunQi 只核验所选 Gateway 的连接、身份和服务交接，不再追加模型实时验证。
4. `openclaw.setup.verify` 保留给模型或业务就绪入口的实时验证，不参与首次安装完成判定。
5. Dashboard 入口重新核验 Gateway 与官方 `setupComplete`，但不重新运行模型测试。

## 未验证边界

- macOS Native 的真实官方向导、跳过模型测试和服务交接仍需使用本次代码生成的 Tauri 安装包验收。
- Windows、Ubuntu、CentOS 和 Docker 的服务归属、认证连接与首次启动仍需目标平台真机验证。
- 当前审计不修改 OpenClaw 官方 Wizard 的步骤、跳过项和配置写入行为。
