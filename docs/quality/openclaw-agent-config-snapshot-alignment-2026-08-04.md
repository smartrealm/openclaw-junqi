# OpenClaw Agent 配置快照与并发写入对齐

日期：2026-08-04

## 依据

本次审计以当前 OpenClaw 官方文档和源码为契约；已安装包仅可用于本地复现，不能作为能力开关。

- [Gateway configuration](https://docs.openclaw.ai/gateway/configuration) 要求工具先读取
  `config.get`，再以 `config.patch` 做局部更新；已有配置文件时必须把返回的 `hash` 作为
  `baseHash`。数组删除或整段替换才需要明确 `replacePaths`。
- [Gateway protocol](https://docs.openclaw.ai/gateway/protocol) 定义 `config.get` 返回当前磁盘
  快照与原始根文件 `hash`，并说明 `config.patch` 对按 `id` 的数组进行局部合并。
- [config handler](https://github.com/openclaw/openclaw/blob/main/src/gateway/server-methods/config.ts)
  验证：配置文件存在时，非 `ui.prefs` 写入缺少或不匹配 `baseHash` 会被拒绝；
  `agents.list` 走 id-keyed array merge，`replacePaths` 仅表示明确替换。
- [config snapshot](https://github.com/openclaw/openclaw/blob/main/src/config/types.openclaw.ts)
  定义 `exists`、`valid`、`config` 与可选 `hash`。没有配置文件时允许首次写入无 hash；
  无效配置的公开快照会被清空以避免泄露未脱敏内容。

## 审计结论

### P1：导入可在异常快照下提交全量 agents.list 替换

`src/pages/AgentHub/index.tsx` 的导入恢复逻辑将未知或缺失的 `config.agents.list` 视作空数组，
同时可省略 `baseHash`，并将该空列表与新条目作为 `replacePaths: ['agents.list']` 写回。若
Gateway 响应不完整、无效或跨连接失配，客户端会将不可信快照提升为明确替换意图。官方 Gateway
会为正常请求提供防护，但客户端不应依赖服务端拒绝来避免覆盖已有智能体。

### P1：有序 fallback 编辑可在缺少 hash 时替换列表

`AgentSettingsPanel` 将 `config.get` 强制转换为局部接口；缺少 `config`、`valid` 或 hash 时仍能
初始化状态。随后结构化模型更新可用空数组构造列表，并发送明确替换。该路径同样应在客户端失败
关闭，且只提交当前智能体的 id-keyed patch。

### P2：创建后补充配置与读取投影存在宽松 envelope 兼容

创建后的 skills/fallback 覆盖和 AgentHub 元数据读取接受 `config`、裸对象、`baseHash`、`hash`
等多种未声明形态。前者可能把并发冲突延后为 Gateway 拒绝，后者会在畸形响应时把已加载卡片元
数据覆盖为空。

### P2：计划工具设置保留未证明的快照别名

`OpenClawPlanToolSettings` 私有解析器接受 `resolved`、`sourceConfig` 与 `baseHash`。这些不是当前
`config.get` 的写入契约，扩展猜测会使未来协议漂移静默进入高权限配置路径。

## 目标行为

1. 所有本次范围内的 `config.get` 调用先通过同一个严格解析器：顶层必须为对象，`exists` 和
   `valid` 必须为布尔值且 `valid === true`，`config` 必须为对象；当 `exists === true` 时，
   非空 `hash` 为必需。
2. 仅 `exists === false` 可无 hash，保留 OpenClaw 首次创建配置文件的正式语义。客户端不猜测
   文件存在性，也不使用 `baseHash`、裸配置、`resolved` 或 `sourceConfig` 作为替代输入。
3. Agent 创建覆盖、分享导入和结构化模型编辑只发送单个 `agents.list` 条目；不发送整段列表，
   不声明 `replacePaths`，由 Gateway 的 id-keyed merge 和 hash CAS 维护并发安全。
4. 读取失败不清空当前 AgentHub 元数据；设置面板进入既有错误态并禁止保存。不会显示原始 Gateway
   快照或敏感字段。

## 验证结果

- `OpenClawConfigSnapshot.test.ts` 覆盖已有配置 hash、无配置文件首写，以及 malformed、invalid 和
  hashless existing snapshot 的失败关闭。
- Agent 创建覆盖、导入恢复、设置抽屉与计划工具设置的定向测试覆盖 hash CAS、单条目 patch、
  不使用 `agents.list` `replacePaths` 和首写无 hash。
- 已执行 `pnpm lint`、`pnpm test`、`pnpm build`、`pnpm verify:openclaw-docs` 和
  `git diff --check`，均通过。完整测试输出包含既有的 Radix SSR `useLayoutEffect` 警告，但没有失败。

## 未验证边界

自动化不能替代真实 Gateway 的权限拒绝、并发外部写入、配置 include 布局或 macOS、Windows、CentOS、
Ubuntu 的目标平台验收；本次不修改 Tauri、安装器或平台 API。
