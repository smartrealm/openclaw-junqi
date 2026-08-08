# OpenClaw 模型目录权威性审计

日期：2026-08-04

## 权威依据

- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 与 OpenClaw 官方源码
  `packages/gateway-protocol/src/schema/agents-models-skills.ts` 定义 `models.list` 为运行时模型目录；
  `view: "configured"` 是当前已配置模型的精简视图。
- 官方 `src/gateway/server-methods/models.ts` 经 `buildModelsListResult` 生成条目；可选模型必须以
  `available: true` 作为 Gateway 的实时可用性证据。
- 官方 Control UI 与 JunQi 的会话模型选择都只投影 `models.list` 响应中的 `models` 数组，不以
  `config.get`、本地文件或会话记录补充模型选择器。

## 审计范围

审查 `App.tsx` 的 `loadAvailableModels`、`modelLoaders.ts`、`modelCatalog.ts`、Provider 编辑页的
`providerGatewayCatalog.ts`，以及 `availableModels` 在会话模型选择、Dashboard 与业务引导中的消费方式。

## 发现

### MCA-01 高：权威空目录继续回退为本地推断目录

原调用链在 `models.list { view: "configured" }` 返回空数组或没有可用条目时，继续读取
`config.get`、选定 runtime 配置文件、生成的 provider catalog 和 `agents.list` / `sessions.list`。
这些来源最多描述配置或历史使用，不能证明模型此刻通过 Gateway 的运行时策略和认证检查。

后果是 `availableModels` 中可能出现 Gateway 已标记不可用、未授权或未列入当前 picker 的条目，
并被会话模型选择器作为可选操作呈现。

### MCA-02 中：Provider 编辑页采用宽松的独立解码

Provider 编辑页曾接受字符串、任意对象字段及未标记可用的 `models.list` 条目。这会让配置编辑页展示
未获得 Gateway 当前可用性证据的模型，且与会话模型选择器的严格投影产生分歧。

现改为复用 `modelCatalog.ts` 的严格解码，再派生 Provider 所需的 `id`、Provider、别名和图像能力字段。
无效 envelope、字符串、不可用条目与缺少协议 `id` 的条目均不进入编辑页。

## 目标行为

1. 会话模型选择器只调用 `models.list { view: "configured" }`。
2. 只有结构正确且明确 `available: true` 的 Gateway 条目能进入 `availableModels`。
3. 调用失败、响应结构不合法或权威目录为空时，结果保持为空；不以本地配置、静态生成目录、
   agent 或 session 历史补充可选模型。
4. 配置页的编辑目录和本地 provider 健康提示保持原有职责，不能反向成为会话运行时能力来源。
5. Provider 编辑页读取 Gateway 目录时与会话模型选择器使用同一严格可用性投影。

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
