# OpenClaw 会话文件 CAS 写入对齐

日期：2026-08-04

## 依据

官方 `SessionsFilesSetParamsSchema` 要求 sessionKey、path、content 和 64 位 SHA-256 `expectedHash`。
`sessions.files.set` 仅覆盖已存在的会话工作区文件，Gateway 在写入前校验 UTF-8、NUL、大小、路径边界、
会话 mutation authorization 与 CAS 哈希。竞争写入返回 `session_file_conflict` 及当前哈希。

## 实现边界

JunQi 使用现有单次 `operator.admin` 临时连接请求写入，不从日常连接或本地权限猜测授权。写入 client
只接受 Gateway 返回的 sessionKey 与文件投影；冲突保持为可辨识状态，绝不重试或覆盖当前内容。

会话文件面板仅在 Gateway 返回带合法 SHA-256 哈希的 UTF-8 文本预览，并且全文换行符一致时显示编辑器。草稿
只保存在当前 React 实例内，并以已认证 Gateway connectionId、sessionKey、agentId、Gateway root 与请求 path
为键隔离；它不写入本地工作区、浏览器存储或任何跨运行时持久化位置。读取 client 将认证连接 ID 作为
非 wire 元数据返回，保存同时传入该 ID 和读取时保留的 expectedHash；临时 admin 请求开始前后都校验该身份。
编辑器使用 CodeMirror 的 `lineSeparator` 与 `sliceDoc()`，保留 CRLF/CR 文本的原始行分隔符。
发生官方 CAS 冲突后，JunQi 保留本地草稿且不自动重试；用户必须显式选择“重读并替换草稿”才会以 Gateway
最新内容替换草稿。Gateway 未返回新哈希时也不显示保存成功。

## 验证

- 定向回归：会话文件 client、编辑资格与草稿作用域、active leaf 历史恢复共 26 项通过。
- `pnpm lint`：通过，包含 TypeScript、模块边界和版本一致性检查。
- `pnpm test`：通过。
- `pnpm build`：通过，包含 collaboration bundle、TypeScript 和 Vite 生产构建。
- `pnpm verify:openclaw-docs`：通过，已核对官方 Gateway 协议命令文档链接。
- `git diff --check`：通过；本轮改动文件已完成 Emoji 扫描，无匹配结果。

真实 admin 授权、设备配对、Gateway 文件写入以及 macOS、Windows、Linux 目标桌面运行时仍需实测；本轮未接入
平台专属文件 API，也未将自动化构建描述为上述真机验收。
