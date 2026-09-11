# OpenClaw Wizard 版本协商规格

日期：2026-08-14

验证更新：2026-09-11

## WIZ-COMPAT-01 · setup 启动参数协商

当前：JunQi 始终发送 `installDaemon:false`，stable 在 schema 校验阶段拒绝后终止整个配置流程。

目标：

1. setup Wizard 首次请求保留主线 `installDaemon:false`。
2. 只有 `GatewayRpcError.code` 为 `INVALID_REQUEST`，且消息精确为 `invalid wizard.start params: at root: unexpected property 'installDaemon'` 时，才在同一 `start` 操作中省略该字段重试一次。
3. 重试前再次检查操作代次；已经被页面切换或新操作取代时不得发送第二次请求。
4. 第二次请求的响应必须经过与主线响应相同的严格解析和会话持久化。
5. `flow:'channels'` 不参与该协商。

验收：

- 主线成功时只有一次 `wizard.start`。
- stable 精确拒绝时恰好两次 `wizard.start`，第二次只包含公共字段。
- workspace 在第二次请求中保持规范化值。
- 其他 schema、权限、连接和业务错误没有第二次请求。

## WIZ-COMPAT-02 · 删除永久不兼容投影

当前：精确字段拒绝进入 `protocol-incompatible` 恢复模式，隐藏主操作并显示永久阻断文案。

目标：字段拒绝由客户端协议适配层内部消费；状态机只接收协商后的成功结果或真实最终失败。

验收：

- `WizardRecoveryMode` 不再包含 `protocol-incompatible`。
- 首次设置页面不再有该模式的专属按钮和文案分支。
- `wizardFailureDestination` 只处理仍有真实消费者的恢复模式。

## WIZ-COMPAT-03 · daemon 所有权语义

当前：文档无条件声称 Classic Wizard 已通过 `installDaemon:false` 关闭 daemon 分支。

目标：主线支持参数时由 JunQi 显式关闭；stable 公共参数模式下由官方 Wizard 完整呈现 daemon 选择，JunQi 不改写答案或伪报关闭。

验收：相关审计、安装流程、规格、预览和项目状态使用同一描述，不再要求用户等待 stable 更新才能运行 Classic Wizard。

## WIZ-COMPAT-04 · 跳过更新后的失败反馈

当前：更新检查允许跳过，但后续配置准备失败只写入流程状态，更新页没有呈现错误，用户只能看到按钮短暂加载后恢复。

目标：更新页在配置准备失败时使用共享状态面板就地显示真实错误，并把主操作切换为重新核验；更新可用本身不能成为继续配置的阻断条件。

验收：失败详情在当前页面可见，用户无需打开日志即可知道未前进原因，重试仍复用同一配置核验入口。

## WIZ-COMPAT-05 · 恢复更新的协作维护门禁

当前：OpenClaw 承载协作插件的 Gateway 或插件服务异常时，更新流程仍要求先从该服务取得维护租约，导致修复宿主所需的更新被 `Collaboration maintenance state could not be read` 阻断。

目标：

1. 更新维护检查前必须存在当前所选 Runtime 的已核验 Gateway 连接；缺失时只通过统一 Gateway 生命周期入口重连，重连失败或未形成身份核验连接时停止更新。
2. 协作服务正常时仍必须取得维护租约，并保留活动任务、数据库完整性、运行时身份和租约再核验门禁。维护入口只从 `junqi.collab.capabilities` 读取实例标识、Schema 版本和数据库完整性三个稳定身份字段；不得因旧插件缺少与维护无关的新版展示能力字段而在读取维护状态前失败。
3. `junqi.collab.capabilities` 精确返回 `SERVICE_START_FAILED` 或 `DATABASE_SCHEMA_UNSUPPORTED` 时，OpenClaw 恢复更新可在无租约状态继续。旧 Gateway 没有注册该 RPC 时，还必须由绑定同一连接的本地探针精确证明插件已安装但未加载、无维护事务、无警告、允许桌面修改且持久状态为可读的存在或缺失；插件已加载、完全缺失但持久状态不明、探针忙碌或状态损坏均不满足该证明。
4. 实际更新写入前必须再次核验同一种证明。结构化服务故障必须保持同一代码，本地恢复证明必须重跑完整探针；服务恢复、故障类型变化、运行时身份变化或返回未知错误时停止更新，不能用旧证明抢跑。
5. 存储迁移和其他维护动作不得复用任何 OpenClaw 恢复更新例外。

验收：

- 已核验连接存在时不重复重连；连接缺失时先重连再检查维护状态。
- 旧插件返回稳定维护身份但缺少新版展示字段时，维护入口仍继续读取正式维护状态；稳定身份本身缺失或格式错误时失败关闭。
- 精确服务启动失败、数据库 Schema 不支持，或旧 Gateway 上同一受管插件被权威探针证明已安装但未加载时，OpenClaw 更新可继续且不伪造维护租约。
- 服务状态在写入前变化时更新操作不执行。
- 插件已运行、存在活动任务、身份漂移、连接失败和未知错误继续失败关闭。

## WIZ-COMPAT-06 · 可选更新与继续配置解耦

当前：更新检查已成功确认安装渠道后，如果用户执行更新但维护准备失败，页面把已保存的检查结果一起降为错误，导致“下一步”被禁用，用户无法放弃本次更新并继续使用现有 OpenClaw。

目标：更新执行错误只影响本次更新操作。只要同一页面已取得无错误的结构化检查结果，且渠道仍为 `eligible`，用户就可以通过“跳过更新并继续”进入配置；真正的检查失败、未知渠道、beta 和 dev 仍阻断。

验收：回归覆盖“检查成功后更新失败”仍投影为可继续状态，以及没有成功检查证据时的错误仍失败关闭；更新错误继续原地展示，不伪报更新成功。

## WIZ-COMPAT-07 · 已有 Classic Runtime 的无写入接管

当前：用户已经配置并运行 OpenClaw 时，首次设置仍进入官方 Classic Wizard；旧版 Runtime 又缺少写后交接所需的活动配置修订字段，导致可用环境无法进入仪表盘。

目标：

1. 只对本次设置未写入 OpenClaw 配置的已有 Classic Runtime 启用接管门禁。
2. 在同一已核验 Gateway 连接上要求 `config.get` 信封存在、有效，并取得非空 `hash`。
3. 通过唯一临时 Session 调用官方 `agents.list`、`agent` 与 `agent.wait`，要求运行被接受且以 `ok` 终态结束；不得从回复正文推断成功。
4. 模型调用前后要求连接标识和 `config.get.hash` 不变；任一漂移都重新核验或失败关闭。
5. 通过正式 Session 删除入口清理临时会话；清理失败不能进入 Ready。
6. 该路径不得复用于 Guided、Classic Wizard 终态或任何配置写入之后，也不得把 `config.get.hash` 描述为活动配置修订。

验收：已有本地 OpenClaw 可跳过更新与重复向导进入 Ready；连接漂移、配置持续漂移、模型失败、响应畸形和清理失败均阻断；默认 Web Crypto 标识生成在真实浏览器对象上可执行。
