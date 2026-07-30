# 会话模型切换闪动修复规格

日期：2026-07-30

## 当前行为

一次模型修改会产生本地更新、自定义模型刷新和 OpenClaw 会话变更刷新。
等价刷新还会重建当前会话对象，导致聊天内容区域整体重绘。

## 目标行为

- 模型修改成功后立即呈现 Gateway 确认的解析结果。
- 会话元数据只通过 OpenClaw `sessions.changed` 进行权威失效刷新。
- 等价会话快照不得改变对应会话对象引用。
- 真实字段变化、session identity 轮换和删除流程不得被结构共享掩盖。
- 不硬编码模型、供应商、上下文窗口或事件成功条件。

## 验收条件

- `useSessionRuntimeSettings` 和 `App` 不再生产或监听 `aegis:model-changed`。
- `aegis:sessions-changed` 链路继续生效。
- 两次内容等价的 `setSessions` 调用保留会话对象引用。
- 模型切换、删除、部分列表、运行投影和 sessionId 轮换测试继续通过。
- lint、完整测试、生产构建和 `git diff --check` 通过。

## 未验证边界

- 真实 Gateway 下模型切换的帧稳定性和不同平台 WebView 表现需真机验收。
