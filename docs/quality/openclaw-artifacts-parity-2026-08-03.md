# OpenClaw 会话产物能力对齐

日期：2026-08-03

## 依据

当前安装的 OpenClaw 版本为 `2026.7.1-2 (0790d9f)`。本轮核对随包
`schema-BuOFpc7K.js`、`schema-DtyqV_v0.d.ts` 与 `artifacts-Dkq8q9JQ.js`：

- `artifacts.list`、`artifacts.get`、`artifacts.download` 都要求显式的
  `sessionKey`、`runId` 或 `taskId` 查询范围，并可附带 `agentId`。
- 列表与详情只返回产物摘要：id、类型、标题、MIME、大小、来源、消息序号和
  `download.mode`。
- 下载成功时只返回 base64 bytes 或安全 URL；unsupported 下载由 Gateway 以错误返回。
  官方实现只从 transcript 的媒体块读取，并拒绝任意本地路径或不安全 URL 的服务器代抓。

## 当前实现

JunQi 在 `src/services/gateway/artifacts.ts` 中按当前协议构建查询参数并严格校验返回值：

- 没有 session/run/task 查询范围时拒绝请求；
- 校验 artifact id、摘要字段、下载模式、base64 编码和 URL 协议；
- 当服务返回 session key 时，拒绝跨当前会话的产物；
- `Gateway` facade 提供 `listSessionArtifacts`、`getSessionArtifact` 和
  `downloadSessionArtifact`，组件不直接访问连接对象。

Chat 会话上下文栏新增产物入口。列表查询只在用户打开入口时执行，单个产物在用户点击预览或
下载时才读取内容：

- HTML 使用受限 iframe 预览；
- Markdown 与文本使用现有只读 Markdown/文本预览；
- 图片、PDF、音频和视频使用现有受控媒体预览；
- Office 和未识别的二进制不伪造内联预览，显示明确的外部打开或不支持状态；
- 内联预览限制为 8 MiB，下载仍保留官方返回的完整 bytes/URL。

## 验证结果

- `artifacts.test.ts`：参数、会话范围、artifact id、base64 和 URL 安全边界通过。
- `artifactPreview.test.ts`：Markdown、图片、超大文件和 Office 二进制预览边界通过。
- `gatewayRecoveryRegression.test.ts`：固定三个官方产物 RPC 及 service facade 解析路径。
- `pnpm lint`、`pnpm exec tsc --noEmit` 通过。
- 三份 locale JSON 解析通过，`git diff --check` 通过。

## 未验证边界

- 未连接真实 Gateway 读取包含 transcript 媒体块的 artifacts 响应。
- 未在 Windows、Linux 或 macOS 发布制品中验证 URL 下载、浏览器下载权限和外部打开行为。
- 真实 Gateway 可能返回 Office 或其他二进制；当前只读预览会按协议显示不支持，不推断文件
  内容或格式。
