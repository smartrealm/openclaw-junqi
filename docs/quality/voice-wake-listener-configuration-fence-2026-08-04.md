# 语音唤醒监听配置围栏

日期：2026-08-04

## 结论

本地 `voice_wake_start` 过去只要发现任一监听器仍在运行，就返回 `already`。该结果带有旧模式，却没有让调用方拒绝不匹配的回执。若应用根运行时重挂载，或上一轮异步释放尚未结束，新的唤醒词请求可能把旧听写监听投影为已启用的唤醒词模式；Talk PCM 流的请求也可能没有真正生效。

修复后，原生监听器只会对完全相同的采集配置保持幂等。模式或 PCM 流配置不同会先受控替换旧 worker；start/stop 的所有权转换由独立互斥锁串行化，不能交错覆盖新 worker。前端仅在回执明确确认正在监听且模式与请求一致时才进入 listening 状态。旧 worker 仍以 worker id 围栏其事件，不能改写替换后的状态。

## 权威边界

- [OpenClaw Voice Wake](https://github.com/openclaw/openclaw/blob/main/docs/nodes/voicewake.md) 规定触发词及路由属于 Gateway 的全局持久化状态，客户端必须读取并订阅变化。
- [OpenClaw Gateway Protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md) 规定 `talk.session.appendAudio`、`talk.session.cancelOutput` 与 `talk.event` 是 Gateway 拥有的 Talk 中继契约。

本修复不增加或修改任何 OpenClaw 方法、字段、路由或会话状态。它只校验 JunQi 本地 CPAL/Sherpa 采集 worker 是否实际满足已验证的桌面 IPC 请求；Gateway 仍是触发词、路由、Talk 和会话身份的唯一权威。

## 当前行为与验证

- 相同模式及相同 PCM 流配置的重复启动复用当前 worker。
- 不同配置替换旧 worker，并只让新 worker 继续发出 `voice-wake` 事件。
- IPC wrapper 对 `listening: false` 或模式不匹配的启动回执失败关闭。
- Rust 单元测试覆盖同配置复用与配置变化替换；前端回归测试覆盖启动回执必须与请求一致。

## 未验证边界

本机自动化无法替代 macOS、Windows、CentOS、Ubuntu 的真实麦克风权限、设备热拔插、休眠恢复和 Talk Gateway 联机验证。这些目标平台仍需分别实测后才能声明可用。
