# OpenClaw 会话 Companion 控制台对齐规格

## 目标

让 JunQi 作为 OpenClaw 桌面控制台客户端，按当前官方 Companion RPC 合约提供每个会话的只读临时侧栏，而非继续使用旧 `chat.side_result` 路径。

## 约束

1. 只能调用官方 `sessions.companion.ask`、`sessions.companion.state` 和 `sessions.companion.reset`，不得创造新的 Gateway 方法或客户端持久化协议。
2. ask/state 必须通过 attested connection fence；未知方法、断线、连接改变、无效响应和未授权均不得展示成功状态。
3. Companion 结果不能进入 transcript、聊天消息、Task checkpoint、本地发送队列、语音回合或持久化 store。
4. 状态只由当前 Gateway 内存重新水合；session reset、Gateway restart、闲置清理和冷启动后的缺失线程都应显示为空，不得伪造恢复。
5. reset 是用户显式确认后的官方写操作；不会由会话切换、关闭侧栏或网络错误自动触发。
6. 旧 `chat.side_result` 的私有 run 登记、解析、store 投影和 UI 必须与专属测试一并删除。

## 验收

1. 客户端按 schema 发送精确参数并拒绝超界或无效响应。
2. 每个请求绑定同一当前 Gateway connection；过期连接结果不能落入界面。
3. 忙碌、不可用和无效响应分别呈现真实失败语义，主会话运行不被改变。
4. `/btw` 与 `/side` 在普通 Chat 发送前打开并预填 Companion，不创建消息、队列、Run 或 checkpoint。
5. 新旧路径引用全局扫描为空，回归测试、静态检查和构建均通过。
