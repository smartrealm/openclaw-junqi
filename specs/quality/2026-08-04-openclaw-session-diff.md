# OpenClaw 会话变更快照对齐规格

## 依据

官方 OpenClaw 提交 `1e3880352e614116549c0a30c67a59a2d40ba259` 的
`SessionsDiffParamsSchema` 与 `SessionsDiffResultSchema` 定义 `sessions.diff`。Gateway 以会话身份
加载创建该会话时记录的 checkout 基线，不允许未知会话退回任意 agent 工作区。

## 目标

1. JunQi 仅显示 `sessions.diff` 返回的 sessionKey、分支、统计、文件状态与补丁。
2. 请求必须连接围栏并校验返回 sessionKey 与请求一致；畸形字段、断线和连接切换失败关闭。
3. 面板保留 `unknown_session`、`not_git`、binary、文件或结果截断的原生语义。
4. 不使用本地 Git、任意路径或伪造补丁作为 fallback。

## 验收

- client 覆盖完整 response、身份错配、畸形 response 与连接切换。
- UI 覆盖加载、空结果、不可用原因与补丁截断。
- 文档、TypeScript、测试、构建和协议链接校验通过。
