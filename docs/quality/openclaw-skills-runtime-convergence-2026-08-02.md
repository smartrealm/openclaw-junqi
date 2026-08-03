# OpenClaw 技能运行时出口收敛

## 依据

本机已安装 OpenClaw `2026.7.1-2`。其 `docs/gateway/protocol.md` 与
`dist/schema-DtyqV_v0.d.ts` 定义了以下契约：

- `skills.status`、`skills.search`、`skills.detail` 是 `operator.read` 操作；
- `skills.update` 与 `skills.install` 是 `operator.admin` 操作；
- `skills.update` 的配置模式只接受 `skillKey`、`enabled`、`apiKey` 与 `env`；
- `skills.install` 的 ClawHub 模式只接受 `source: "clawhub"`、`slug`、可选版本、强制安装与风险确认字段；
- 在本记录基线版本中没有技能删除、目录导入、ZIP 导入、SkillHub CLI 安装或 ClawHub 登录 command；当前版本的官方 ZIP 归档上传已在独立记录中补齐。

## 原问题

`SkillsPage` 同时混合 Gateway RPC、浏览器 HTTP 和 `window.aegis` 兼容接口。后者在
Tauri adapter 中固定返回失败或空结果，但页面仍向用户显示导入、删除、SkillHub CLI
和 ClawHub CLI 操作。侧栏、Agent 页面、会话输入与技能页又各自解析
`skills.status` 并直接调用 `skills.update`，管理员权限与字段约束无法统一。

## 当前实现

- `src/services/openclawSkillsRuntime.ts` 是 Gateway 技能域唯一运行时出口。它校验输入、
  解析当前协议的 status/search/detail 返回，并让所有变更经 `callPrivileged` 发出。
- `src/stores/skillsStore.ts` 复用该服务，供侧栏、Agent 页面和会话输入使用。
- `src/pages/SkillsPage/index.tsx` 缩分为已安装技能和 Gateway 目录两个视图，只提供
  OpenClaw 已声明的启停、搜索、详情和安装能力。
- `src/api/tauri-adapter.ts` 与 `src/types/global.d.ts` 删除了固定失败的 skills、
  skillshub、clawhub adapter 声明。
- `/skill-hub` 保留为 JunQi 本地目录与项目符号链接工具，不成为 Gateway 技能安装的
  伪替代品。

## 验证

- `openclawSkillsRuntime.test.ts` 覆盖协议字段解析、异常条目拒绝和管理员变更出口。
- `SkillsPage/components.test.ts` 通过。
- `pnpm exec tsc --noEmit` 与 `git diff --check` 通过。

## 后续归档上传增量

2026-08-03 已在独立记录 [`OpenClaw 技能归档上传能力对齐`](openclaw-skills-upload-parity-2026-08-03.md)
接入当前 OpenClaw 版本的 `skills.upload.*` 与 `skills.install(source: "upload")`。本文描述的
status/search/detail/update/install 运行时出口仍然有效；ZIP 归档上传的哈希、分块、策略门禁和
未实现的远端删除边界以新记录为准。

## 未验证边界

尚未对当前运行中的 Gateway 执行目录搜索、ClawHub 详情或实际安装操作。桌面真机仍需
验证管理员配对、网络失败、风险确认和安装后技能状态刷新；这些结果不能由本机协议源码
或单元测试替代。
