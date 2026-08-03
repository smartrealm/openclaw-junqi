# OpenClaw 全局语音唤醒触发词与 JunQi 对齐

日期：2026-08-03

## 结论

OpenClaw 的 `voicewake` 触发词是 Gateway 拥有的一份全局列表，不属于某个
JunQi 窗口、本地唤醒模型或单个节点。JunQi 只能读取、更新并投影这份列表，不能把
本地 Sherpa 模型中选中的词当作完整的 Gateway 配置。

此前 Settings Jarvis 将本地模型选择直接作为 `voicewake.set({ triggers })` 的完整
参数发送。这会删除当前模型无法识别、但已由其他 OpenClaw 客户端或节点配置的全局
触发词。该行为把客户端局部视图错误地提升为 Gateway 权威状态，属于高优先级数据
完整性缺陷。

## 权威依据

- [OpenClaw Voice Wake](https://docs.openclaw.ai/nodes/voicewake)
- [OpenClaw macOS Voice Wake](https://docs.openclaw.ai/platforms/mac/voicewake)
- [OpenClaw Gateway voice wake handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/voicewake.ts)
- [OpenClaw Gateway voice wake routing handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/voicewake-routing.ts)
- [OpenClaw Gateway voice wake routing persistence](https://github.com/openclaw/openclaw/blob/main/src/infra/voicewake-routing.ts)

官方文档和 Gateway handler 声明 `voicewake.get` 返回 `{ triggers }`，
`voicewake.set({ triggers })` 更新同一份 Gateway 全局触发词列表。列表最多 32 项，单项
最多 64 个 UTF-16 code unit；`voicewake.changed` 会广播给具备 read scope 的连接。路由
配置由 `voicewake.routing.get/set` 和独立 handler 管理，不能由触发词保存隐式改写。

官方文档当前对常驻识别给出明确平台承诺的是 macOS companion 与 Android node。JunQi
的 CPAL 和本地 Sherpa 采集是桌面客户端层增强，不是 Windows、CentOS 或 Ubuntu 已获
官方 OpenClaw 原生认证的语音运行时。该三类目标仍须分别以真实安装包、麦克风权限、
登录启动、托盘、睡眠恢复和焦点恢复证据验收；在此之前只能标记为待验证。

## 审计发现

### VW-01 - 高 - 本地保存覆盖 Gateway 全局触发词

位置：`src/hooks/useJarvisVoiceSettings.ts`、
`src/services/voice/VoiceWakeKeywordSelection.ts`、
`src/services/gateway/VoiceWakeGatewayClient.ts`

保存操作先以本地模型标签解析 UI 选择，随后直接调用
`voiceWakeGatewayClient.setTriggers(triggers)`。官方 `set` 是完整全局列表更新，因此
例如 Gateway 当前含 `openclaw` 和另一个节点的词，而本地模型仅声明 `Jarvis` 时，
保存 `Jarvis` 会删除前两者。

修复必须在每次写入前从当前已认证、fenced Gateway 重新读取列表，只替换归属于当前
本地模型的规范化标签，保留其余 Gateway 项。合并结果超过协议 32 项时必须拒绝写入，
不能依赖上游截断来制造部分成功。`voicewake.routing.*` 不在此操作范围内。

`voicewake.set` 没有 revision 或 compare-and-set 参数，因此不同客户端在读写之间仍可能
发生最后写入者覆盖。JunQi 不能伪造跨客户端锁；这项边界应由 Gateway 后续协议能力
解决，并在客户端文档中如实记录。

### VW-02 - 低 - 协议上限的注释错误绑定安装版本

位置：`src-tauri/src/commands/voice_wake_model.rs`

64 UTF-16 code unit 是官方 `voicewake` 协议约束，但代码注释把它写成特定 OpenClaw
版本的行为。这会误导后续维护者把稳定协议值视为版本门禁。注释应只引用协议语义，
不绑定当前安装版本。

## 当前行为

1. 本地模型目录和关键词标签只存于 JunQi 原生应用数据；Gateway 触发词与路由仅存于
   已认证 OpenClaw Gateway。
2. Settings Jarvis 只允许选择经过本地模型 `keywords.txt` 声明的标签，不能把任意文本
   伪装为已 tokenized 的唤醒词。
3. 保存读取 Gateway 的最新触发词快照，替换本模型标签，保留不属于本模型的项目；只有
   Gateway 返回确认的完整列表才进入 UI 状态。
4. 空选择、重复或未声明标签、连接轮换、畸形 Gateway 响应、容量超限和写入失败均不
   改变 UI 成功状态。
5. 桌面待命与本地识别不等于 OpenClaw 对每个桌面操作系统的原生保证。未经目标平台
   实测的能力保持待验证。

## 验证

- 关键词选择单元测试覆盖保留无关全局词、替换本地模型词、拒绝非法选择和拒绝超出
  Gateway 最大列表容量的合并。
- Gateway client 回归继续覆盖精确方法名、参数外层、严格解码和 connection fence。
- 2026-08-03 已通过关键词与 Gateway client 定向测试、`pnpm lint`、`pnpm test`、
  `pnpm build`、`pnpm verify:openclaw-docs`、`pnpm test:rust`、
  `pnpm collab:test`、`pnpm collab:validate`、`cargo fmt -- --check`、定向 Rust
  模型测试及 `git diff --check`。
- 完整前端测试仍输出既有 React SSR `useLayoutEffect` 警告；Rust 测试仍输出既有
  `src/commands/system.rs` 未使用变量警告。两者均未造成失败，本次未修改相关文件。

## 未验证边界

- 多个客户端跨进程同时写 `voicewake.set` 的原子性无法由现有协议保证；JunQi 的新鲜
  读取只能缩小窗口，不能替代 Gateway revision/CAS。
- 尚未在真实 Gateway 验证 `voicewake.changed` 广播与 Settings 打开期间的刷新时序。
- 尚未在 Windows、CentOS、Ubuntu 真实验收常驻唤醒所需的系统权限、登录启动、托盘、
  睡眠恢复和焦点策略。
- 项目未提供独立 `prettier` 可执行命令，因此未将该命令作为格式验收；TypeScript、Rust
  和 Markdown 变更已分别经过项目 lint、Rust format check 和 diff 格式检查。
