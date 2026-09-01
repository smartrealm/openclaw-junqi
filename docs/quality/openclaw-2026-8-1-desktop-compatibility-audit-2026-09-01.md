# OpenClaw 2026.8.1 桌面兼容与交互审计

日期：2026-09-01

## 审计目标

本审计核对 JunQi Desktop 与 OpenClaw `v2026.8.1` 的插件、Gateway 协议和会话交互边界。依据为已更新的 OpenClaw 官方仓库 tag `v2026.8.1`、官方发布说明、官方容器包记录，以及本仓库受版本控制的源码和测试。代理所在机器的已安装 OpenClaw、Node.js、包管理器、运行进程和用户配置不作为事实依据。

官方基线：

- tag：`v2026.8.1`
- commit：`ea806575e6450e4d1efdfc72c19f04be982a1b9b`
- npm 包版本：`2026.8.1`
- Node.js 约束：`>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`
- 官方容器清单：`ghcr.io/openclaw/openclaw:2026.8.1@sha256:e7849cb6c1ef1ead39ab4be7d85edb2df89611f486e283284c7cf35ce39a20d4`

## 结论

JunQi 已有会话发送、停止、队列模式、会话分支、持久进度卡和插件固定包等基础能力，但不能仅凭宽泛的 peer range 宣称完成 2026.8.1 兼容。当前存在两个高优先级闭环缺口和一个升级边界要求：

| 编号 | 级别 | 根因 | 影响 |
| --- | --- | --- | --- |
| OC2-01 | 高 | 两个内置插件曾允许低于当前 SDK 基线的 Gateway | 新 Gateway 会加载未经当前协议编译和验证的旧契约插件 |
| OC2-02 | 高 | `question.requested` 与 `question.resolved` 没有桌面消费者，且主连接不持有 `operator.questions` | Agent 等待人工输入时，用户看不到问题，也无法回答或跳过 |
| OC2-03 | 中 | 2.0 删除旧 SDK 根入口并要求官方 Doctor 处理部分路由迁移 | 客户端若自行改写配置或根据版本猜测能力，会越过 OpenClaw 权威边界 |

## 官方契约核对

### 插件 SDK

OpenClaw 2.0 删除 `openclaw/plugin-sdk`、`openclaw/plugin-sdk/compat` 和 `openclaw/extension-api` 等宽入口。JunQi 两个插件继续使用 `plugin-entry`、`runtime-store` 与 `session-transcript-runtime` 等官方聚焦 subpath。`session-transcript-runtime` 的 JavaScript subpath 和所用 helper 均存在于正式 tag，但发布包明确排除了该 subpath 的入口声明文件；JunQi 只为当前实际调用补充与官方源码签名一致的类型声明，不复制运行逻辑，也不导入未公开的散列构建文件。

因此正确修复是把编译和验证基线升级到 2026.8.1，并保留真实的最低兼容范围；不是无依据替换现有聚焦导入，也不是新增 SDK fallback。

### 结构化提问

官方协议定义：

- RPC：`question.list`、`question.get`、`question.resolve`
- 事件：`question.requested`、`question.resolved`
- 每个请求包含一至三个问题，每问最多四个选项
- 支持单选、多选、自定义答案、取消和超时
- 所有 `question.*` RPC 要求 `operator.questions`
- 普通问题还受 Session 可见性和变更授权约束
- 创建绑定密钥存储的问题由 Gateway 额外强制 `operator.admin` 与可信 Agent 运行身份；桌面端回答只需要 `operator.questions` 和对应 Session 访问权
- 密钥值只在 `question.resolve` 请求边界出现，Gateway 写入密钥存储后只广播合成结果

官方客户端指南要求能处理交互问题的客户端在主连接增加 `operator.questions`。JunQi 因此通过已完成身份核验的主 Gateway 连接接收事件、断线恢复列表、回答与跳过，不维护第二条问题 socket、重试器或权限状态机。绑定密钥存储的问题也不为回答额外申请管理员权限；密钥答案只能保留在问题组件内存中，不能进入 Zustand、日志、前端持久化或消息 transcript。

### 持久进度卡与其他 2.0 功能

JunQi 已通过 `progressCard.get`、`progressCard.changed` 和会话级 revision 投影持久进度卡，本次不创建第二套进度状态。会话分支和队列交互也已有官方 RPC 支撑，继续按现有实现验证，不复制官方控制台组件。

官方发布中的原生小组件、移动端能力、云服务能力和实验性能力不自动成为 JunQi 功能。只有存在桌面可用的正式 Gateway 契约时才进入实现。OpenClaw 同时定义 Agent 工具 `sessions_search` 和只读 Gateway RPC `sessions.search`；JunQi 已通过 `OpenClawSessionSearchClient` 使用后者并在会话管理页呈现真实结果，不将 Agent 工具名伪装成桌面 RPC。

### 2.0 升级

官方发布说明要求旧 `codex/*` 与 `openai-codex/*` 路由通过 `openclaw doctor --fix` 迁移。JunQi 只呈现结构化诊断和官方修复入口，不自行扫描、猜测或改写用户配置，也不把版本号当作能力开关。

## 目标调用链

```text
OpenClaw Agent
  -> question.request
  -> Gateway question.requested
  -> 持有 operator.questions 的主 Gateway 连接
  -> JunQi 问题投影
  -> 主会话或 Quick Chat 输入区上方问题卡
  -> 展开时替换输入框，折叠时恢复输入框
  -> 普通问题和密钥问题均使用 operator.questions 提交
  -> question.resolve
  -> Gateway 权限、Session 与密钥存储核验
  -> question.resolved
  -> JunQi 原子移除待答卡片
```

## 删除与保留

- 主连接只增加官方客户端指南要求的 `operator.questions`，不为回答问题申请 `operator.admin`。
- 不保留旧插件 API 的编译双轨或镜像 fallback。
- 不维护问题专属的并行 socket、重试器或权限恢复状态机。
- 不通过聊天文本模拟问题。
- 不把问题答案写入消息或本地 checkpoint。
- 不重复实现现有进度卡、会话分支或队列状态。
- 保留现有正式 `sessions.search` 会话检索，不创建 `sessions_search` 别名或本地搜索结果。
- 插件包只声明当前已编译和验证的 OpenClaw 2.0 契约下限；普通客户端测试中的版本样例不作为能力开关。

## 验证边界

自动化需要覆盖协议解析、主连接 scope、事件路由、断线刷新、Session 过滤、提交竞态、密钥不落全局状态和输入法组合。真实 Gateway 容器验证必须使用官方不可变 digest。亮色、暗色、窄窗口、展开与折叠序列和真实密钥提问仍需在目标 Tauri 客户端连续验证，不能由静态截图替代。
