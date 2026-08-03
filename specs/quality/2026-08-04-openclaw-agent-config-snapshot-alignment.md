# OpenClaw Agent 配置快照与并发写入对齐

## 目标

让 JunQi AgentHub 的配置读取和写入严格遵循当前 OpenClaw `config.get` / `config.patch` 协议。
客户端必须在解析异常快照时失败关闭，并将 Agent 变更表达为按 id 合并的最小 patch，不能把
不可信空数组升级为 `agents.list` 整表替换。

## 约束

- 以当前 OpenClaw Gateway configuration 文档、Gateway protocol、`server-methods/config.ts`、
  `config/types.openclaw.ts` 为契约；安装版本只用于复现，不是版本门禁。
- `config.get` 只接受官方 envelope：对象 `exists`、`valid`、对象 `config`、可选字符串 `hash`。
  `valid !== true`、结构缺失、`exists === true` 且 hash 缺失都必须报错。
- `exists === false` 是唯一允许 hash 缺失的情形，以支持 OpenClaw 没有配置文件时的首次写入。
- 已有配置写入必须发送 `baseHash: snapshot.hash`；不得使用 `baseHash` 响应字段、裸 config、
  `resolved`、`sourceConfig` 或猜测性别名。
- 对单个 Agent 的创建补充、导入和 fallback 更新只发送
  `{ agents: { list: [entry] } }`。不得使用 `replacePaths`，不得因本地 UI 缓存发送或替换完整列表。
- 读取投影的异常响应不得清空已加载状态；设置抽屉在配置失败时禁止保存，错误不泄露原始响应。
- 本地业务画像保持 JunQi 本地存储，不能通过 OpenClaw `config.patch` 传输。

## 验收条件

1. 有一个可复用、经过单元测试的严格 `config.get` 快照解析器，被 AgentHub 与计划工具设置共同使用。
2. 创建覆盖、导入和结构化 fallback 三条路径均发送单条目 id-keyed patch；存在配置时均携带
   返回的 `hash` 作为 `baseHash`。
3. 无效、缺失、裸对象、缺 hash 的已有配置快照不会触发 privileged patch，也不会清空已读取元数据。
4. 无配置文件的有效首次写入没有虚构 hash，仍可提交最小 Agent patch。
5. 现有模型、skills、导入去重和本地画像行为不回退，TypeScript、边界检查和相关回归测试通过。

## 不在范围内

- 修改 OpenClaw 配置 schema、Gateway 写入实现、`agents.create` / `agents.update` RPC 或服务端错误文本。
- 全配置编辑器、配置迁移、自动重试冲突、跨设备同步、Tauri IPC 或目标平台实机测试。
