# OpenClaw Stop 跨入口请求状态围栏审计

日期：2026-08-04

## 依据

- OpenClaw 官方 Gateway 协议规定：`sessions.abort` 使用 `key` 与可选 `runId` 中止活动
  Run；调用方省略 `clearQueued` 时保留 Gateway 拥有的后续队列：
  <https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md>。
- JunQi 的 `gateway.abortChat` 已先写入 Task Stop checkpoint，再以独立控制面调用原生
  `sessions.abort`；只有 Gateway 确认精确 Run 后才结算本地状态。
- `ChatSendCoordinator` 在请求 Gateway 前同步设置 `typingBySession`。主 Composer 的
  `sendingBySession` 覆盖其余异步发送准备阶段。两者共同构成已发出或正执行请求的本地观察，
  不等同于远端 Stop 成功。

## 审计范围

审查 Quick Chat Stop、Quick Chat 窗口销毁、会话 reset/delete 的原生 fallback、
`ChatSendCoordinator`、`ChatStore` 与 `gateway.abortChat`。

## 发现

### STOP-03 高优先级：次级入口遗漏发送中请求

上一轮引入的 `selectSessionRequestActive` 已修复主 Composer、Escape 和 Jarvis 语音入口，
但 Quick Chat 的停止按钮、Quick Chat 窗口销毁，以及协作插件不可用时原生
reset/delete 前的 Stop 仍只检查 `typingBySession`。

当请求已进入发送阶段而流式事件尚未到达时，这些入口会跳过 `gateway.abortChat`：

1. Quick Chat 停止按钮可能不出现，或只停止本地语音输出。
2. 关闭 Quick Chat 窗口会清理本地队列并释放 Gateway lease，却不请求中止同一会话的活动
   Run。
3. 原生会话 mutation 会直接执行 reset/delete，未先沿既有 checkpoint 和原生 Stop 控制面
   请求中止。

### STOP-04 高优先级：Gateway Stop 外观会回落到主会话

位置：`src/services/gateway/index.ts`

`gateway.abortChat` 的 `sessionKey` 参数原先默认使用 `agent:main:main`。任何遗漏目标的
调用都可能中止与用户当前操作无关的 Run。

修复：发送和 Stop 复用同一 `OpenClawSessionTarget` 校验。`abortChat` 现在要求显式会话键，
并在 Gateway 连接和 `sessions.abort` 前拒绝空或仅空白目标。键会去除首尾空白，因此
`chatHandler` 的 Run 查询、原生中止参数和回执核验都绑定同一键。

## 修复方向

所有上述入口复用无副作用的 `selectSessionRequestActive`。Stop 仍调用既有
`gateway.abortChat(sessionKey, sessionId)`；`sessionId` 仅用于本地 checkpoint 身份绑定，
不会进入 OpenClaw `sessions.abort` 参数。Quick Chat 的 Stop 控件按同一判定可见。

## 约束

1. 不新增、猜测或发送任何 OpenClaw RPC 字段。
2. 不使用组件本地 `sending` 状态作为远端 Run 已存在的依据；它包含附件读取等本地准备阶段。
3. 不改变 `clearQueued`、Gateway queue mode 或 history reconciliation。
4. 无本地活动请求时，窗口关闭仍释放 lease，Stop 仍可停止本地语音，但不发无目标远端中止。
5. `gateway.abortChat` 不得用 JunQi 默认会话键替代缺失调用方目标。`sessions.abort` 继续由
   OpenClaw 决定有无活动 Run 及最终中止结果。

## 验证结果

已执行并通过：

- 定向回归：Quick Chat Stop、会话生命周期、Chat Store 与 Composer Stop 共 52 项；
- `pnpm lint`：模块边界、版本一致性和 TypeScript 检查通过；
- `pnpm test`：前端与脚本完整测试通过；
- `pnpm build`；
- `pnpm verify:openclaw-docs`；
- `cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`：707 项通过，3 项因外部
  唤醒模型夹具未提供而忽略；
- `git diff --check`、本次改动文件 Emoji 扫描和无引用扫描。
- 本次定向回归覆盖空目标在 Gateway 请求前失败、显式目标仍绑定原生 Stop 及共享会话目标校验。

完整前端测试会打印项目既有的 React SSR `useLayoutEffect` 警告；本次未修改相关组件，命令
以零退出码完成。

## 未验证边界

本审计只界定桌面客户端是否进入现有原生中止控制面。真实 Gateway、模型工具执行、Windows、
macOS、CentOS 与 Ubuntu 的网络时延和语音设备行为仍需真机验收。
