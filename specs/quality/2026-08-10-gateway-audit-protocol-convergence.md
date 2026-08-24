# Gateway 审计协议收敛规格

日期：2026-08-10

## 目标行为

1. 富审计客户端只调用官方 `audit.activity.list`，不得回退到 `audit.list`。
2. `audit.activity.list` 未知时必须返回稳定的不可用错误，不得返回不完整的基础审计数据。
3. 活动审计解码器必须严格接受官方 V1 封闭联合，包括 `active_run_injected`，并拒绝未知状态、原因和字段相关性。
4. 基础 `audit.list` 继续由现有基础审计模块独立处理，不与富审计模型混合。
5. 请求客户端通过构造函数注入 Gateway requester；协议 codec 保持无状态、无网络依赖。
6. 不再调用当前官方仍已删除的 `doctor.memory.remHarness`、`talk.session.cancelTurn` 和
   `sessions.compaction.get`，也不保留对应的本地兼容路径。`voicewake.routing.set` 已在 2026-08-19 官方契约中恢复。
7. 内存诊断只保留 `doctor.memory.status` 的单一客户端和状态投影，不保留重复解码器或无消费者 Hook。
8. 语音唤醒路由当前只呈现 `voicewake.routing.get` 的结果；这是 JunQi 当前界面范围，不代表官方缺少 `voicewake.routing.set`。
9. 官方内置插件方法与 JunQi 自有扩展必须和核心 RPC 分开分类；`browser.request` 不能误判为未知核心方法。
10. Cron 创建参数和响应投影必须遵守官方 Date 时间戳上限，并从单一契约导出 schedule、session target 与 wake mode。
11. Cron 状态投影不得保留最新版官方 Schema 已删除且无消费者的旧字段。
12. `hello-ok.features.methods` 缺少会话历史方法时不得隐藏操作；认证连接后由真实 RPC 响应判定结果。
13. 附件准备必须读取当前连接的 `hello-ok.policy.attachments`，不得写死逐附件、数量或总量限制。
14. 附件策略缺失时不得猜测服务端逐附件能力；仍须以 `maxPayload` 排除编码后必然无法发送的文件，并由服务端决定
    MIME、数量和模型相关处理。
15. Talk 调用必须显式请求 `operator.talk`；权限类型必须覆盖官方封闭集合，但不得为未使用能力扩大默认权限。
16. 无桌面消费者的协作会话变更 RPC 不得继续暴露自定义 OpenClaw 会话生命周期。
17. Workbench Provider claim 没有生产消费者时，不得仅凭目标架构文档保留前端、Tauri command 和 PTY 清理双轨实现。

## 非目标

- 不新增 Gateway RPC、插件 RPC 或本地审计数据源。
- 不根据 OpenClaw 版本号切换协议。
- 不把 `features.methods` 缺失当作不可调用证据。
- 不改变基础审计面板、聊天追溯和钉钉业务审计的信息架构。

## 验收条件

- 富审计客户端测试证明每次查询最多发送一次 `audit.activity.list` 请求。
- 未知方法、无效响应和合法 `active_run_injected` 分别有回归覆盖。
- 删除旧解析器、旧常量、旧 source 联合和专属兼容测试后，全仓无引用残留。
- 上游已删除的四个 RPC 在生产源码中无字符串、请求方法、状态字段或可操作界面残留。
- 会话目标守护测试不再调用已删除的 compaction get 外观，仍覆盖 list、branch 和 restore。
- 39 个保留的协作扩展注册项均有桌面生产消费者，静态可解析的生产请求不存在未分类方法。
- Cron 创建参数拒绝超出官方 Date 上限的 interval、anchor 和 stagger，作业响应拒绝超范围的官方日期字段。
- Cron 读取投影不再声明或解析无官方依据的旧状态字段。
- 会话历史入口在握手方法列表为空时仍可用，未连接时保持不可用。
- 握手附件策略在连接建立时严格解码，在断开和重连时同步替换；主会话、拖放、剪贴板、截图、桌面文件和 Quick Chat
  使用同一策略。
- 附件验证不再声明官方未提供的数量或总量限制；超出逐附件或帧上限、读取失败分别有行为回归测试。
- 默认握手请求包含 `operator.talk`，权限类型同时接受官方 Questions 与 Talk Secrets 值。
- 三个协作会话变更 RPC、可执行状态机和专属测试无残留；schema 15 不含旧表，schema 14 既有数据库按当前版本校验
  失败关闭且不被自动修改。
- Provider claim 的前端、IPC、Rust command 与 PTY 清理钩子无引用残留；provider 能力探测继续工作，PTY 原有生命周期
  与退出事件不受影响。
- `pnpm lint`、相关定向测试、完整 `pnpm test` 和 `pnpm build` 通过。
- 修改后的完整文本文件通过 Emoji 扫描，`git diff --check` 通过。
