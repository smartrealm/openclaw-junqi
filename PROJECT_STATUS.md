# 项目交接状态

更新时间：2026-08-07

## 当前目标

收敛 OpenClaw 首次配置完成后的 Gateway 服务交接与模型实时验证状态，并收敛会话上下文工具栏。JunQi 必须保留 OpenClaw 的真实
完成语义：Gateway 已恢复连接不等于默认模型已验证；当前 Gateway 不支持官方验证方法也不等于模型或凭据失效，
且不能因此阻断已经完成的官方配置。

## 已完成内容

- 已核对当前 OpenClaw 官方源码中的 `openclaw.setup.verify` 与 `models.probe` handler，以及 JunQi 的
  `wizard.start`、`wizard.next`、`wizard.status`、`wizard.cancel` 调用链。
- 已复现本机选定 Gateway 在认证连接正常时对上述两个实时验证方法返回 `INVALID_REQUEST: unknown method`。
  验证客户端已严格识别该已知方法不存在形态，因此当前运行时缺少官方验证能力，不能作为模型或凭据失败处理。
- 已核对发布边界：本机 `openclaw` 与 npm `latest` 均为 `2026.7.1-2`；已查阅的官方源码主线包含上述
  handler，但该能力尚未进入当前稳定 npm 包。不能把主线源码能力描述为用户当前可直接升级获得的稳定功能。
- 已复现官方 Wizard 完成后的服务交接在本机约需 85 秒恢复 JunQi 的认证连接；此前统一 20 秒等待会过早超时。
- 完成门禁已由布尔结果改为三种结构化状态：`verified`、`failed`、`unavailable`。
- 官方验证能力不可用时，首次配置、Gateway 就绪页和工作台入口都保留“模型待核验”警告并继续；只有官方方法
  返回明确失败时才阻断进入。
- 官方服务交接与来源变化恢复路径使用 120 秒有界认证连接等待；初始连接和普通 Wizard 操作仍维持 20 秒。
- 已更新首次启动流程预览、全链路审计、规格和计划，记录当前运行时与官方源码的能力差异及验证边界。
- 已清理会话上下文栏中的旧制品下载器、全局技能计数、全局工具配置和全局活动入口；这些入口不属于当前会话操作。
- 保留会话伴侣、当前会话实际工具、浏览器控制、分支、检查点、制品、差异和会话文件，并将差异图标改为 `FileDiff`，
  与分支图标区分。保留项均已有对应组件和 OpenClaw/工作台业务消费者。
- 已解除会话标签对规范主会话的关闭限制：`ChatTabs` 为所有已打开标签提供关闭按钮和中键关闭，`chatStore.closeTab`
  只更新本地标签投影；`removeSession` 仍独立禁止删除规范主会话。
- 已收敛会话助手头像的视觉层次：`AssistantResponseAvatar` 移除高饱和主色渐变，改用 `aegis-elevated`、`aegis-border`
  和低透明度主色内层强调；身份标记、字母或官方名称对应图标保持不变，回复头像与输入中指示器继续复用同一实现。

## 关键技术决策

- `openclaw.setup.verify` 可用时是模型实时验证的唯一证据。不得以 Gateway 健康、静态模型引用、`models.probe`
  或本地推断替代成功条件。
- “官方方法不可用”与“官方方法已执行但模型验证失败”必须分开建模和呈现。前者是待核验状态，不能伪报模型成功，
  也不能把当前稳定版不存在的能力当作安装阻断；后者才提示修正模型或凭据并阻断进入。
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
- `src/components/Chat/SessionContextBar.tsx`、`src/components/Chat/SessionDiffControl.tsx`：会话上下文栏入口收敛与
  差异图标语义修正。
- `src/components/Chat/ChatTabs.tsx`、`src/stores/chatStore.ts`、`src/stores/chatStore.test.ts`：标签关闭与会话删除边界，
  以及规范主会话标签关闭回归。
- `src/components/Chat/MessageBubble.tsx`：会话助手头像的主题表面和前景层次。
- `docs/quality/openclaw-agent-identity-projection-2026-08-04.md`：OpenClaw 身份投影及头像视觉边界。
- `docs/junqi-session-features.md`、`docs/openclaw-features.md`：合并的历史会话能力分析与待核验边界。
- `docs/quality/openclaw-full-alignment-audit-2026-08-07.md`、
  `specs/quality/2026-08-07-openclaw-full-alignment.md`、
  `plans/quality/2026-08-07-openclaw-full-alignment.md`、
  `docs/previews/junqi-first-run-flow.html`：本轮依据、目标与可视流程记录。

## 测试与验证

- 已通过：
  `node --import ./test-setup.ts --import tsx --test src/services/setup/setupCompletionGate.test.ts src/services/gateway/OpenClawSetupVerificationClient.test.ts src/hooks/setupOnboardingRegression.test.ts`，共 58 个测试。
- 已通过：`pnpm lint`、完整 `pnpm test` 和 `git diff --check`。全量测试包含既有第三方 SSR `useLayoutEffect`
  警告，但命令成功结束。测试中发现 `WizardScreen` 已移除硬编码色值而主题守护仍期望 2 个；守护已按
  当前语义令牌实现校正为 0。
- 已执行本机 Gateway CLI 复现：服务状态可用；`openclaw.setup.verify` 和 `models.probe` 均返回未知方法。
- 已通过：`pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check`。全量测试包含既有第三方 SSR
  `useLayoutEffect` 警告，但命令成功结束。
- 已完成本机 macOS `.app` 构建：
  `src-tauri/target/release/bundle/macos/JunQi Desktop.app`。产物版本为 `2.2.10`，可执行文件为
  `Contents/MacOS/junqi-desktop`。
- 已完成本机 macOS DMG 安装器构建并通过 `hdiutil imageinfo` 校验为只读 UDZO 镜像：
  `src-tauri/target/release/bundle/dmg/JunQi Desktop_2.2.10_aarch64.dmg`。镜像已挂载并打开，待人工安装验收。
- 尚未执行本轮桌面安装包真机回归。
- 本轮主会话标签关闭回归已通过：`node --import ./test-setup.ts --import tsx --test src/stores/chatStore.test.ts`，共 53 个测试。
- 本轮最新 `pnpm lint`、完整 `pnpm test`（前端 2806 项、脚本 243 项）和 `pnpm build` 均通过；完整测试仍有既有第三方
  SSR `useLayoutEffect` 警告，但命令成功结束。
- 此前已在本机 macOS ARM64 上执行 `pnpm tauri build --bundles app --no-sign`，并将会话工具栏调整对应的
  `JunQi Desktop.app` 安装到 `/Applications/JunQi Desktop.app`；版本为 `2.2.10`，安装后二进制与构建产物 SHA-256 一致。
- 本轮助手头像视觉调整尚未重新构建或安装桌面 `.app`；当前安装包不包含本轮已提交的头像样式改动。
- 已完成会话助手头像视觉调整；本轮聊天相关测试、`pnpm lint`、完整 `pnpm test` 和 `pnpm build` 均通过，亮暗主题与窄窗口的最终视觉验收仍待完成。
- 已审查并合并 `Blues-Code/code` 分支的 `7f0d208c`；合并提交为 `fa094888`。该分支只新增两份会话能力分析文档，未引入
  源码、配置、OpenClaw RPC 或运行时行为；文档已标明基于旧快照的证据边界，不作为当前功能契约。

## 已知问题

- 当前本机 Gateway 尚不支持官方实时验证方法。JunQi 进入工作台时会如实记录模型待核验；不把它显示为凭据失败。
- 当前稳定 `latest` 仍不提供该方法，因此不得提示用户通过升级当前稳定版解决；支持该 RPC 的未来官方 Gateway
  需要再补充真实验证。
- 合并的 `docs/junqi-session-features.md` 和 `docs/openclaw-features.md` 是历史分析与待核验线索；其中数量、能力和入口
  清单不得替代最新版 OpenClaw 官方文档、源码或当前 JunQi 实现。
- 120 秒 handoff 等待来自本机一次可复现观察；macOS、Windows、Ubuntu、CentOS 和 Docker 运行时仍需真机验证。
- 本机构建与本轮验证未进行正式代码签名或公证，不能作为正式发布制品；本机已安装的旧版 `.app` 仅用于此前本地验收。
- 本轮头像与文档改动已提交；桌面安装包中的工具栏密度、图标语义、键盘焦点和窄窗口表现尚未完成真机验收。

## 已放弃方案

- 不再将 `openclaw.setup.verify` 的不可用异常吞掉并转换为 `false`。该做法会把能力缺失错误呈现为模型或凭据错误。
- 不使用 `models.probe` 作为 `openclaw.setup.verify` 的 fallback。两者在官方协议中的用途不同，且当前运行时同样不支持。
- 不把所有 Gateway 连接等待统一拉长。这样会把普通连接故障隐藏为长时间无反馈。
- 不在验证失败后自动新建或重跑 Wizard 会话。已完成的官方配置不能由客户端推断为需要重放。

## 下一步顺序

1. 重新构建当前工作区的 `.app` 后，走查会话上下文栏和助手头像的入口密度、图标语义、键盘焦点、主题对比度和窄窗口表现，并补充 DMG 重建与安装验收。
2. 在支持 `openclaw.setup.verify` 的官方 Gateway 上验证 `verified`、`failed` 和 `unavailable` 三种结果的 UI 路径。
3. 在 macOS、Windows、Ubuntu、CentOS 以及 Native/Docker 的真实环境记录交接时间与行为差异；未经实测不得扩展为跨平台承诺。
4. 后续行为变更结束、暂停或交接前，按 `AGENTS.md` 更新本文件并重新执行与改动范围相符的验证。
