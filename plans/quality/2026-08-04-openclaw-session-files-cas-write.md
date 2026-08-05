# OpenClaw 会话文件 CAS 写入对齐计划

1. [x] 审计官方 schema、handler、冲突回执和 JunQi privileged requester。
2. [x] 实现严格 `sessions.files.set` client 与冲突错误投影。
3. [x] 审计原生 Control UI 的编辑资格、草稿作用域和冲突恢复语义。
4. [x] 在 JunQi 会话文件面板实现内存草稿、显式重读与 CAS 保存交互。
5. [x] 将读取连接身份下沉到写入 client，并以 CodeMirror 保留行分隔符。
6. [x] 补齐回归、文档验证与中文提交。
