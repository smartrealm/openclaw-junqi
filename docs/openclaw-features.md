# OpenClaw 功能特性分析

## 概述

OpenClaw 是一个在用户自己设备上运行的个人 AI 助手系统，支持多渠道接入、工具扩展和自动化编排。本文档基于 OpenClaw 官方源码仓库分析其核心功能特性。

## 证据边界

本文是基于本地 OpenClaw 源码快照的分析文档，不是最新版官方文档、协议 schema 或 handler 的替代品。文中
命令、数量、渠道、插件、节点、自动化和遥测描述没有在本次合并前逐项绑定到官方永久链接、源码提交或当前
安装版本；所有可能变化的内容均为待核验线索，不得直接作为 JunQi 的功能契约、可用性承诺或 UI 入口依据。

JunQi 仍必须遵守根目录 `AGENTS.md` 的 OpenClaw 边界：无法取得权威依据的能力保持未知或待验证，停止推断性实现。

---

## 一、核心架构组件

### 系统组成

- **Gateway**：本地控制面板，管理 sessions、tools、events、channel connections
- **Control UI**：Web 控制台，连接到 Gateway
- **CLI / TUI**：命令行和终端用户界面
- **Channels**：40+ 消息服务集成（WhatsApp、Telegram、Slack、Discord 等）
- **Companion apps and nodes**：伴侣应用和节点（voice、Canvas、camera、screen、device-local actions）
- **Model providers**：支持托管和本地模型
- **Tools, Skills, Plugins**：扩展助手能力的工具、技能和插件系统

### 运行模式

- **Native 模式**：直接在宿主系统上运行
- **Container 模式**：通过 Docker 容器运行（使用 `--container` 标志）
- **Node 模式**：作为伴侣设备连接到主 Gateway（macOS/iOS/watchOS/Android/headless）

---

## 二、CLI 命令体系（67个命令）

### 1. Setup and onboarding（设置与入门）

- `openclaw`：主入口命令
- `setup`：初始化设置向导
- `onboard`：用户引导流程
- `configure`：配置管理
- `config`：配置查看和修改
- `completion`：Shell 自动补全
- `doctor`：系统健康检查
- `dashboard`：启动控制台

### 2. Reset, backup, and migration（重置、备份与迁移）

- `backup`：备份数据
- `migrate`：迁移数据
- `reset`：重置系统
- `uninstall`：卸载
- `update`：更新版本

### 3. Messaging and agents（消息与智能体）

- `message`：发送消息
- `agent`：智能体管理
- `agents`：列出智能体
- `attach`：附加文件
- `acp`：Agent Context Protocol
- `mcp`：Model Context Protocol

### 4. Health and sessions（健康检查与会话）

- `status`：系统状态
- `health`：健康检查
- `sessions`：会话管理
- `audit`：审计日志

### 5. Gateway and logs（网关与日志）

- `gateway`：网关控制
- `logs`：日志查看
- `system`：系统信息

### 6. Models and inference（模型与推理）

- `models`：模型管理
- `promos`：促销和额度
- `infer`：推理调用
- `capability`：能力查询
- `memory`：记忆管理
- `commitments`：承诺和约束
- `wiki`：知识库

### 7. Network and nodes（网络与节点）

- `directory`：目录服务
- `nodes`：节点管理
- `devices`：设备管理
- `node`：节点命令
- `worker`：工作节点

### 8. Runtime and sandbox（运行时与沙箱）

- `approvals`：审批管理
- `exec-policy`：执行策略
- `sandbox`：沙箱环境
- `tui`：终端UI
- `chat`：聊天界面
- `terminal`：终端控制
- `browser`：浏览器集成

### 9. Automation（自动化）

- `cron`：定时任务
- `tasks`：任务管理
- `hooks`：钩子管理
- `webhooks`：Webhook 集成
- `transcripts`：会话记录

### 10. Discovery and docs（发现与文档）

- `dns`：DNS 服务
- `docs`：文档查看

### 11. Pairing and channels（配对与渠道）

- `pairing`：设备配对
- `qr`：二维码生成
- `channels`：渠道管理

### 12. Security and plugins（安全与插件）

- `security`：安全管理
- `secrets`：凭据管理
- `skills`：技能管理
- `plugins`：插件管理
- `proxy`：代理配置

### 全局标志

- `--dev`：开发模式
- `--profile <name>`：配置文件
- `--container`：容器模式
- `--log-level <level>`：日志级别
- `--no-color`：禁用颜色
- `--update`：检查更新
- `-V` / `-v` / `--version`：版本信息

---

## 三、渠道集成（40+ 消息平台）

### 即时通讯

- WhatsApp
- Telegram
- Signal
- Discord
- Slack
- Matrix
- WeChat（微信）
- WeCom（企业微信）
- Feishu（飞书）
- DingTalk（钉钉）
- QQBot
- Zalo

### 企业协作

- Microsoft Teams
- Synology Chat
- Tlon

### 社交媒体

- Twitch
- Nostr

### 通信协议

- SMS（短信）
- Email（邮件）
- iMessage

### 文档说明

- 共计 67 个渠道文档（`docs/channels/` 目录）
- 每个渠道支持配置、认证、消息收发和事件处理

---

## 四、工具、技能与插件系统

### 工具（Tools）

- **文档数量**：67 个工具文档（`docs/tools/` 目录）
- **核心类别**：
  - 文件系统操作
  - 网络请求
  - 代码执行
  - 数据库访问
  - API 调用
  - 系统命令
  - 搜索和索引

### 技能（Skills）

- **定义**：教会智能体如何工作的指令集
- **作用**：提供任务模板、工作流程和最佳实践
- **集成**：可打包到插件中作为 packaged skills

### 插件（Plugins）

- **文档数量**：59 个插件文档（`docs/plugins/` 目录）
- **能力类型**：
  - Text inference（文本推理）
  - CLI inference backend（CLI 推理后端）
  - Embeddings（嵌入向量）
  - Channel plugins（渠道插件）
  - Provider plugins（模型提供者插件）
  - Tool plugins（工具插件）

- **注册方法**：
  ```typescript
  api.registerProvider(...)           // 文本推理
  api.registerCliBackend(...)         // CLI 后端
  api.registerEmbeddingProvider(...)  // 嵌入向量
  api.registerChannel(...)            // 渠道
  api.registerTool(...)               // 工具
  ```

- **插件架构**：
  - 基于能力模型（capability model）
  - 所有权边界（ownership boundaries）
  - 加载管道（load pipeline）
  - 运行时辅助（runtime helpers）

---

## 五、节点与伴侣应用（Nodes and Companion Apps）

### 节点定义

节点是连接到 Gateway 的伴侣设备（macOS/iOS/watchOS/Android/headless），通过 `role: "node"` 身份暴露命令接口。

### 节点能力

- **Canvas**：画布操作（`canvas.*` 命令）
- **Camera**：摄像头访问（`camera.*` 命令）
- **Screen**：屏幕控制（`screen.*` 命令）
- **Device**：设备操作（`device.*` 命令）
- **Notifications**：通知管理（`notifications.*` 命令）
- **System**：系统命令（`system.*` 命令）

### 连接协议

- **主协议**：Gateway WebSocket（operator port）
- **Apple Watch 专用**：签名 HTTPS 轮询（watchOS 网络限制）
- **传统协议**：Bridge protocol（TCP JSONL，仅用于历史兼容）

### macOS 节点模式

- macOS 可运行为节点模式：菜单栏应用连接到 Gateway 的 WS 服务器
- 内置 Canvas、camera、screen、notification 和计算机控制命令
- 不需要额外启动 CLI 节点，应用内部运行 CLI node-host runtime

### 文档数量

- 12 个节点相关文档（`docs/nodes/` 目录）

---

## 六、自动化与编排（Automation）

### 自动化机制

- **Tasks**：后台任务
- **Automations**：定时任务（类似 cron）
- **Hooks**：生命周期事件钩子
- **Standing orders**：持久化指令
- **Task Flow**：多步骤流程编排

### 决策指南

```
需要定时工作？
├─ 精确时间 → Automations（cron）
└─ 灵活调度 → Heartbeat / Standing orders

需要跟踪后台工作？ → Tasks

需要编排多步骤流程？ → Task Flow

需要响应生命周期事件？ → Hooks

需要给智能体持久化指令？ → Standing orders
```

### 文档数量

- 13 个自动化相关文档（`docs/automation/` 目录）

---

## 七、Gateway 控制面板

### Gateway 职责

- 会话管理（Session management）
- 工具调用（Tool invocation）
- 事件分发（Event dispatching）
- 渠道连接（Channel connections）
- 配置管理（Configuration management）
- 审批流程（Approval workflows）

### Gateway 文档

- 56 个网关相关文档（`docs/gateway/` 目录）
- 涵盖协议、配置、安全、性能、扩展等主题

### Gateway 协议

- WebSocket 连接
- JSON-RPC 风格的请求/响应
- 事件流
- 配置版本控制（带 `baseHash` 的乐观锁）

---

## 八、模型与推理

### 模型提供者支持

- **托管服务**：Anthropic、OpenAI、Google、Azure 等
- **本地模型**：Ollama、LM Studio、llama.cpp 等
- **自定义提供者**：通过插件扩展

### 推理能力

- 文本生成
- 嵌入向量
- 多模态（vision、audio）
- Function calling / Tool use
- 上下文缓存
- 流式输出

### 配置管理

- 模型选择和切换
- API 密钥管理
- 速率限制
- 成本跟踪（promos）
- 能力查询（capability）

---

## 九、安全与凭据

### 安全机制

- **Secrets 管理**：`openclaw secrets` 命令
- **Exec policy**：执行策略控制
- **Approvals**：审批流程
- **Sandbox**：沙箱隔离
- **Token 管理**：Gateway token、API keys

### 凭据存储

- 系统凭据库集成（macOS Keychain、Windows Credential Manager 等）
- 环境变量
- 配置文件（加密）

---

## 十、开发者扩展点

### 插件开发

- **Plugin SDK**：`openclaw/plugin-sdk`
- **Entry point**：`definePluginEntry`
- **能力注册**：通过 API 注册各类能力
- **打包发布**：插件清单（manifest）+ npm 包

### CLI 后端开发

- 实现自定义推理后端
- 注册为 CLI backend plugin
- 支持流式输出和工具调用

### 渠道开发

- 实现消息收发接口
- 注册为 channel plugin
- 处理认证和事件

### 工具开发

- 定义工具 schema
- 实现工具执行逻辑
- 注册到工具系统

---

## 十一、npm 脚本自动化

### 脚本数量

- 共计 515 个 npm 脚本（`package.json` 中）

### 核心脚本类别

- **构建**：`build`, `build:*`
- **测试**：`test`, `test:*`
- **开发**：`dev`, `start`
- **CLI**：`cli:*`
- **Gateway**：`gateway:*`
- **Dashboard**：`dashboard:*`
- **渠道**：`channel:*`
- **插件**：`plugin:*`
- **文档**：`docs:*`
- **发布**：`release:*`

---

## 十二、Chat Slash Commands（聊天斜杠命令）

### 命令类型

- **会话控制**：`/clear`, `/reset`, `/history`
- **工具管理**：`/tools`, `/enable`, `/disable`
- **模型切换**：`/model`, `/provider`
- **上下文**：`/context`, `/attach`, `/files`
- **自动化**：`/cron`, `/task`, `/hook`
- **调试**：`/debug`, `/inspect`, `/audit`

### 使用场景

- 在 `openclaw chat` 或 TUI 中快速执行命令
- 不离开聊天界面完成配置和管理操作

---

## 十三、输出模式与样式

### 输出模式

- **Human**：人类可读格式
- **JSON**：结构化 JSON 输出
- **YAML**：YAML 格式
- **Table**：表格展示
- **Compact**：紧凑模式

### 颜色调色板

- 支持 ANSI 颜色
- `--no-color` 禁用颜色
- 主题可定制

---

## 十四、使用跟踪与遥测

### 遥测数据

- 命令使用统计
- 错误报告
- 性能指标
- 匿名化用户数据

### 隐私控制

- 可选退出（opt-out）
- 本地优先（local-first）
- 透明收集策略

---

## 十五、相关资源

### 官方文档

- CLI 文档：67 个命令页面
- 工具文档：67 个工具说明
- 插件文档：59 个插件指南
- 渠道文档：67 个渠道集成
- Gateway 文档：56 个网关主题
- 自动化文档：13 个自动化机制
- 节点文档：12 个节点能力

### 社区与支持

- 官方仓库：GitHub
- 社区插件：Community plugins
- 兼容性列表：Compatibility matrix

---

**文档版本**：2026-08-07
**分析基于**：OpenClaw 官方源码仓库 `/Users/wei/DevTool/project/mine/gui/openclaw`
