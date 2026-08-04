# OpenClaw 会话快速模式对齐

## 依据

- OpenClaw 官方文档 `docs/tools/thinking.md` 与 `docs/tools/slash-commands.md`：`/fast` 支持 `auto`、`on`、`off` 与清除会话覆盖的 `default`；其状态是会话级覆盖。
- OpenClaw 官方协议类型 `dist/schema-DtyqV_v0.d.ts`：`sessions.patch.fastMode` 的值域为 `boolean | "auto" | null`。
- OpenClaw Gateway 源码 `dist/sessions-UcKjjh_n.js`：`sessions.patch` 返回权威 `entry` 与 `resolved`，并广播 `sessions.changed`。

## 当前行为

JunQi 已能通过特权 `sessions.patch` 修改会话模型和思考等级，但此前不读取 `sessions.list` 的 `fastMode`，也没有原生快速模式控制入口。

## 目标行为

- 会话运行时控制提供四种呈现状态：继承、自动、开启、关闭；分别映射为 `null`、`"auto"`、`true`、`false`。
- 只通过已有的 OpenClaw `sessions.patch` 特权通道写入 `fastMode`，并以成功响应中的 `entry.fastMode` 回写本地会话状态。
- 会话列表投影读取 Gateway 返回的受支持值；未知值不被伪造成有效状态。
- 不为任何模型提供商写入特化策略，也不承诺快速模式一定改变响应时间；实际语义由 OpenClaw 与上游提供商决定。

## 验收

1. 四个界面状态与官方协议值双向映射正确，非法或缺失值显示为继承。
2. 变更只调用 `sessions.patch`，且使用既有 `operator.admin` 连接。
3. Gateway 确认后只更新目标会话的 `fastMode`；后续 `sessions.changed` 或 `sessions.list` 仍可收敛权威状态。
4. 保存失败时不写入乐观快速模式状态，并复用现有会话设置错误反馈。
5. 三种支持语言均显示完整文案；控制条在窄宽度下模型名可截断，不挤出思考和快速模式状态。

## 未验证边界

- 尚未以真实 Gateway、真实模型提供商验证 `fastMode` 对推理耗时或自动切换时机的影响。
- 尚未在 macOS、Windows、CentOS、Ubuntu 真机验证完整操作与视觉表现；跨平台行为以 Gateway 官方实现和目标平台实测为准。
