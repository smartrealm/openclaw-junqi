# OpenClaw 原生产物协议对齐规格

日期：2026-08-03

## 目标

Chat 会话可以从 OpenClaw Gateway 读取当前 session 的原生产物摘要，并在 Gateway 明确
提供可下载数据时保存到本机。

## 约束

1. 只能调用官方 `artifacts.list`、`artifacts.get` 和 `artifacts.download`，三者权限均
   为 `operator.read`。查询范围必须来自当前真实会话，不从本地 transcript 或标题猜测
   run/task 身份。
2. Gateway 是 artifact 的内容、归属、下载模式和安全 URL 权威。JunQi 不读取 Gateway
   主机路径，不把 XML artifact、本地文件结果或 URL 猜测成原生 artifact。
3. 响应必须满足官方摘要和下载字段；`bytes`、`url`、`unsupported` 三种模式必须保留。
   Gateway 认可的 `/api/...` 相对下载 URL 只能绑定当前 Gateway HTTP 基址后交给桌面保存边界。
   `unsupported` 不得显示可执行的保存动作。
4. 快照必须绑定 Gateway 连接和请求代次，会话删除或断线后不得继续显示旧产物。
5. 保存动作必须经过桌面文件保存边界和大小限制，不把 Gateway 返回内容写入日志、持久
   前端状态或文档。

## 验收条件

- 用户在 Chat 当前会话中打开产物入口，可以看到 Gateway 返回的摘要。
- 未广告能力、连接失败、非法响应、会话删除或迟到响应时，不显示旧摘要，也不发送不受
  支持的 RPC。
- `bytes` 或安全 URL 下载经过桌面保存边界；`unsupported` 明确不可下载。
- 原有 `<openclaw_artifact>` 内联渲染继续独立工作。
- 文档、测试和跨平台未验证边界与实际代码同步。
