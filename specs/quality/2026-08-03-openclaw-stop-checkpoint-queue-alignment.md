# OpenClaw Stop 检查点与队列对齐规格

日期：2026-08-03

## 目标

使 JunQi 的 Stop 与 OpenClaw 当前 `sessions.abort` 的 run-scoped 取消语义一致，并确保
Task checkpoint 是远端 Abort 的持久前置条件，而不是失败后被吞掉的旁路记录。

## STCQ-01 - checkpoint 先于远端 Abort

### 当前

`gateway.abortChat` 捕获并只记录 `requestStop` 失败，仍调用 `sessions.abort`。

### 目标

对已绑定的 Task，Stop intent 的持久写入失败必须终止本次 Stop transaction，且不得发送远端
Abort RPC。成功写入后，沿用既有精确 `runId`、原生 acknowledgement 和 history
reconciliation 逻辑。无可用 Task binding 的既有 no-op 不能被伪造为持久化成功。

### 验收

- [x] 持久 Stop intent 成功后才调用远端 abort 回调。
- [x] 持久 Stop intent 抛错时，远端 abort 回调不被调用，原错误可被调用方处理。
- [x] 原生 `sessions.abort` 参数继续只携带 key 和可解析的 runId，默认不携带
  `clearQueued`。

## STCQ-02 - Stop 保留待发送队列

### 当前

普通 Composer、Jarvis 语音和 Quick Chat 的 Stop 均在 Abort 前调用 `clearQueue`。

### 目标

Stop 不访问 `messageQueue`。本地队列仍只能由明确的清空队列操作、Session reset/delete 或
Quick Chat 窗口销毁清理；现有 queue drain gate 在当前 Run 已得到终态后继续决定何时发送。

### 验收

- [x] 三个 Stop 入口不再取消本地队列项或删除其 retry payload。
- [x] Stop 仍立即中断本地语音输出，并保持原有的 active/sending guard。
- [x] 现有 Gateway `clearQueued` 默认缺省行为与显式清空队列动作保持不变。

## 边界

JunQi 不把本地队列重写为 Gateway queue，也不虚构 Gateway queue 的状态或跨客户端所有权。
OpenClaw 继续拥有远端队列、Run 身份、工具调用与 transcript 的权威状态。
