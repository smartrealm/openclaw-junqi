# 项目交接状态

更新时间：2026-08-07

## 当前目标

收敛 OpenClaw 首次配置完成后的 Gateway 服务交接与模型实时验证门禁。JunQi 必须保留 OpenClaw 的真实
完成语义：Gateway 已恢复连接不等于默认模型已验证；当前 Gateway 不支持官方验证方法也不等于模型或凭据失效。

## 已完成内容

- 已核对当前 OpenClaw 官方源码中的 `openclaw.setup.verify` 与 `models.probe` handler，以及 JunQi 的
  `wizard.start`、`wizard.next`、`wizard.status`、`wizard.cancel` 调用链。
- 已复现本机选定 Gateway 在认证连接正常时对上述两个实时验证方法返回 `INVALID_REQUEST: unknown method`。
  验证客户端已严格识别该已知方法不存在形态，因此当前运行时缺少官方验证能力，不能作为模型或凭据失败处理。
- 已复现官方 Wizard 完成后的服务交接在本机约需 85 秒恢复 JunQi 的认证连接；此前统一 20 秒等待会过早超时。
- 完成门禁已由布尔结果改为三种结构化状态：`verified`、`failed`、`unavailable`。
- 官方验证能力不可用时，首次配置和工作台入口均显示独立错误语义，不再跳转到 Wizard 并自动重跑。
- 官方服务交接与来源变化恢复路径使用 120 秒有界认证连接等待；初始连接和普通 Wizard 操作仍维持 20 秒。
- 已更新首次启动流程预览、全链路审计、规格和计划，记录当前运行时与官方源码的能力差异及验证边界。

## 关键技术决策

- `openclaw.setup.verify` 是模型实时验证的唯一完成门禁。不得以 Gateway 健康、静态模型引用、`models.probe`
  或本地推断作为替代成功条件。
- “官方方法不可用”与“官方方法已执行但模型验证失败”必须分开建模和呈现。前者提示升级或切换支持该方法的
  Gateway，后者才提示修正模型或凭据。
- Gateway 交接等待只扩展在官方服务 handoff 路径，使用有限上限；不得把普通 RPC 等待改成全局长等待或无限重试。
- 已完成的官方 Wizard 不得因为验证或交接失败被自动重放。JunQi 只能保留待核验状态并等待用户修正官方运行时。

## 核心文件

- `src/services/setup/setupCompletionGate.ts`：完成门禁的结构化验证结果和失败原因。
- `src/hooks/useSetupFlow/index.ts`：将官方验证客户端结果映射到完成门禁，并在 Gateway 就绪页和工作台入口保留
  不可用与失败的不同语义。
- `src/hooks/useSetupFlow/useWizardSession.ts`：官方服务交接后的有界认证重连，以及 Wizard 终态验证分支。
- `src/services/gateway/OpenClawSetupVerificationClient.ts`：官方 `openclaw.setup.verify` RPC 的严格响应解析与
  不可用错误类型。
- `src/services/setup/setupCompletionGate.test.ts` 与 `src/hooks/setupOnboardingRegression.test.ts`：结构化结果与
  handoff 路径回归覆盖。
- `docs/quality/openclaw-full-alignment-audit-2026-08-07.md`、
  `specs/quality/2026-08-07-openclaw-full-alignment.md`、
  `plans/quality/2026-08-07-openclaw-full-alignment.md`、
  `docs/previews/junqi-first-run-flow.html`：本轮依据、目标与可视流程记录。

## 测试与验证

- 已通过：`pnpm exec tsc --noEmit`。
- 已通过：
  `node --import ./test-setup.ts --import tsx --test src/services/setup/setupCompletionGate.test.ts src/services/gateway/OpenClawSetupVerificationClient.test.ts src/hooks/setupOnboardingRegression.test.ts`，共 58 个测试。
- 已通过：`git diff --check`。
- 已执行本机 Gateway CLI 复现：服务状态可用；`openclaw.setup.verify` 和 `models.probe` 均返回未知方法。
- 已通过：`pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check`。全量测试包含既有第三方 SSR
  `useLayoutEffect` 警告，但命令成功结束。
- 已完成本机 macOS `.app` 构建：
  `src-tauri/target/release/bundle/macos/JunQi Desktop.app`。产物版本为 `2.2.10`，可执行文件为
  `Contents/MacOS/junqi-desktop`。
- 尚未执行本轮桌面安装包真机回归。

## 已知问题

- 当前本机 Gateway 尚不支持官方实时验证方法，因此 JunQi 会正确阻止进入工作台，直到运行时提供该官方能力。
- 120 秒 handoff 等待来自本机一次可复现观察；macOS、Windows、Ubuntu、CentOS 和 Docker 运行时仍需真机验证。
- 本机构建未进行正式代码签名或公证，不能作为正式发布制品。
- 本轮变更已提交为 `1f1b36f0`；截至本文档更新时工作区干净。

## 已放弃方案

- 不再将 `openclaw.setup.verify` 的不可用异常吞掉并转换为 `false`。该做法会把能力缺失错误呈现为模型或凭据错误。
- 不使用 `models.probe` 作为 `openclaw.setup.verify` 的 fallback。两者在官方协议中的用途不同，且当前运行时同样不支持。
- 不把所有 Gateway 连接等待统一拉长。这样会把普通连接故障隐藏为长时间无反馈。
- 不在验证失败后自动新建或重跑 Wizard 会话。已完成的官方配置不能由客户端推断为需要重放。

## 下一步顺序

1. 在桌面安装包中完成首次配置，确认服务交接后可在 120 秒内恢复认证连接，且不会出现重复 Wizard。
2. 在支持 `openclaw.setup.verify` 的官方 Gateway 上验证 `verified`、`failed` 和 `unavailable` 三种结果的 UI 路径。
3. 在 macOS、Windows、Ubuntu、CentOS 以及 Native/Docker 的真实环境记录交接时间与行为差异；未经实测不得扩展为跨平台承诺。
4. 后续行为变更结束、暂停或交接前，按 `AGENTS.md` 更新本文件并重新执行与改动范围相符的验证。
