# OpenClaw 会话文件 CAS 写入对齐规格

1. 写入必须经现有的 `operator.admin` 临时请求器，不复用日常 read/write 连接或本地文件 API。
2. sessionKey、path、expectedHash 和 Gateway 返回 sessionKey 必须严格校验；内容只转发给 Gateway，
   客户端不伪造 UTF-8、大小或路径判断成功。
3. 只将官方 `INVALID_REQUEST` 的 `session_file_conflict` details 转换为冲突状态，并保留经校验的
   `currentHash`；其他 RPC 错误原样失败。
4. 连接或授权请求完成后发生身份变化时，由现有 privileged requester 失败关闭。
5. 不自动重试 CAS 冲突，不显示本地写入成功，不写入本机目录。
6. 编辑器只接受带合法哈希、UTF-8 文本预览且换行符一致的 Gateway 文件；图片、二进制、缺失内容和混合
   换行符文件保持只读。
7. 草稿必须按已认证 Gateway connectionId、sessionKey、agentId、Gateway root 与请求 path 隔离，且只驻留
   当前界面内存。保存完成后更新该草稿的 expectedHash。
8. 冲突和未返回新哈希的写入不得清空或替换本地草稿。仅用户显式重读可用 Gateway 内容替换草稿。
9. 客户端必须把读取的认证连接 ID 作为本地元数据绑定到写入；在临时 admin 请求开始前后发现身份变化时失败
   关闭。`sessions.files.set` 未被 Gateway 支持时也必须投影为不可用状态。
10. 编辑器必须按原始 CRLF/CR/LF 分隔符序列化内容，不能使用会归一化行尾的 HTML textarea 或受控编辑器值。

## 验收

- 回归覆盖正常写入、输入非法、返回 session 身份错配、连接身份错配、原生冲突与不支持方法，以及编辑资格、
  换行符与草稿作用域。
- 文档、TypeScript、测试、构建、官方链接和差异检查通过。
