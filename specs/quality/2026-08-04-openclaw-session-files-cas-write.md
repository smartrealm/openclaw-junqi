# OpenClaw 会话文件 CAS 写入对齐规格

1. 写入必须经现有的 `operator.admin` 临时请求器，不复用日常 read/write 连接或本地文件 API。
2. sessionKey、path、expectedHash 和 Gateway 返回 sessionKey 必须严格校验；内容只转发给 Gateway，
   客户端不伪造 UTF-8、大小或路径判断成功。
3. 只将官方 `INVALID_REQUEST` 的 `session_file_conflict` details 转换为冲突状态，并保留经校验的
   `currentHash`；其他 RPC 错误原样失败。
4. 连接或授权请求完成后发生身份变化时，由现有 privileged requester 失败关闭。
5. 不自动重试 CAS 冲突，不显示本地写入成功，不写入本机目录。

## 验收

- 回归覆盖正常写入、输入非法、返回 session 身份错配与官方冲突。
- 文档、TypeScript、测试、构建、官方链接和差异检查通过。
