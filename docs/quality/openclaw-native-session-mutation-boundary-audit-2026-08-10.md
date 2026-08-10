# OpenClaw 原生会话变更边界审计

日期：2026-08-10

## 依据

本轮核对的 OpenClaw Gateway 官方源码中，`sessions.delete` 在服务端校验会话身份、默认主会话、生命周期版本和工作区归属；随后中止该会话工作、进入独占生命周期区间、清理资源并返回结构化删除回执。`sessions.reset` 同样由 Gateway 的会话运行时完成重置并返回新的会话身份。

JunQi 自定义协作插件提供的 `junqi.collab.session.mutation.*` 不是 OpenClaw 原生会话生命周期协议的一部分。

## 当前行为

当协作插件能力存在时，`runtime/sessionLifecycle.ts` 在调用 `sessions.delete` 或 `sessions.reset` 前，强制打开协作变更对话框并要求插件写入 `PREPARED` 围栏。即使 `mutationImpact` 已确认该会话没有活动协作运行，用户选择继续后仍会调用插件的 prepare 方法。

插件 prepare 失败时，原生 Gateway RPC 不会执行，界面只显示泛化的“协作插件未确认持久化围栏”错误。该错误不能证明 OpenClaw 拒绝删除，也不能说明会话仍有活动运行。

## 结论

普通会话删除和重置必须以 OpenClaw 的原生 `sessions.delete` 与 `sessions.reset` 为唯一变更权威。协作投影不得成为其前置条件、成功条件或恢复门禁。

删除或重置成功后，JunQi 可以清理本地协作展示投影；该清理不修改 OpenClaw transcript，不向协作插件伪造完成结果，也不反向阻断已确认的 Gateway 回执。

## 未验证边界

真实多智能体 Gateway、插件运行时重启与跨平台 Tauri 窗口中的删除和重置仍需真机验收。自动化只能证明 JunQi 不再向协作插件发起会话生命周期写请求，并保留 Gateway 回执失败关闭。
