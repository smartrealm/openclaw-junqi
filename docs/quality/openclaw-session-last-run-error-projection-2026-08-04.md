# OpenClaw 会话最近运行错误投影

## 权威依据

OpenClaw [Gateway Protocol](https://docs.openclaw.ai/gateway/protocol) 将 `sessions.list` 定义为会话索引。官方 [GatewaySessionRow](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils.types.ts) 明确说明 `lastRunError` 是最近失败或超时运行的紧凑用户可见原因；[会话行生成器](https://github.com/openclaw/openclaw/blob/main/src/gateway/session-utils-row.ts) 直接将其投影到行中。

## 发现

JunQi 之前丢弃该字段。活跃会话的流式错误有单独的即时呈现，但已经切换标签页或已结束的会话没有可靠的原生失败摘要，用户只能重新进入会话后从历史中判断。

## 实现边界

- 只接受非空字符串，并且只存放在现有会话内存投影中；完整 Gateway 会话快照缺失该字段时会清除旧值。
- 标签页显示紧凑错误标记，当前会话栏显示同一只读状态；完整错误文本只在可访问名称和原生提示文本中提供。
- 不根据该值改变运行状态、灵动岛、任务图、工具结果、输入框、停止按钮或本地重试逻辑。
- 上游负责写入、清除、净化与解释错误。JunQi 不将其写入 transcript、日志、配置或持久化存储。

## 验证结果

- 定向回归通过：严格错误摘要解析、完整会话快照清除旧值、聊天上下文与标签页既有布局共 66 项测试通过。
- `pnpm lint` 通过，包含 TypeScript、模块边界与版本一致性检查。
- `pnpm test` 通过，覆盖全部前端与脚本测试。测试输出中的既有 React 服务端渲染 `useLayoutEffect` 警告未升级为失败。
- `pnpm build` 通过，包含协作插件包契约、TypeScript 和 Vite 生产构建。
- `pnpm verify:openclaw-docs` 通过。

## 未验证边界

真实 Gateway 的失败、超时、成功后清除以及不同桌面平台的窄窗口和读屏验收仍待执行。
