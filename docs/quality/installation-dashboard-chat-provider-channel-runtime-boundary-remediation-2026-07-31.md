# 安装、仪表盘、聊天、模型与渠道运行时边界修复

日期：2026-07-31

## 范围与依据

本轮覆盖安装向导、Gateway 仪表盘、Chat、模型提供商和渠道设置之间的运行时状态边界。实现以仓库中已安装的 OpenClaw `2026.7.1` 契约、Tauri command 注册表和现有自动化测试为依据；不以浏览器缓存、静态模型目录或界面推断代替 Gateway 的权威状态。

## 修复内容

### 配置权威源和并发写入

- `read_config`、校验和写入统一解析 JSON5，并在 Rust 边界校验 OpenClaw 配置形状。
- 配置读取和写入只使用当前选定的 Native 或 Docker runtime 路径。写入携带内容 revision；检测到外部修改时返回明确冲突，不用过期页面覆盖磁盘内容。
- 前端不再在 localStorage 保留完整 OpenClaw 配置或可编辑配置路径。旧的本地配置备份键会被清除，避免把 provider 凭据带入浏览器持久存储。
- 共享配置类型移动到中立类型模块，Tauri 适配层不再依赖页面模块。

### 渠道和模型提供商

- 渠道保存采用按渠道和路由绑定分区的三方合并：未触碰的最新配置保持原样，同一路径的并发修改优先保留最新权威值，并在 revision 冲突后有限重试。
- `channels.defaults` 和 `channels.modelByChannel` 被识别为 OpenClaw 元数据，不能被渠道列表、启停或删除操作当作普通渠道处理。
- 提供商目录每次从当前 runtime 读取，不再跨 runtime 复用已缓存的模型目录；提供商验证候选文件在私有临时目录创建并在完成后删除。
- 删除不再可达的内置模型目录提示，避免在 Gateway 目录不可用时把应用静态目录描述为当前配置来源。

### 安装进度和仪表盘

- Setup 进度事件由 native operation ID 绑定到实际安装 future。重试或取消后，旧子进程的输出不会写入新操作。
- 前端只接受当前 operation ID 的进度事件；已过期事件会被丢弃。持久化诊断时间线在写入前执行脱敏。
- Gateway 数据轮询给每个数据组同时绑定当前请求和精确连接实例。断开连接或替换 Gateway 后，迟到结果不能覆盖新连接的数据。
- Gateway 连接开始时间集中存储，Dashboard uptime 只从该状态派生，不再随着组件重新挂载重置。

### Chat 工具执行和文件卡片

- 工具事件、`agent` item 和历史记录共享同一工具生命周期投影，保留上游提供的工具调用 ID、状态、错误、时间、耗时和输出截断元数据。
- 历史中的结构化 `toolResult` 读取实际 `result` 内容，不再把整个内容数组序列化为工具输出。
- Chat 追溯只展示显式给出的正式审核关联 ID；没有上游关联时维持 transcript-only 语义，不虚构审核人、决定或持久化记录。
- `MessageBubble` 委托单一的 `ChatMarkdownRenderer` 处理本地文件卡片，文件分类继续由共享 workspace file-kind 领域模块提供。

## 自动化验证

- `pnpm lint` 通过，模块边界检查覆盖 662 个文件。
- `pnpm test` 通过，1994 项前端和脚本测试全部成功。
- `cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib` 通过；Rust 库测试为 664 项通过、3 项显式忽略。
- `pnpm build` 的 provider catalog 生成、协作插件包和 TypeScript 子步骤通过；随后独立执行的 `pnpm exec vite build` 通过，转换 9006 个模块。
- `git diff --check` 在最终检查中执行。

## 未验证边界

- 未使用真实 Gateway、真实 provider 凭据或真实渠道账号完成端到端人工测试。
- 未在 Docker Desktop 冷启动、Windows 安装器/UAC、macOS 签名与 Keychain 环境进行真机验证。
- 未构建或签名发布安装包，本轮验证不等同于正式 Release。
