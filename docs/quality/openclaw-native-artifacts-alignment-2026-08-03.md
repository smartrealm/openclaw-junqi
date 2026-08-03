# OpenClaw 原生产物协议对齐

日期：2026-08-03

## 结论

JunQi 通过 OpenClaw Gateway 原生 `artifacts.list`、`artifacts.get` 和
`artifacts.download` 展示当前会话的产物摘要，并让用户把 Gateway 确认可下载的产物保存
到本机。原有消息中的 `<openclaw_artifact>` 解析仍负责当前 transcript 的内联渲染；两者
不互相推断，也不把本地路径当成 Gateway 产物来源。

## 权威依据

- [OpenClaw Gateway protocol: Agent and workspace helpers](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md#agent-and-workspace-helpers)
- [OpenClaw artifact schema](https://github.com/openclaw/openclaw/blob/main/packages/gateway-protocol/src/schema/artifacts.ts)
- [OpenClaw artifact handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/artifacts.ts)
- [OpenClaw method descriptors](https://github.com/openclaw/openclaw/blob/main/src/gateway/methods/core-descriptors.ts)

官方协议规定三个方法均为 `operator.read`。查询参数只能使用官方的
`sessionKey`、`runId`、`taskId`、`agentId` 范围；下载结果由 Gateway 返回
`base64`、安全 URL 或 `unsupported` 模式。Gateway 负责 transcript、run/task 归属和
安全 URL 判断，JunQi 不扫描 Gateway 文件系统，也不自行执行远程 URL。

## 当前行为

1. Chat 顶部的会话产物入口只使用真实 active session key，打开时按需请求
   `artifacts.list`，并按 Gateway 返回的摘要显示类型、标题、大小和下载状态。
2. 保存动作只调用 `artifacts.download`。`base64` 和绝对 HTTP(S) URL 交给桌面文件保存
   边界；Gateway 认可的 `/api/...` 相对 URL 先绑定当前连接的 HTTP 基址，再进入保存边界。
   `unsupported` 不提供虚假的保存动作。响应字段和摘要字段严格校验，未知附加字段可被忽略
   但已知字段类型错误会拒绝进入 UI 状态。
3. 产物快照按 Gateway 连接、请求代次和 session key 绑定。断线、会话删除、迟到响应和
   Gateway 实际未知方法都会清理旧状态；方法发现遗漏不阻止官方 RPC。
4. 内联 XML artifact 仍是 transcript 内容投影；它不被转换成 `artifacts.*` 结果，
   `artifacts.*` 也不被伪造为 transcript 消息。

## 验证

- `OpenClawArtifactsClient.test.ts` 覆盖官方查询参数、摘要、下载模式、附加字段和非法
  响应。
- `gatewayDataStore.test.ts` 覆盖会话生命周期、发现遗漏时仍请求、实际未知方法、迟到响应和下载保存边界。
- 目标 TypeScript 测试、lint、完整测试、生产构建、官方链接和差异检查在提交前执行。

## 未验证边界

- 尚未连接真实 Gateway 验证不同 transcript 内容、run/task scope 和过期 URL 的现场组合。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验收保存对话框、URL 下载和大文件上限。
- 本次不改变 artifact 生成、transcript 写入、工具执行或审批语义。
