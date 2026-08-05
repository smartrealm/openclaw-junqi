# OpenClaw 会话响应使用量详情对齐记录

## 权威依据

最新 OpenClaw 官方用量追踪文档规定 `/usage off|tokens|full` 是会话记忆的响应页脚模式：字段缺失表示继承 `messages.responseUsage` 后回落到 `off`；显式 `off` 与继承不同；`on` 是 `tokens` 的兼容别名。官方配置文档将 `messages.responseUsage` 定义为新会话未选择覆盖时的默认值。

当前安装包的 schema 和 ACP 控制面都能复现 `sessions.patch.responseUsage`、`null` 清除覆盖及 `on` 兼容输入。这些本地证据用于核对正在运行的协议，最新版官方文档和官方源码仍是功能边界。

## 发现

JunQi 原有会话控制覆盖模型、思考、快速模式、工具输出、插件追踪和推理可见性，但未投影 `responseUsage`。这使用户无法在桌面端辨别会话是继承默认响应页脚、显式关闭，还是显式请求令牌或完整详情。

## 实现与验证结果

- `sessions.list` 现保留非空 `responseUsage` 原始字符串，并投影至会话状态；客户端不会在读取、打开控制面或同步列表时重写该字段。
- 会话运行时控制提供继承、关闭、令牌、完整四个选择，分别通过既有每会话串行 `operator.admin` 的 `sessions.patch` 通道写入 `null`、`"off"`、`"tokens"`、`"full"`。Gateway 回执确认后才回写目标会话。
- 兼容值 `"on"` 在控制面显示为令牌；由于比较使用规范化后的有效模式，用户不修改该选项时不会触发写入。未知字符串显示为不可写状态，需用户主动选择支持值覆盖。
- JunQi 不接管 `messages.responseUsage` 默认配置，不生成响应页脚、令牌计数或成本估算；页脚内容与渠道投递仍由 OpenClaw 负责。
- 回归测试覆盖官方值映射、兼容别名、未知值、特权写入、会话定向回写、三语文案与转向派发。全量验证曾发现一个将 `sessions.steer` 调用位置写死的旧守护测试；现改为直接验证转向派发不会落入 `chat.send`，符合行为契约而非源代码写法的要求。
- 已通过定向 61 项回归、全量 245 项测试和 31 个套件、`pnpm lint`、`pnpm build`、`pnpm verify:openclaw-docs` 与 `git diff --check`。

## 未验证边界

真实 Gateway、渠道投递、不同 `messages.responseUsage` 默认配置及目标平台窗口交互均须在对应环境完成验收。JunQi 只管理 Gateway 已支持的会话覆盖，不生成或解释页脚内容。
