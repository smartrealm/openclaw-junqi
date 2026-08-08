# ADR-0002：由 OpenClaw 插件承接钉钉业务运行时

状态：拟议

日期：2026-08-08

## 背景

当前业务应用页只有静态 descriptor、页面本地选中状态和把自然语言提示放入 Chat 草稿的 bridge。旧设计建议由 Tauri 直接执行 DWS CLI，但这会形成一条绕过 OpenClaw 工具策略、Session 工具清单和插件审批的第二执行路径，也无法自然支持远程 Gateway。

最新版 OpenClaw 主线已经提供会话级 `tools.effective`、受策略控制的 `tools.invoke` 和 `plugin.approval.*`。最新版 DWS 主线提供运行时组装的 `dws schema`、精确 profile、结构化 JSON 输出、安全元数据和恢复事件。这两组正式边界足以承接钉钉业务能力，无需在 JunQi 中再实现一套独立工具运行时。

## 决策

新增独立的 OpenClaw 插件包 `packages/junqi-dingtalk/`，由插件在 Gateway 所在主机或经正式 Node 契约核验的执行节点调用 DWS。React 和 Tauri 不直接执行 DWS，不读取 DWS token，也不维护另一份可调用工具目录。

插件只注册经过产品允许并由当前 DWS leaf schema 校验的固定工具。JunQi 业务页通过现有 `tools.effective` 获取当前 Session 的实际可用工具，通过现有 `tools.invoke` 发起一次调用；OpenClaw Agent 在 Chat 中使用同一组插件工具。所有写操作由插件 `before_tool_call` hook 请求 `plugin.approval.*`，默认只允许 `allow-once` 与 `deny`。

## 结果

- UI 与 Chat 共用同一工具、身份、权限、审批和失败语义。
- 远程 Gateway 不要求桌面机器安装 DWS，也不把桌面 PATH 当成运行时事实。
- DWS schema 漂移会使对应工具不可用或返回明确契约错误，不会由前端字段默认值掩盖。
- 直接从业务页调用 `tools.invoke` 不自动写入 OpenClaw transcript。JunQi 只保存脱敏业务活动投影，并明确它不是 transcript 或钉钉状态权威源。
- 插件包需要独立构建、契约测试、安装和版本兼容验证，不能塞入现有协作插件。

## 被否决的方案

### Tauri 直接执行 DWS

否决原因：形成第二套工具授权与审批路径；对远程 Gateway 的运行时归属错误；Chat 和业务页无法共享同一工具策略。

### 仅通过 Skill 提示 Agent 执行 DWS

否决原因：Skill 可以指导模型，但不能为确定性业务表格提供稳定工具 schema、结构化错误和可核验的直接调用入口。

### 一个接受任意命令路径的通用 DWS 工具

否决原因：会把 DWS 全命令面和任意参数暴露给 UI 或模型，绕过产品 allowlist，扩大副作用与契约漂移风险。

### 直接连接 DWS 内部 MCP endpoint

暂不采用。当前已核对的 DWS 官方契约是 CLI、schema、profile、JSON 输出与恢复流程；尚未证明 DWS 自身提供可由 JunQi 稳定托管的公共 MCP server 入口。若未来官方提供正式 server 契约，可另立 ADR 替换插件内部执行器，但不改变 OpenClaw 工具归属。

## 依据

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/733512b612e5fcfa96ca0764ac1851990406f187/docs/gateway/protocol.md)
- [OpenClaw tools.invoke handler](https://github.com/openclaw/openclaw/blob/733512b612e5fcfa96ca0764ac1851990406f187/src/gateway/server-methods/tools-invoke.ts)
- [OpenClaw plugin permission requests](https://github.com/openclaw/openclaw/blob/733512b612e5fcfa96ca0764ac1851990406f187/docs/plugins/plugin-permission-requests.md)
- [DWS schema reference](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/18030f1018f9d23e699063c4511987e660bb1701/docs/reference.md)
- [DWS README](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/18030f1018f9d23e699063c4511987e660bb1701/README.md)
