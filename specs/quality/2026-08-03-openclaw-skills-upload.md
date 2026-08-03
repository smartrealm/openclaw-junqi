# OpenClaw 技能归档上传规格

## 问题

技能页只能从 ClawHub 安装技能，无法把用户已有的 ZIP 技能归档交给当前选定的 OpenClaw Gateway。直接复用本地路径或 JunQi 旧的本地导入逻辑会绕过 Gateway workspace、安装策略和权限边界。

## 约束

- 以本机安装的 OpenClaw `2026.7.1-2` schema 和 handler 为协议依据。
- 只能使用 `skills.upload.begin`、`skills.upload.chunk`、`skills.upload.commit` 和 `skills.install(source: "upload")`；不得猜测取消或删除 RPC。
- 上传和安装是管理员操作，必须使用 `callPrivileged`。
- 归档内容只保留在浏览器内存和 Gateway 临时上传目录；不写入前端持久化、日志、测试快照或文档。
- 本地先计算 SHA-256，commit 和 install 都必须带同一哈希并校验回执。

## 验收条件

1. 空归档、超过 256 MiB 的归档、非法 slug 在发出 Gateway 请求前失败。
2. 上传块不超过 3 MiB，且每个后续 offset 等于 Gateway 上一次确认的 `receivedBytes`。
3. begin、chunk、commit 的 `uploadId` 和 `receivedBytes` 不一致时操作失败，不进入安装。
4. commit 哈希与本地哈希不一致时操作失败，不进入安装。
5. 只有 `skills.install` 返回 `ok: true` 才显示安装成功；返回错误时保留可重试状态。
6. 技能页提供 ZIP 选择、slug 编辑、显式替换勾选、阶段进度和错误提示，并在成功后重新读取 `skills.status`。
7. 旧 Gateway 不支持上传或未开启 `allowUploadedArchives` 时，UI 显示真实错误，不静默回退到本地写入。

## 不在范围内

- 不实现上传取消、远端临时目录删除或本地 ZIP 内容解析。
- 不修改 OpenClaw 配置来自动开启归档安装策略。
- 不删除 `/skill-hub` 的 JunQi 本地符号链接功能。
