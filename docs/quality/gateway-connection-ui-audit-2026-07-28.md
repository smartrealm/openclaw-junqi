# Gateway 连接异常 UI 审计

日期：2026-07-28

范围：`src/main.tsx`、Gateway WebSocket 传输层、主窗口与 Quick Chat 后台任务、共享连接状态 UI

## 依据

- `Connection` 的 `onclose` 已先更新 `connected` / `connecting`，触发 `onStatusChange`，再按重试策略重连。
- 主窗口和 Quick Chat 都把该回调写入 `chatStore.setConnectionStatus`；状态栏、仪表盘和快捷聊天从同一状态读取连接结果。
- 关闭 WebSocket 时，在途 RPC 必须被拒绝，不能悬挂到超时；这是本地请求生命周期，不是 OpenClaw RPC 错误协议的新增字段。

因此 Gateway 普通断连的展示所有权应属于共享连接状态，而不是全局致命错误层。

## 问题

### BUG-GW-UI-01：普通断连被误报为应用崩溃

`Connection.rejectAllPending` 使用裸字符串 `Gateway connection closed` 拒绝请求。任何遗漏终止处理的后台 Promise 会进入 `window.unhandledrejection`，后者不区分错误类型，直接用全屏 `Promise Rejection` 覆盖 React 界面。

结果是同一次断连同时存在两套互相冲突的 UI：应用内部显示断开/重连，全局层却把它表现为不可恢复崩溃。

### BUG-GW-UI-02：恢复进度在认证连接后仍停留于运行态

2026-07-29 的 macOS 本地包截图显示状态栏长期停留在 72%，并显示
`Gateway 健康（{{mode}}），正在重新连接...`。源码核对确认有两个独立问题：

- 自动冷启动只在手动恢复标记存在时发送完成态，WebSocket 已认证连接后仍可能保留旧运行态；
- `gateway.progress.gatewayHealthy` 需要 `mode`，但进程探测和部分 ensure 调用没有提供插值参数。

此外，进程存在或运行时 HTTP 就绪不等于 WebSocket 配置、凭据与认证已经成功，不能共用“Gateway 健康”文案。

## 目标行为

- WebSocket 断开和凭据切换使用明确的 `GatewayTransportLifecycleError` 终止在途 RPC。
- 仅该窄类型由全局 Promise 策略标记为已处理；连接状态 UI继续显示断开、重连和最终失败。
- 不按错误文本模糊吞错。普通 `Error("Gateway connection closed")`、RPC 错误和编程错误仍进入全局致命诊断。
- 所有 fire-and-forget 队列与会话重同步调用显式终止 Promise 链，避免依赖全局兜底。
- 断连不清空当前页面或已加载数据；重连后沿用现有会话与历史对账流程。
- 进程探测、运行时就绪和认证连接完成是三个不同阶段；只有连接管理器的
  `connected` 状态可以结束恢复进度并声明认证完成。
- 状态栏只把显式 `running` 事件视为活动操作，已连接时不显示过期的自动恢复运行态。

## 实施结果

- 新增轻量、无运行时依赖的 Gateway 传输生命周期错误契约。
- `Connection` 在 socket close、显式 disconnect 和凭据切换时用该类型拒绝全部在途请求。
- 全局拒绝策略提取为纯函数：生命周期错误调用 `preventDefault()` 并交回连接 UI，其他拒绝仍显示致命覆盖层。
- 主窗口、Quick Chat、聊天队列和会话恢复路径补齐显式 `.catch()` 终点。
- Gateway 进度改为类型化对象与集中工厂；运行时模式随 `params.mode` 进入翻译契约。
- 自动与手动恢复共用一个活动标记；任何已认证连接都会发出 `completed`，重试耗尽发出 `failed`。
- 删除仅覆盖手动恢复的旧 awaiting 标记和已废弃的 `gatewayHealthy` 进度翻译键。

## 验证边界

- 自动化覆盖类型实例、跨模块结构化标记、普通同文案 Error 不被吞掉，以及真实编程错误仍为 fatal。
- 定向 TypeScript 与 23 条文件/Gateway 回归通过；`pnpm lint`、`pnpm test` 和 `pnpm build` 通过，生产构建没有循环分包或超预算 chunk 警告。
- macOS ARM64 本地 DMG 已重建并完成只读挂载；镜像内应用版本为 `1.4.17`，Mach-O 为 `arm64`，应用与 DMG 的 ad-hoc 签名及镜像校验均通过。最终 SHA-256 为 `2e70709380da7dd9fc7e0777b430b2af35b69d22a8a6f52abff9b86cee0563d7`。
- 需要在 Tauri 真机中通过停止/启动已选择的 Gateway 检查状态栏、仪表盘和 Quick Chat 的断开/重连表现；自动化通过不能替代该项。
- BUG-GW-UI-02 定向回归覆盖插值参数、阶段语义、自动完成和状态栏过期事件门禁；最终 macOS 包包含该修复，但当前自动化浏览器环境没有可用窗口，实际断连/重连过程仍需 Tauri 真机复测。
