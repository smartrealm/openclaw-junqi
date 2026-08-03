# OpenClaw 全局语音唤醒触发词对齐规格

日期：2026-08-03

## 目标

让 Settings Jarvis 对 OpenClaw Gateway 全局 `voicewake` trigger list 做受限且忠实的
客户端更新：本地模型只决定哪些项可以由本页替换，不能删除其他客户端或节点拥有的
触发词。

## 约束

1. `voicewake.get`、`voicewake.set`、`voicewake.routing.get` 与
   `voicewake.routing.set` 均严格使用官方 Gateway 协议；不得添加本地 RPC、版本分支或
   猜测性字段。
2. 保存前必须通过当前 authenticated/fenced Gateway 重新读取完整触发词列表，不能用
   React 旧快照或本地模型标签作为完整列表。
3. 仅在裁剪首尾空白后与当前本地模型标签完全相同的 Gateway 项可被本页替换；全局
   trigger list 的大小写和标点变体必须保留原始 Gateway 值与顺序。路由归一化不得用于
   全局 trigger list。
4. 选择结果必须非空、唯一且能映射到模型的精确声明标签。合并后超过官方最大 32 项时，
   必须失败关闭，不调用 `voicewake.set`。
5. 请求或响应连接轮换、协议解码失败或 Gateway 拒绝时，UI 不得显示已保存，也不得更改
   已确认的 trigger snapshot。
6. 本操作不得调用或修改 `voicewake.routing.set`、Talk、session、category 或任意
   本地 transcript 状态。
7. 64 UTF-16 code unit 的模型标签限制是协议不变量；注释不得把它绑定成特定版本能力。
8. macOS、Windows、CentOS、Ubuntu 的常驻语音能力必须分开验证。没有官方依据或目标
   平台实测时，JunQi 不得称为 OpenClaw 原生支持。

## 验收条件

- Gateway 当前触发词为 `openclaw`、`other node`、`Jarvis`，本地模型选择 `JunQi` 后，
  写入参数保留前两项并以精确模型标签替换 `Jarvis`。
- 当无关项已占满 32 项时，选择本地模型词失败，且不发送 `voicewake.set`。
- 空、重复或未声明的本地选择失败，且不发送 `voicewake.set`。
- Gateway 更新失败或连接改变时，UI 仅显示错误并维持上次经 Gateway 确认的快照。
- 本地模型 `Jarvis` 保存时，Gateway 中的 `jarvis` 必须保留；本地 KWS 结果 `jarvis`
  不能因路由归一化被视为全局 trigger `Jarvis`。
- 关键词单元回归、Gateway client 回归、TypeScript、Rust、边界、构建和官方链接验证
  通过；跨客户端 CAS 与目标平台真机边界被明确记录。
