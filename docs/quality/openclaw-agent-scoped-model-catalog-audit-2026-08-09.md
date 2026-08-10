# OpenClaw 智能体作用域模型目录审计

日期：2026-08-09

## 依据

最新版 OpenClaw 的 `models.list` 请求没有 `agentId`，服务端按默认智能体解析。`chat.metadata` 接受必填语义的 `agentId`，并返回该智能体已准备认证与模型目录投影。官方 Control UI 对选定智能体读取模型时使用 `chat.metadata`。

## 审计结论

JunQi 曾把 `models.list { view: "configured" }` 的默认智能体目录复用到所有会话模型选择器。非默认智能体拥有独立认证目录时，该投影可能允许用户选择其无权使用的模型。

## 目标行为

- 默认通用目录仍仅来自 `models.list { view: "configured" }`。
- 会话运行时模型选择器仅使用 `chat.metadata { agentId }` 返回的当前会话智能体目录。
- 元数据缺失、连接切换或不支持时不回退展示默认智能体模型。
- 目录缓存是按智能体划分的 Gateway 派生状态，不是本地模型能力声明。
- Provider 页将显示 Gateway 已确认的智能体选择器；认证状态、实时验证和注销分别调用
  `models.authStatus`、`models.probe`、`models.authLogout` 并显式携带该 `agentId`。

## 验证范围

自动化覆盖官方请求参数、回包失败关闭、作用域目录选择和断线清空。真实多智能体 Gateway 的私有认证与桌面交互仍需真机验收。

## 实施与验证

- `modelLoaders.ts` 新增受约束的 `chat.metadata` 读取，只接受结构化 `models` 数组；缺少目录、空
  智能体、请求失败和畸形回包都返回空目录。
- `chatStore` 以 `agentId` 分区保存会话模型目录和加载状态；断开连接或目标智能体未知时清空，不能跨
  Gateway 或跨智能体复用。
- 会话运行时模型控件及会话输入的 Provider 缺失提示只读取当前会话智能体目录。默认通用目录仍留给
  未选择会话智能体的 Provider 与智能体配置页面，不再用于会话模型选择。
- 通过 75 项模型目录、运行时控件和 ChatStore 定向回归、完整 `pnpm test`、`pnpm lint` 与生产
  `pnpm build`。尚未进行真实多智能体 Gateway 与 macOS、Windows、Linux Tauri 窗口验收。
- 本轮发现 Provider 页先前遗漏 `agentId`，会将所有认证状态、实时验证和注销隐式落到默认智能体。
  已改为从 Gateway 智能体快照选择目标，按目标调用三项官方 RPC；验证结果以 `agentId:provider`
  作用域保存，切换智能体后不会展示旧智能体结果。模型认证客户端与 Provider 状态组件定向回归
  14 项、`pnpm lint` 均通过；真实多智能体 Gateway 与桌面窗口验收仍未完成。
