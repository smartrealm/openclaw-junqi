# OpenClaw Cron 与日历提醒一致性验证

日期：2026-08-08

## 官方依据

- OpenClaw 当前主线 Gateway descriptor 将 `cron.get`、`cron.list`、`cron.status` 和 `cron.runs` 标为 `operator.read`。
- `cron.add`、`cron.update`、`cron.remove` 和 `cron.run` 标为 `operator.admin`。
- 当前主线协议 schema 的计划类型包括 `at`、`every`、`cron`、`on-exit` 和 `stream`；`every` 支持 `everyMs` 与可选 `anchorMs`。
- 依据来源：本地核对的 OpenClaw 官方仓库 `packages/gateway-protocol/src/schema/cron.ts` 与 `src/gateway/methods/core-descriptors.ts`。官方当前主线提交为 `c7b7fe4c328b597c69345b258b7f0357e6d3861d`。

## 本次变更

### 权限通道

JunQi 的 `OpenClawCronRunClient` 现在显式接收普通读取请求和管理员请求两个依赖。`cron.run` 只能通过管理员请求执行，`cron.runs` 和终态读取继续通过普通读取请求。页面不接触权限令牌，也不根据 hello 方法列表猜测能力。

### 日历提醒

日历提醒由独立调度构建器转换为官方计划类型：

- 单次提醒使用 `at`。
- 每日间隔和多周间隔使用 `every`，首个提醒时刻作为 `anchorMs`。
- 每周一次使用以实际提醒时刻为准的 `cron` 星期字段，跨午夜不会错到事件当天。
- 本地日期时间必须严格匹配日历字段；无效日期或被运行时自动滚动的时间不会被投影为另一时刻的远端任务。
- 月度规则只有在提醒未跨日且间隔能由 12 个月稳定表达时使用 `cron`。
- 年度规则只有在提醒未跨月且间隔为一年时使用 `cron`。
- 包含 `until`、`count`，或无法由官方静态计划准确表达的月度、年度规则标记为 `unsupported`，不会创建伪 Cron 任务，也不会进入无限重试队列。

提醒名称、消息和时间文案从 i18n 资源生成，Cron 模板使用运行时本地时区，不再固定为 UTC 或英文文本。

## 验证结果

- `OpenClawCronRunClient` 定向测试：管理员与读取通道隔离、方法未找到映射、终态身份核对，共 8 项通过。
- 日历调度构建器测试：跨午夜周提醒、`every` 锚点、边界规则拒绝，共 3 项通过。
- 日历 Cron 关联回归测试：删除未确认、替换顺序、创建失败和全天事件，共 4 项通过。
- 日历投影测试：2 项通过。
- 提醒内容测试：结束时间分隔符只来自 i18n 资源，避免开始和结束时间黏连，共 1 项通过。
- Cron 模板测试：时区来自运行时环境，不固定为 UTC，共 1 项通过。
- 定向测试共 20 项通过；TypeScript 类型检查、`pnpm lint`、三份应用语言 JSON 解析、全量 `pnpm test` 与
  `pnpm build` 通过。

## 未验证边界

- 尚未在真实 Tauri 窗口和真实 Gateway 上执行日历新增、更新、删除及手动运行的端到端验收。
- `everyMs` 是固定毫秒间隔，跨夏令时会遵循 OpenClaw 的间隔语义，而不是重新解释为本地日历墙上时间。
- OpenClaw 未提供任意日历规则的结束日期和次数字段；被标记为 `unsupported` 的规则需要用户改为官方支持的计划类型。
