# 新手引导编排重构记录

日期：2026-08-05
状态：自动化验证完成，待桌面真机验收

> 2026-08-09 复审：原“三重完成门禁”中的客户端实时模型门禁已删除。当前首次安装完成条件为选定
> Gateway 的认证连接与官方 `openclaw.setup.detect.setupComplete`；模型实时验证遵循官方 Wizard 内的
> 跳过和继续语义。

## 审查结论

本轮审查覆盖 Setup Page、`useSetupFlow`、Native/Docker 安装器、Gateway 生命周期、OpenClaw Wizard 客户端、首次工作区门禁，以及官方 OpenClaw 当前源码和文档。

确认的问题是状态归属与呈现语义不一致，而非单个页面的样式缺陷：同一用户动作可同时受导航历史、异步安装、Gateway 连接和 Wizard 本地恢复影响。重构以 `specs/installation/2026-08-05-onboarding-orchestration-redesign.md` 为验收依据。

## 实施边界

- 保留 OpenClaw 官方 Wizard RPC 作为唯一配置流程来源。
- 保留选定 Gateway 的认证连接与官方配置终态门禁，不在客户端追加实时模型门禁。
- 仅通过 Tauri API 与 Shell 进行桌面系统集成；不启动或依赖浏览器版 JunQi。
- Node、Git、Docker、系统服务和外部授权的实际可用性继续由 Rust 探测、官方 Gateway 或用户选择决定。

## 验证记录

已执行并通过：

- 引导、Wizard 会话、萌宠与步骤条定向行为测试，共 91 项。
- `pnpm lint`，包含模块边界、版本一致性和 TypeScript 检查。
- `pnpm test`。
- `pnpm build`，包含协作插件契约校验、TypeScript 编译与 Vite 生产资源构建。
- `pnpm verify:openclaw-docs`，已核对当前官方 OpenClaw 协议文档链接。

未执行：

- 未改动 Rust 源码，因此未重复执行 Rust 单元测试与 `cargo check --lib`。
- 未在 macOS、Windows、Linux 真机完成首次安装、服务交接、Native/Docker 切换和官方 Wizard 的交互验收。
- 未启动浏览器版 JunQi；本轮实现与验证面向 Tauri Desktop。
