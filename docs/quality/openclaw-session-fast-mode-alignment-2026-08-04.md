# OpenClaw 会话快速模式对齐记录

## 权威依据

OpenClaw 官方文档 `docs/tools/thinking.md` 与 `docs/tools/slash-commands.md` 定义 `/fast auto|on|off|default`：前三项设定会话覆盖，`default` 清除覆盖并继承运行时默认值。官方协议类型将 `sessions.patch.fastMode` 定义为 `boolean | "auto" | null`。Gateway 的 `sessions.patch` 实现返回已应用的 `entry`，再广播 `sessions.changed`。

## 实现结果

- `Session` 与 `sessions.list` 投影保留 `fastMode` 的官方值域，不接受未知值。
- 会话运行时控制以继承、自动、开启、关闭呈现原生会话覆盖；映射为 `null`、`"auto"`、`true`、`false`。
- `SessionSettingsClient` 复用已存在的短生命周期 `operator.admin` 请求和会话串行协调器，调用 `sessions.patch` 后以响应 `entry.fastMode` 回写本地目标会话。
- 控制条新增快速模式摘要；模型标签在窄宽度下可收缩截断，避免覆盖其他状态标签。界面继续使用既有主题变量和焦点样式。
- 不添加提供商特化规则、私有 Gateway 字段或性能承诺。

## 自动化验证

- `node --import ./test-setup.ts --import tsx --test src/components/Chat/message-input/useComposerInterruption.test.ts src/components/Chat/session-runtime/sessionRuntimeDomain.test.ts src/services/gateway/SessionSettingsClient.test.ts src/stores/chatStore.test.ts`：46 项通过。
- `pnpm lint`：通过，包括模块边界、版本一致性和 TypeScript 无输出检查。
- `pnpm test`：通过；测试输出保留既有 React 服务端渲染 `useLayoutEffect` 警告，但没有失败项。
- `pnpm build`：通过，包括协作插件契约、TypeScript 和 Vite 生产构建。
- `pnpm verify:openclaw-docs`：通过，核验当前官方 OpenClaw 协议文档链接。
- 全量测试中曾发现一项与既有 Stop 派发前围栏规格相冲突的过期断言：`sendingBySession` 覆盖本地预处理，不能伪装为 Gateway Run。已将其修正为“不触发原生中断”的回归断言，并复跑全量测试通过。

## 未验证边界

真实 Gateway、模型提供商实际性能、macOS、Windows、CentOS、Ubuntu 真机，以及浅色和深色主题下的人工视觉验收尚未执行。快速模式的实际模型行为由 OpenClaw 官方实现和上游提供商能力决定，JunQi 不将其显示为已保证的加速结果。
