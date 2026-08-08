# 钉钉业务工作台运行时实施设计

日期：2026-08-08

状态：阶段 1、阶段 2 已实现；真实租户端到端验收待进行

## 当前实现与验证状态

- 已新增 `packages/junqi-dingtalk/` 独立 OpenClaw 插件包，固定注册 28 个钉钉业务工具，另提供运行状态和参数契约两个内部工具；插件清单共 30 个工具。
- 插件通过 DWS 官方 canonical path 执行，强制参数数组、JSON 输出、超时、取消、输出上限、精确 `corpId:userId` profile 和 leaf schema 摘要校验；子进程只接收路径、DWS 配置目录、临时目录、语言与系统证书白名单环境变量，schema 漂移会失败关闭。
- 写工具统一经过 OpenClaw `before_tool_call` 插件审批；DWS 的 `user_required` 只在审批通过后追加 `--yes`，未知结果不自动重放。
- 已生成并校验桌面资源包，Native 与 Docker 安装均要求当前已核验 Runtime Identity、连接 ID、目标指纹和选定运行时匹配；Tauri 只负责官方 OpenClaw 插件安装/启用，不直接执行 DWS。
- 业务页已迁移为钉钉单平台三栏工作台：左侧筛选、中部能力表格、右侧可收起和拖拽的参数详情；能力来源为当前 Session 的 `tools.effective`，不再展示飞书、Google、静态目录或 Chat bridge。
- 已通过插件单测、前端业务单测、TypeScript、全仓边界检查、Rust `cargo check`、Rust 全量 `cargo test --lib`、`pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check`。
- 尚未完成正式 DWS 发布包、真实钉钉租户、真实 Gateway 审批往返，以及 macOS/Windows/Linux/Docker 的真机视觉和运行验收；这些边界保持待验证，不把本机编译结果描述为业务上线。
- 2026-08-08 本机只读探测显示 OpenClaw 为 `2026.7.1-2`，当前 PATH 不存在 `dws`，`plugins list --json` 也未包含 `junqi-dingtalk`；因此未执行安装、认证、profile 或业务工具调用。

## 结论

钉钉业务能力由独立 OpenClaw 插件包装 DWS，并作为 OpenClaw 原生插件工具暴露。JunQi 业务页与 Chat 使用同一组工具、同一个 Session 级 `tools.effective` 快照、同一个 `tools.invoke` 调用入口和同一套插件审批。Tauri 不直接执行 DWS，前端不再通过 Chat bridge 拼接提示词模拟业务调用。

本设计取代以下旧目标：

- `business-integration-runtime-design-2026-08-02.md` 中由 typed Tauri command 直接执行 DWS 的运行时归属。
- `dingtalk-leave-approval-integration-design-2026-08-02.md` 中“DWS 无 profile 命令”和“OA 无审批发起命令”的旧快照结论。
- `business-applications-ui-design-2026-08-02.md` 中多平台目录作为当前交付面的目标。

旧文档保留为历史记录，不再作为实现契约。

## 已核对依据

### OpenClaw

核对主线提交 `733512b612e5fcfa96ca0764ac1851990406f187`：

- `tools.effective` 返回指定 Session 经服务端策略计算后的实际工具清单。
- `tools.invoke` 接收 `name`、`args`、`sessionKey`、`agentId`、`confirm` 和 `idempotencyKey`，并继续经过 Gateway 工具策略、hook 与审批。
- 插件可注册固定工具；敏感工具可设为 optional，避免未明确允许时暴露给模型。
- `before_tool_call` 可发起正式 `plugin.approval.*`，未知、超时、无审批路由和非法决策均失败关闭。

JunQi 当前已经有严格的 `OpenClawToolsEffectiveClient`、`OpenClawToolsInvokeClient`、Session 工具新鲜度围栏、运行时连接身份围栏和插件审批事件面板，实施时应复用这些边界。

### DWS

核对主线提交 `18030f1018f9d23e699063c4511987e660bb1701` 并从源码运行 schema：

- `dws schema "<path>" --compact` 是 Agent 选命令、参数、安全和确认语义的规范视图；`dws schema --all` 只用于审计、CI 和兼容基线。
- `profile list/switch/use` 正式存在，业务命令可用全局 `--profile <corpId>:<userId>` 绑定精确身份。
- `auth login/status/logout/reset` 正式存在，输出可强制为 JSON。
- OA 当前包含 `oa approval create-instance`，canonical path 为 `oa.start_process_instance`，schema 标记为 `write`、`high`、`non_idempotent`、`user_required`。
- OA 同意、拒绝、撤销、详情、记录、表单 schema、流程预测、待办与已发起列表均有正式 leaf schema。
- DWS safety 元数据只描述 DWS 自身确认要求。JunQi 的产品策略可以比 DWS 更严格，不能更宽松。
- DWS 失败可能返回恢复事件；JunQi 只能展示正式恢复交接，不自动重放未知结果的写操作。

当前 JunQi 开发机未安装发布版 `dws`。上述命令通过 DWS 官方源码主线复现，不代表已完成真实租户、发布包或跨平台验证。

## 当前实现缺口

| 当前实现 | 问题 | 目标 |
| --- | --- | --- |
| `src/business-applications/catalog.ts` 静态列出钉钉、飞书和 Google | 把设计目录当成运行时能力，飞书等无真实消费者。 | 当前只保留钉钉产品面，能力来自 `tools.effective` 与插件探测。 |
| `businessChatBridge.ts` 将提示词写入 Chat 草稿 | 不是确定性业务调用，也不能证明工具、参数或结果。 | 业务页直接调用同一 OpenClaw 插件工具；Chat 自然使用同一工具。 |
| `ApplicationJournal` 静态空态 | 没有正式来源，容易演变为伪审计。 | 使用脱敏业务活动投影，明确不是 transcript 或钉钉权威状态。 |
| 无 DWS runtime、auth、profile 和 schema 边界 | UI 无法区分未安装、未授权、身份未知和能力缺失。 | 插件提供严格 readiness 与能力投影。 |
| 旧设计由 Tauri 执行 DWS | 绕过 OpenClaw 工具策略并绑定桌面主机。 | DWS 归属 Gateway 插件运行时。 |

## 目标架构

```text
JunQi 钉钉业务页
  -> 当前真实 Session
  -> tools.effective
  -> 钉钉工具投影
  -> 业务操作计划与本地确认摘要
  -> tools.invoke(sessionKey, tool, args, idempotencyKey, confirm=true)
  -> OpenClaw Gateway 工具策略
  -> junqi-dingtalk 插件工具
  -> before_tool_call 插件审批
  -> DWS leaf schema 再校验
  -> 参数数组执行 dws ... --profile ... --format json
  -> 结构化结果或正式错误
  -> 权威只读重读
  -> 业务实体投影与活动投影

OpenClaw Agent
  -> 同一组 junqi-dingtalk 插件工具
  -> 同一审批、DWS 与重读链路
```

## 插件边界

新增 `packages/junqi-dingtalk/`，不扩展 `junqi-collab`。插件由以下单一职责模块组成：

| 模块 | 责任 |
| --- | --- |
| runtime probe | 解析受控 DWS 可执行文件、版本、`auth status` 和运行时身份；不搜索任意同名程序后静默切换。 |
| profile repository | 读取 `profile list`，要求调用使用精确 `corpId:userId`；不按展示名或第一项自动选择。 |
| schema catalog | 按需读取 compact product/leaf schema，保存带 DWS 版本和摘要的短期缓存；全量 schema 只用于 CI baseline。 |
| tool registry | 只注册当前产品 allowlist 内、leaf schema 已验证的固定工具；不提供任意命令工具。 |
| command runner | 使用参数数组与受控环境执行 DWS，强制 JSON、输出上限、超时和取消；不使用 shell 拼接。 |
| approval policy | 对所有写入和 destructive effect 发起插件审批；高风险操作只允许一次授权或拒绝。 |
| result normalizer | 保留 DWS 正式错误类别、恢复事件和必要实体引用；不把空输出或退出码推断为成功。 |

工具名是 JunQi 与 OpenClaw 的稳定产品契约，DWS canonical path 是插件内部映射。每次激活或 schema 摘要变化时必须重新校验映射、required 参数、effect、risk、confirmation 和 idempotency。发现漂移时只禁用受影响工具并报告差异，不能继续使用旧参数。

## 能力发现与 UI 投影

业务页不能从静态 catalog 决定可用性。投影顺序如下：

1. 当前 Gateway、Session 和 attested connection identity 必须存在。
2. 使用现有 `tools.effective` 获取当前 Session 实际可用工具。
3. 只选择 `pluginId` 与工具名前缀均匹配 `junqi-dingtalk` 的条目。
4. 将工具 metadata 映射到 UI 行：领域、动作、effect、risk、当前可用性和未满足条件。
5. DWS runtime、auth 或 profile 未验证时，对应工具不注册或返回明确不可用；UI 不显示为“已连接”。
6. `hello-ok.features.methods` 未列出某方法不能单独作为“不支持”结论；按现有 JunQi Gateway 规则发起正式请求并解释结构化结果。

UI 首期只呈现一个钉钉平台。飞书、Google 和旧多平台 descriptor 在实施时连同专属文案、测试与无引用导出一起删除。第二个平台出现真实实现前不增加一值配置、空适配器或兼容层；届时再以产品配置保证一个版本只展示一个平台。

## 身份、认证与密钥

- DWS 认证和 token 刷新继续由 DWS 拥有，插件不得读取或返回 token。
- profile 使用 DWS 返回的稳定 `corpId:userId`，存储只保留必要标识和脱敏显示信息。
- 当前业务 Session 必须显式绑定一个 profile；多 profile 时不自动选择。
- OpenClaw 钉钉消息渠道身份不能替代 DWS profile 身份。若需要把聊天用户映射为业务操作者，必须另有正式身份绑定证据。
- Gateway 运行时身份或 DWS 配置目录变化后，当前 profile 与能力快照全部失效。
- DWS 未安装时只显示缺失与官方安装交接信息。安装与升级另立计划，不在首个业务切片中自动修改主机。

## 调用、确认与幂等

### 只读操作

只读工具可由业务页或 Agent 直接调用，但仍受 `tools.effective`、Session、profile、参数 schema 和 Gateway policy 约束。列表与详情必须显示 `observedAt`，不能无限期复用旧数据。

### 写操作

每次写操作先生成不可变业务操作计划，再执行以下门禁：

1. 重新获取新鲜 `tools.effective` 快照。
2. 重新核对 profile、目标实体与 DWS leaf schema 摘要。
3. 展示动作、目标、身份、风险和关键参数摘要。
4. 生成一次 `idempotencyKey` 并调用 `tools.invoke`。
5. 插件 `before_tool_call` 发起 `plugin.approval.*`。业务写操作统一只提供 `allow-once` 与 `deny`。
6. DWS 要求确认的命令仅在插件审批通过后传入 `--yes`；用户拒绝、超时或无审批路由均不执行。
7. 返回成功后使用只读工具重读目标实体。无法重读时显示“结果待核验”，不自动重放。

`tools.invoke.idempotencyKey` 只标识一次 OpenClaw 调用。若 DWS schema 标记 `non_idempotent` 或 `unknown`，连接中断后不得用新 key 重试。只有权威对账证明未产生副作用，或 DWS/钉钉提供正式幂等契约时，才允许用户发起新的操作。

## 操作记录

新增 `BusinessActivityProjection`，最小字段为：

| 字段 | 说明 |
| --- | --- |
| `attemptId`、`idempotencyKey` | JunQi 操作尝试与 OpenClaw 调用关联。 |
| `runtimeIdentity`、`sessionKey` | 绑定准确 Gateway 与 Session。 |
| `profileRef` | 精确 DWS profile，展示时脱敏。 |
| `toolName`、`dwsCanonicalPath`、`schemaDigest` | 工具与执行契约版本。 |
| `effect`、`risk`、`inputDigest` | 操作类别与脱敏输入摘要。 |
| `approvalId`、`approvalDecision` | 仅记录正式插件审批结果。 |
| `resultState`、`errorCode` | 成功、失败、拒绝、取消或未知。 |
| `recoveryEventId` | DWS 正式返回时保存，禁止推测。 |
| `entityRefs`、`observedAt` | 后续权威重读的最小实体关联。 |

不得保存 token、密钥、完整表单正文、医疗信息、附件内容或 DWS 原始配置。业务活动投影不是 OpenClaw transcript；业务页直接调用工具时，不在 transcript 中伪造 Agent、Tool Result 或 System 消息。

## 分期范围

### 阶段 0：契约实验室

- 在受控测试环境安装正式 DWS 发布包，记录版本、来源和校验。
- 采集 `auth status`、`profile list`、目标 product compact schema 和 leaf full schema 的脱敏样本。
- 验证 JSON envelope、超时、取消、恢复事件、profile 切换和多组织行为。
- 生成首批工具映射 baseline；任何未取得真实样本的字段保持待验证。

### 阶段 1：运行时骨架

- 建立 `packages/junqi-dingtalk/`、manifest、构建、打包和契约测试。
- 实现 probe、profile、schema、runner、normalizer 与审批策略。
- 在 JunQi 删除飞书、Google、旧 Chat bridge 和静态 Journal；页面接入当前 Session 与实际插件工具投影。
- 首期只提供 readiness 与只读工具，不开放业务写入。

### 阶段 2：只读 MVP

优先开放：

- 身份与通讯录：当前用户、用户搜索、部门搜索、部门成员。
- OA：可见表单、表单 schema、待我审批、我发起的、详情、任务和记录。
- 考勤：我的考勤、月度汇总、班次、规则、假期余额。
- 日历：日历列表、事件列表与详情、忙闲和会议室查询。
- 待办：我的待办列表与详情。

工作台应用目录和管理员级通讯录、考勤配置不进入 MVP。

### 阶段 3：低至中风险写入

- 待办创建、更新、完成。
- 日程创建、更新、参会人变更和响应。
- 所有操作经过一次性插件审批并在成功后重读。
- 删除、组织通讯录写入和考勤管理写入仍保持不可用。

### 阶段 4：高风险业务动作

- OA 发起审批：先读取 form schema，必要时执行流程预测，再确认 `create-instance`。
- OA 同意、拒绝、撤销、转交、评论和抄送。
- 待办删除、日程删除及其他 destructive 操作。
- 高风险确认必须显示目标实例、当前身份、动作影响和重读计划；不提供永久授权。

### 阶段 5：后续垂直业务

AI 表格、钉钉文档、群聊机器人、DING、日志、AI 听记等按独立业务切片规划。每个切片都从当前 DWS schema 和真实租户权限开始，不因 DWS 产品目录存在就自动进入 JunQi。

## 未验证边界

- DWS 正式发布包在 macOS、Windows、Linux 和 Docker Gateway 中的安装、凭据库与取消行为。
- 真实钉钉租户的 auth、profile、多组织、OA 表单、考勤、日历和待办响应 envelope。
- OpenClaw 插件动态工具 factory 在 DWS readiness 变化后的即时刷新行为。
- 业务页直接 `tools.invoke` 与插件审批 UI 并行时的真实桌面焦点、取消和重连体验。
- DWS 恢复事件在真实认证失败、网络中断和服务端限流场景中的完整对账流程。

## 官方来源

- [OpenClaw Gateway protocol](https://github.com/openclaw/openclaw/blob/733512b612e5fcfa96ca0764ac1851990406f187/docs/gateway/protocol.md)
- [OpenClaw plugin tools](https://github.com/openclaw/openclaw/blob/733512b612e5fcfa96ca0764ac1851990406f187/docs/plugins/building-plugins.md)
- [OpenClaw plugin approvals](https://github.com/openclaw/openclaw/blob/733512b612e5fcfa96ca0764ac1851990406f187/docs/plugins/plugin-permission-requests.md)
- [OpenClaw tools.invoke source](https://github.com/openclaw/openclaw/blob/733512b612e5fcfa96ca0764ac1851990406f187/src/gateway/server-methods/tools-invoke.ts)
- [DWS schema reference](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/18030f1018f9d23e699063c4511987e660bb1701/docs/reference.md)
- [DWS command framework](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/18030f1018f9d23e699063c4511987e660bb1701/docs/command-framework-architecture.md)
