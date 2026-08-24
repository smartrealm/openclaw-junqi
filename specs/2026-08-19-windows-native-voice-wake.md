# Windows 本地语音唤醒规格

## 上游契约

- OpenClaw Gateway 通过 `voicewake.get`、`voicewake.set`、`voicewake.routing.get` 和 `voicewake.routing.set` 保存全局唤醒词与路由，并通过 `voicewake.changed` 和 `voicewake.routing.changed` 发布变更。
- 唤醒词识别由客户端本地运行时负责。Gateway 配置成功不表示任何客户端正在监听麦克风。
- OpenClaw 当前没有可供 JunQi 复用的 Windows Voice Wake 运行时。JunQi 的 Windows 实现只能作为本地桌面适配层，不能定义新的 OpenClaw 消息、任务、路由或完成语义。

## 目标行为

1. Windows 上使用系统 SAPI 共享识别器，仅在 JunQi 进程运行且用户明确启用时监听 Gateway 当前唤醒词。
2. 检测到完整唤醒词后先停止本地监听并释放麦克风，再按 `voicewake.routing.get` 的匹配目标选择已有 Gateway 会话并调用现有 Talk 启动入口。
3. 唤醒只负责进入 Talk，不把识别文本写入 transcript，也不推断 OpenClaw 已完成转写或路由。
4. Talk、手动录音、Gateway 未连接、唤醒词或路由读取失败时，本地监听必须停止或保持暂停。
5. SAPI、语言包或音频设备不可用时显示结构化错误，不切换到云端识别、浏览器识别或另一运行时。
6. macOS 和 Linux 返回明确的不支持状态，不展示可以启用的 Windows 开关。

## 本地状态与所有权

- 本地启用偏好只表示 Windows 客户端是否尝试监听，使用应用本地存储保存，不回写 Gateway。
- 原生监听以 `ownerId` 围栏隔离旧线程事件。相同所有者和相同唤醒词可复用；不同所有者切换前必须等待旧线程退出。
- 原生事件只包含所有者、运行状态、匹配的已配置唤醒词和错误信息，不包含音频或自由文本转写。
- 路由到 `agentId` 时读取同一可信连接上的官方 `agents.list`，按官方 `resolveExplicitAgentSessionKey` 规则从已核验的 `mainKey` 与 Agent 清单派生显式主会话键，再与当前 Gateway 会话投影核对；`sessionKey` 目标也必须已存在于该投影。目标缺失时保持错误，不使用固定 `main`、不创建本地会话。
- 应用退出即停止监听。本功能不是 Windows 服务，也不声称应用退出后仍可唤醒。

## IPC 契约

- `voice_wake_capability` 返回 `{ supported, engine }`。
- `voice_wake_start` 接收 `{ ownerId, triggers }`，返回 `{ ownerId, supported, listening, reused, stopped }`。
- `voice_wake_stop` 接收 `{ ownerId }`，返回相同结构。
- 原生事件名为 `voice-wake-native`，状态为 `listening`、`detected`、`error` 或 `stopped`。
- 唤醒词数量限制为 1 至 32 个；每项去除首尾空白后不能为空，UTF-16 长度不超过 64，忽略大小写去重。

## 验收条件

- Rust 纯逻辑测试覆盖所有者校验、唤醒词校验、去重和所有权围栏。
- TypeScript 契约测试覆盖能力、命令结果和事件解码，非法或跨所有者响应必须失败关闭。
- 运行时测试覆盖启用、配置变更、Talk 忙碌、断线、检测后启动 Talk和错误收敛。
- Windows 目标可以编译；真实 Windows 设备上验证 SAPI、麦克风、语言包、启停、亮暗主题、窄窗口和键盘操作。
- 当前 macOS 主机只能证明非 Windows 分支、自动化契约和跨目标编译，不能作为 Windows 真机验收。
