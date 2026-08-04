# OpenClaw Talk Barge-in Turn 围栏计划

日期：2026-08-04

## 执行顺序

1. [x] 审阅 Talk client、事件桥、协调器、Composer barge-in 和原生播放链路。
2. [x] 核对当前 OpenClaw `talk.session.cancelOutput` 与 `talk.event` 的官方控制面边界。
3. [x] 记录 TALK-02 的状态竞争、范围和未验证边界。
4. [x] 在协调器中以当前输出 `turnId` 围栏已取消的 audio 事件。
5. [x] 添加取消 in-flight、旧 turn 事件拒绝、新 turn 继续播放及状态释放回归。
6. [x] 执行定向、类型、边界、构建、完整测试、官方链接、diff 与 Emoji 验证，并中文提交。

## 非目标

- 不实现 Talk provider、会话、turn 或音频协议。
- 不变更 `talk.session.cancelOutput` 参数、会话 close 顺序或 Gateway 事件序列。
- 不为跨系统原生播放增加平台专属分支。
