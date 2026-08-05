# OpenClaw 原生记忆检索对齐

日期：2026-08-03

## 结论

JunQi 已在现有 Memory Explorer 中增加 Gateway 检索视图，调用 OpenClaw 官方只读
`memory.search` RPC。工作区文件浏览仍保留为独立的本地只读视图；两者不会互相合成
结果，也不会把本地 Markdown 读取冒充成 Gateway 索引结果。

## 权威依据

- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)
- [OpenClaw memory.search handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/memory-search.ts)
- [OpenClaw memory host types](https://github.com/openclaw/openclaw/blob/main/src/memory-host-sdk/host/types.ts)
- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)

当前官方源码把 `memory.search` 声明为 `operator.read` 方法。handler 接受非空
`query`，以及可选的 `maxResults`、`minScore`、`agentId`；`maxResults` 在 Gateway
侧限制为 1 到 50，默认值由 Gateway 处理。响应由 Gateway 返回 `agentId`、`provider`、
`searchMode`、`results`，并可能包含 `stale`、`warning`、`action`。结果来源由官方类型
限制为 `memory` 或 `sessions`，同时包含路径、行号、分数和片段。

协议文档当前对 `doctor.memory.status` 与 `doctor.memory.remHarness` 有诊断说明，
但它们不是通用记忆 CRUD 接口。本次只接入 handler 和 descriptor 已确认的
`memory.search`，不把诊断或修复方法放进记忆页面。

## 当前行为

1. Memory Explorer 默认仍展示当前 OpenClaw 工作区的 `MEMORY.md` 和 `memory/` Markdown
   文件。此视图继续通过既有受工作区路径约束的桌面 IPC 读取，并在本地筛选。
2. 用户切换到 Gateway 检索视图并提交查询后，页面只通过 `gatewayDataStore` 调用
   `memory.search`。JunQi 不传入伪造的 session scope，也不硬编码 `main` agent；省略
   `agentId` 时由 Gateway 按官方 handler 解析默认 agent，界面展示响应中的实际 `agentId`。
3. 结果卡片只展示 Gateway 返回的 path、line range、source、score、snippet 和可选
   citation。provider、search mode、stale、warning、action 都直接来自响应。
4. `features.methods` 未列出 `memory.search` 时仍发送官方 RPC；只有 Gateway 实际返回未知方法时
   显示明确的 unsupported 状态。断线、连接替换、重复查询和迟到响应由请求栅栏处理，不得覆盖当前结果。
5. 记忆片段只存在于当前 store 快照，不写入 localStorage、日志、文件或自定义 Memory API。

## 验证

- `OpenClawMemorySearchClient.test.ts` 覆盖官方请求参数、响应字段、可选元数据、来源和
  搜索模式校验，以及 Gateway 的 `maxResults` 边界。
- `gatewayDataStore.test.ts` 覆盖发现遗漏时仍请求、实际未知方法、最新查询提交、Gateway
  元数据保留和断线清理。
- Memory Explorer 保留无 `fetch`、无浏览器桥接和无 CRUD 调用的页面边界测试。
- 提交前运行定向测试、TypeScript、lint、完整测试、生产构建、官方链接校验和差异检查。

## 未验证边界

- 尚未连接真实 Gateway 验证不同 provider、fts-only、embedding 不可用、索引过期和
  `sessions` 来源结果的现场组合。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验收 Gateway 权限拒绝、断线重连和大结果
  集合下的界面表现。
- 本次没有接入 `doctor.memory.status`、`doctor.memory.remHarness` 或任何写入、修复、
  embedding 探测方法；这些能力必须在取得对应官方字段、权限和生命周期证据后另行立项。
