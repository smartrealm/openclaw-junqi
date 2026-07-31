# 会话渠道来源呈现记录

日期：2026-07-31

## 依据

- 当前安装的 OpenClaw 2026.7.1 官方会话工具文档说明，`sessions_list` 返回会话的 `channel`、`title`、`preview`、父子关系等结构化字段，旧状态可含 `origin`。
- 当前安装版本的渠道路由文档规定，外部渠道会话使用明确的渠道维度路由；同一会话可因 channel docking 改变回复目标。
- JunQi 的 `App.tsx` 已把 Gateway `sessions.list` 的 `channel`、`lastChannel` 和 `origin` 投影到 `Session`，不需要读取本机配置、分析会话 key 或从标题猜测。

## 当前行为

侧栏会话行先解析 Gateway 已返回的字段，优先顺序为 `channel`、`lastChannel`、`origin.provider`、`origin.surface`。有渠道来源时，主图标展示通用渠道图标，第二行同时展示渠道和 Agent 名称。没有结构化渠道来源时，保留原有 Agent 图标与名称。

当前 OpenClaw 会话与渠道目录契约没有提供可供桌面端使用的品牌图标字段。JunQi 不维护渠道 ID 到品牌的静态映射，以免在运行时插件、版本升级或不同 Gateway 环境中伪造渠道身份。所有渠道都使用通用会话图标，并展示 Gateway 返回的渠道标识。

## 明确边界

- 该行表示 Gateway 当前快照中的渠道来源字段，不声明它是跨 channel docking 后的实时回复目标。
- 会话 key、标题、消息内容、Agent 名称、当前机器配置和用户环境均不参与渠道识别。
- `origin.label` 不是渠道 ID，不作为识别输入。
- Gateway 缺少全部结构化渠道字段时，UI 不显示或伪造渠道来源。

## 自动化验证

- `src/utils/sessionChannelPresentation.test.ts` 覆盖优先级、origin 回退、未知渠道与禁止推断。
- 已执行 `pnpm exec tsx --test src/utils/sessionChannelPresentation.test.ts`。
- 已执行 `pnpm exec tsc --noEmit`。

## 未验证边界

- 尚未在 macOS、Windows 和 Linux 的真实 Gateway 上分别验证每一种官方渠道和运行时插件渠道的视觉呈现。
- Gateway 没有在当前会话列表快照中提供实时 reply route 时，侧栏不能也不会替代 `session_status` 进行推断。
