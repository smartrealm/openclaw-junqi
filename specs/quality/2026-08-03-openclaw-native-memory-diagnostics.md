# OpenClaw 原生记忆诊断规格

## 目标

在不捏造 OpenClaw 能力的前提下，让 JunQi 桌面端能查看 Gateway 原生的记忆就绪状态，
并按用户主动操作预览官方 REM harness 输出。JunQi 只是 OpenClaw 客户端，诊断数据的
生命周期、权限和内容由 Gateway 负责。

## 约束

- 以 OpenClaw 当前官方 `protocol.md`、`core-descriptors.ts`、`method-scopes.ts` 和
  `server-methods/doctor.ts` 为契约；安装版本只用于复现，不用于能力分支。
- `doctor.memory.status` 和 `doctor.memory.remHarness` 只通过已有 Gateway `operator.read`
  连接调用；不得新增 scope、临时协议或本地替代实现。
- status 默认请求 `{}`，不能自行加入 `probe` 或 `deep`。REM 的 `grounded`、
  `includePromoted` 和 `limit` 只有用户显式选择时才发送。
- 能力明确不存在时不发 RPC；能力未知时真实调用；method-not-found、权限、传输和响应
  错误必须可见，不能转成空预览或成功。
- workspace 文件、`memory.search` 结果、REM 预览和会话 transcript 互不合成。诊断响应不
  写本地文件、日志、持久化 store 或 OpenClaw 配置。
- 只接入只读方法，不接入 `doctor.memory.*` 的 backfill、reset、repair、dedupe 或其他写入。

## 验收条件

1. Memory Explorer 有独立 Gateway diagnostics 视图，默认不触发 RPC；用户点击后调用
   `doctor.memory.status` 并展示 native agent、provider、embedding 和可选 runtime 字段。
2. status 请求不带 `probe`/`deep`，除非调用方明确传入；响应的 `ok`、`checked`、`cached`、
   错误和时间字段不被默认值覆盖。
3. 用户可以显式请求 REM harness，并选择 grounded 文件和 promoted 候选；UI 展示 native
   success/error 联合响应，不把 `ok: false` 改写成空数组。
4. Gateway 能力广告为 false 时不发对应 RPC；断线、连接替换和旧响应不会覆盖新连接 store。
5. malformed known fields 导致明确协议错误；未知 additive fields 不被当作 JunQi 自有状态。
6. 页面不直接调用 `fetch`、`window.aegis.memory` 或自定义 Memory API；现有工作区浏览与
   Gateway 检索保持可用。

## 不在范围内

- embedding provider 主动探测的默认开启、后台轮询或跨平台自行实现。
- OpenClaw 记忆文件编辑、删除、关系图、同步、向量索引重建或其他 CRUD。
- `doctor.memory.*` 写入/修复方法、审批、事件订阅、远程任务编排和本地 REM 持久化。
- 将官方没有返回的 agent、provider、状态、路径或时间信息补成猜测值。
