# OpenClaw Talk 能力目录对齐

日期：2026-08-03

## 结论

JunQi 的连续语音只消费 OpenClaw 官方 `talk.catalog`、`talk.session.*` 和 `talk.event` 契约。旧实现把 `speech.ready` 和单一 `providers` 列表当成整个目录，无法解码当前 Gateway 返回的官方三组结构，因此真实 Talk relay 会在目录解析阶段被判定为不可用。本次修复改为读取官方 `TalkCatalogResult`，并在桌面端能力未被明确声明时失败关闭。

## 权威依据

- [OpenClaw Talk 节点文档](https://github.com/openclaw/openclaw/blob/main/docs/nodes/talk.md)
- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [OpenClaw Talk handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/talk.ts)

官方目录返回顶层 `modes`、`transports`、`brains`，以及 `speech`、`transcription`、`realtime` 三个 provider group。group 的 `ready` 和 `activeProvider` 是可选字段；provider 的 `modes`、`transports`、`brains`、输入输出音频格式和 barge-in 能力也按官方 schema 允许缺省。JunQi 不用缺省值补齐这些能力。

## 当前行为

- `decodeTalkCatalog` 严格要求三组官方 group 和顶层枚举数组，保留 `realtime.ready` 的未知状态。
- provider 只在官方 schema 的必填 `id`、`label`、`configured` 正确且所有已出现的可选字段类型合法时进入内存目录。
- `selectRealtimeRelayProvider` 只从 `realtime.providers` 选择，并要求 Gateway 明确声明 `realtime.ready: true`、已配置、`realtime`、`gateway-relay`、`agent-consult`、barge-in，以及原生 worker 使用的 PCM16 24000Hz 单声道输入和输出。
- 不再读取或生成 `speech.ready`；旧目录会显示 Gateway Talk 不可用，不伪造兼容成功。

## JunQi 边界

OpenClaw 负责 provider 配置、能力目录、relay 生命周期和 Talk 事件。JunQi 只负责桌面麦克风采集、音频格式边界、连接 fencing、事件顺序和 UI 投影。24kHz 单声道是 JunQi 当前 Rust worker 与播放器的本地格式契约，不代表 JunQi 向 Gateway 增加了新的 OpenClaw 能力。

## 验证结果

- `pnpm exec tsc --noEmit` 通过。
- TalkGatewayClient 与 talkTypes 定向测试 7 项通过。
- 回归覆盖当前官方三组目录、旧 `speech.ready` 目录拒绝、`realtime.ready` 未确认、缺失原生输出格式和当前 relay 创建参数。
- `git diff --check` 通过。

## 未验证边界

- 当前工作区未连接真实目标 Gateway，未做线上 `talk.catalog`、`talk.session.create` 或 `talk.event` 联机验证。
- Windows、CentOS、Ubuntu 和不同音频设备的 CPAL/播放行为仍需在对应目标环境实测；TypeScript 契约测试不能替代桌面真机验证。
- OpenClaw 未来新增音频编码或能力字段时，JunQi 会保持未知不可用，直到官方 schema 和桌面 native 边界重新核对。
