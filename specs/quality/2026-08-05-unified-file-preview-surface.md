# 统一文件预览呈现规格

日期：2026-08-05

## 目标

JunQi 为已经由各自权威边界读取完成的文件内容提供同一个类型判别模型和渲染容器。用户在本地工作区、聊天输出、会话产物、Agent 工作区和 Agent 引导文件中看到相同的文本、Markdown、JSON、图片和 PDF 呈现规则。

## 约束

1. 统一的是客户端呈现层，不是文件读取权限。各入口继续使用既有的 Tauri 工作区 IPC、受限本地预览 URL、`agents.workspace.*`、`agents.files.*` 或 `artifacts.*` 契约。
2. 不把 Gateway 返回的相对路径、Agent 工作区路径、Artifact URL 或会话根目录转换为本机路径，也不将它们导入本地文件管理器。
3. Gateway Base64 图片必须具有明确的图片 MIME 类型。未声明或不支持的二进制内容显示不可预览状态，不能作为 data URL 注入页面。
4. HTML 继续使用现有 iframe sandbox 规则；Gateway Artifact 的下载和 URL 仍由 Gateway 权威决定。不得为统一外观而放宽脚本、路径、下载或网络访问权限。
5. 消息内联 Artifact、聊天图片灯箱和输入附件缩略图不是可寻址的文件读取入口，保持各自交互，不伪装为工作区文件。

## 验收条件

- 共享模型能表达文本、Markdown、JSON、静态或交互 HTML、图片、音频、视频、URL 或 Base64 PDF，以及不可预览二进制。
- 本地工作区的只读图片和 PDF、聊天输出与会话 Artifact 使用同一个渲染容器。
- Agent 工作区文本和图片、Agent 引导文件文本使用同一个渲染容器，且不新增 Gateway 请求、写入或本地路径访问。
- 测试覆盖转换模型、未知 MIME 拒绝、各入口接入和已有文件预览回归。
- 文档记录 OpenClaw 官方契约、自动化验证与目标平台未验证边界。

## 官方依据

- OpenClaw `docs/gateway/protocol.md`：`agents.workspace.list/get` 仅返回受限的 UTF-8 文本或常见 Base64 图片，且没有写入方法。
- OpenClaw `packages/gateway-protocol/src/schema/artifacts.ts`：Artifact 下载模式由 Gateway 返回的 `bytes`、安全 URL 或 `unsupported` 结果决定。
- OpenClaw `src/gateway/methods/core-descriptors.ts`：上述方法的 operator scope 定义。

## 未验证边界

真实 Gateway、远程执行节点及 macOS、Windows、CentOS、Ubuntu 上的媒体、PDF 和 Office 文件渲染仍需真机验收。自动化测试只验证 JunQi 的类型、权限与组件连接边界。
