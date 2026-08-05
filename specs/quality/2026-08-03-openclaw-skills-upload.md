# OpenClaw 技能归档上传规格

## 问题

技能页只能从 ClawHub 安装技能，无法把用户已有的 ZIP 技能归档交给当前选定的 OpenClaw
Gateway。直接复用本地路径或旧的本地导入逻辑会绕过 Gateway workspace、安装策略和权限
边界。

## 约束

- 以 OpenClaw 官方 protocol、schema 和 handler 源码为契约；本机安装包只用于复现，不能
  作为版本硬编码或能力开关。
- 只能使用 `skills.upload.begin`、`skills.upload.chunk`、`skills.upload.commit` 和
  `skills.install(source: "upload")`；不得猜测取消、删除或本地写入 RPC。
- 上传和安装是 `operator.admin` 操作，必须使用 `callPrivileged`。
- 归档内容只保留在桌面 WebView 内存和 Gateway 临时上传目录；不写入前端持久化、日志、
  测试快照或文档。
- 本地先计算 SHA-256，commit 和 install 都带同一哈希并校验回执；块 offset 必须使用 Gateway
  上一次确认的 `receivedBytes`。
- Gateway 默认关闭上传归档安装；JunQi 不修改 `skills.install.allowUploadedArchives`，
  也不在失败时切换到本地 SkillHub。

## 验收条件

1. 空归档、超过官方大小限制的归档、非法 slug 在发出 Gateway 请求前失败。
2. 每个上传块不超过客户端 3 MiB，且每次 offset 等于 Gateway 上一次确认的
   `receivedBytes`。
3. begin、chunk、commit 的 `uploadId`、大小或回执不一致时操作失败，不进入安装。
4. commit 哈希与本地哈希不一致时操作失败，不进入安装。
5. 只有 `skills.install` 返回 `ok: true` 才显示安装成功；错误保留可重试状态。
6. 技能页提供 ZIP 选择、slug 编辑、显式替换勾选、阶段进度和错误提示，并在成功后重新
   读取 `skills.status`。
7. 未开启官方配置、旧 Gateway 不支持上传或管理员权限不足时，UI 显示真实错误，不静默
   回退到本地写入。
8. `features.methods` 的遗漏不阻止用户提交归档；Gateway 实际未知方法或权限拒绝时显示正式错误，
   不把发现信息转换成支持结论。

## 不在范围内

- 不实现上传取消、远端临时目录删除或本地 ZIP 内容解析。
- 不修改 OpenClaw 配置来自动开启归档安装策略。
- 不删除 `/skill-hub` 的 JunQi 本地符号链接功能。
- 不把 `skills.bins`、`skills.skillCard` 或技能提案协议当作归档上传的隐含能力。
