# JunQi 统一文件预览呈现审计

日期：2026-08-05

## 结论

改动前，JunQi 复用了部分预览组件，但没有统一预览模型。本地工作区使用 `WorkspaceFilePreview`，聊天托管文件和会话 Artifact 使用 `ManagedFilePreview`，会话文件、Agent 工作区和 Agent 引导文件分别直接渲染 `img` 或 `pre`。这造成相同内容在不同入口呈现能力不一致。

本轮统一客户端呈现模型和容器，不合并读取权限。文件来源保留自己的授权、连接身份、路径和下载边界；客户端只接收已经成功读取的内容并按明确类型安全渲染。

## 入口与边界

| 入口 | 权威读取边界 | 本轮处理 |
| --- | --- | --- |
| 文件管理页与 Agent Workspace 本地工作台 | Tauri 工作区文件 IPC | 只读内容进入共享预览容器，文本编辑器保持原行为。 |
| 终端文件树 | 仅跳转至文件管理页 | 不新增读取或独立预览器。 |
| 聊天输出文件 | 受限本地托管文件读写与预览 URL | 继续使用现有加载器，改由共享容器呈现。 |
| 会话 Artifact | OpenClaw `artifacts.list/get/download` | Gateway 下载协议保持不变，已下载内容进入共享容器。 |
| 会话文件 | OpenClaw `sessions.files.list/get/set` | 只读内容进入共享容器；CAS 编辑资格和保存链路不变。 |
| Agent 工作区 | OpenClaw `agents.workspace.list/get` | Gateway 文本和常见 Base64 图片进入共享容器，不暴露主机路径。 |
| Agent 引导文件 | OpenClaw `agents.files.list/get` | Gateway 文本进入共享容器，不接入 `agents.files.set`。 |
| 聊天图片、输入附件和消息内联 Artifact | 消息内容或输入内存状态 | 不属于可寻址文件预览，保留灯箱、缩略图或 iframe 交互。 |

## 官方依据

本机官方 OpenClaw 源码工作树 `https://github.com/openclaw/openclaw.git` 的 `main` 分支在审计时干净，以下源码可复现本轮边界：

- `docs/gateway/protocol.md` 说明 `agents.workspace.list/get` 是只读、工作区相对路径受限且仅返回 UTF-8 文本或常见 Base64 图片的接口；该命名空间没有写入方法。
- `packages/gateway-protocol/src/schema/sessions.ts` 定义 `sessions.files.list/get/set`；`set` 是独立的 operator-admin CAS 写入。
- `packages/gateway-protocol/src/schema/artifacts.ts` 定义由 Gateway 决定的下载模式。
- `src/gateway/methods/core-descriptors.ts` 定义各方法的 operator scope。

## Orca 对照

Orca 的可迁移部分是“多入口汇聚到一个文件身份、读取结果和渲染分派器”，不是把其 Electron IPC、远程工作区模型或浏览器预览机制复制到 JunQi。JunQi 不具备也不伪造 Orca 的 SSH 工作区身份；本轮只在已有 OpenClaw 和 Tauri 契约之上统一呈现。

## 验证

2026-08-05 在本机执行并通过：

- `pnpm lint`：模块边界、版本一致性和 TypeScript 检查通过。
- `pnpm test`：完整前端和脚本测试通过。测试运行中保留既有的 React SSR `useLayoutEffect` 警告，未新增失败。
- `pnpm verify:openclaw-docs`：OpenClaw 官方命令文档链接验证通过。
- `pnpm build`：协作插件契约、TypeScript 和 Vite 生产构建通过。
- 预览专项回归：共享内容转换、Gateway MIME 拒绝、HTML sandbox、托管文件、Agent 工作区与引导文件入口均通过。
- `git diff --check`：通过。

未执行 Rust 测试或 Tauri 打包，因为本轮没有修改 Rust、Tauri command、安装器或原生资源。未执行真实 Gateway、Windows、CentOS、Ubuntu 和 macOS 的媒体、PDF 及 Office 文件真机验收；这些平台行为仍保持待验证状态。
