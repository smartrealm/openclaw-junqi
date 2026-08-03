# OpenClaw 模型目录权威性审计

日期：2026-08-04

## 权威依据

- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 与本仓库安装的
  `node_modules/.pnpm/openclaw@2026.7.1-2/node_modules/openclaw/docs/gateway/protocol.md`
  均定义 `models.list` 为运行时允许的模型目录；`view: "configured"` 是普通模型选择器使用的
  精简视图。
- 同一安装包的 `dist/models-list-result-*.js` 先应用当前配置、模型可见性、运行时 provider
  与只读认证可用性，再为公开条目生成 `available`。
- 同一安装包的 `dist/gateway-chat-*.js` 的 `listModels()` 只返回 `models.list` 响应中的
  `models` 数组，不以 `config.get`、本地文件或会话记录补充模型选择器。

## 审计范围

审查 `App.tsx` 的 `loadAvailableModels`、`modelLoaders.ts`、`modelCatalog.ts`，以及
`availableModels` 在会话模型选择、Dashboard 与业务引导中的消费方式。

## 发现

### MCA-01 高：权威空目录继续回退为本地推断目录

原调用链在 `models.list { view: "configured" }` 返回空数组或没有可用条目时，继续读取
`config.get`、选定 runtime 配置文件、生成的 provider catalog 和 `agents.list` / `sessions.list`。
这些来源最多描述配置或历史使用，不能证明模型此刻通过 Gateway 的运行时策略和认证检查。

后果是 `availableModels` 中可能出现 Gateway 已标记不可用、未授权或未列入当前 picker 的条目，
并被会话模型选择器作为可选操作呈现。

## 目标行为

1. 会话模型选择器只调用 `models.list { view: "configured" }`。
2. 只有结构正确且明确 `available: true` 的 Gateway 条目能进入 `availableModels`。
3. 调用失败、响应结构不合法或权威目录为空时，结果保持为空；不以本地配置、静态生成目录、
   agent 或 session 历史补充可选模型。
4. 配置页的编辑目录和本地 provider 健康提示保持原有职责，不能反向成为会话运行时能力来源。

## 未验证边界

- 自动化验证的是当前安装 OpenClaw 的协议和 JunQi 的 fail-closed 投影；未连接真实 Gateway
  验证 provider 认证变化、动态发现和外部 runtime 的实际刷新时序。
- 目标平台的真实 Gateway 仍需在 macOS、Windows、CentOS、Ubuntu 分别验收。

## 验证结果

- 定向执行 `pnpm exec tsc --noEmit` 及模型、会话模型选择相关 30 项回归测试，全部通过。
- 回归覆盖官方请求参数、空结果、无效 envelope、请求失败、不可用条目、缺少可用性证据和
  明确可用条目的投影。
- 已通过 `pnpm lint`、`pnpm test`（2,663 项前端测试与 245 项脚本测试）、`pnpm build`、
  `pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate` 与
  `git diff --check`。
