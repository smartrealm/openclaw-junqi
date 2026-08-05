# 统一文件预览呈现实施计划

日期：2026-08-05

1. [x] 审计 JunQi 全部文件和内容预览入口，区分本地工作区、托管文件、Gateway 会话文件、Agent 工作区、引导文件与 Artifact。
2. [x] 核对 OpenClaw 官方 `sessions.files.*`、`agents.workspace.*`、`agents.files.*` 和 `artifacts.*` schema、handler、权限与路径边界。
3. [x] 定义与来源无关的预览内容判别模型，并提供来自现有受限响应的纯转换函数。
4. [x] 抽取共享预览渲染容器，保持 HTML sandbox、PDF、Markdown 本地链接和外部打开能力。
5. [x] 将本地只读预览、会话文件只读模式、Agent 工作区、Agent 引导文件接入共享容器；保持会话 CAS 编辑器和聊天媒体灯箱原样。
6. [x] 补齐单元和入口回归测试，运行 TypeScript、Rust、文档与构建验证，并记录结果。
