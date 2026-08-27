# 会话输入区原生交互实施计划

日期：2026-08-25

## 根因

现有 Composer 把普通发送、废弃 `sessions.steer` 和停止实现为三个独立主按钮，同时丢弃 Gateway 已返回的有效队列模式。结果是 UI 无法说明一次输入实际会发送、转向、排队还是中断。

## 实施顺序

1. 增加主操作纯状态解析和键盘决策回归，覆盖空闲、活动运行、草稿、附件、四种队列模式、断线和历史加载。
2. 投影官方会话 `queueMode` 与 `effectiveQueueMode`，未知值不默认。
3. 将 `ComposerInputSurface` 收敛为固定单一主操作位，并为每种动作接入本地化名称和可访问标签。
4. 将发送 Hook 改为单一入口；普通操作省略队列覆盖，修饰键操作显式请求 `steer`。
5. 将 Gateway 分发统一为 `chat.send`，删除 `OpenClawSessionSteerClient` 及其专属测试。
6. 调整 Stop 的精确运行与键级清队列分支，删除空闲 Escape 历史召回。
7. 更新旧队列审计、AI 交互文档、文档索引和项目状态。
8. 依次执行定向测试、完整前端测试、lint、build 和差异检查；条件允许时在 Tauri WebView 连续验证。
9. 将已发送消息的会话分叉与多 Agent 协作入口改为紧凑且可区分的操作，隐藏后台确认态，并补充组件语义回归。
10. 收敛所有 ChatStore 全量订阅，并删除输入框对完整消息数组的持续订阅，保证草稿与助手流式增量只触发必要投影，补充稳定性回归。
11. 待实施：将已发送消息的 `sessions.rewind` 入口改为明确的“编辑并重新发送”，把分叉收进带文字的更多菜单，保留复制直达和独立协作入口，并补充消息操作完整状态回归。

## 预期文件

- `src/components/Chat/MessageInput.tsx`
- `src/components/Chat/message-input/ComposerInputSurface.tsx`
- `src/components/Chat/message-input/composerPrimaryAction.ts`
- `src/hooks/chat/useComposerSuggestions.ts`
- `src/hooks/chat/useComposerInterruption.ts`
- `src/hooks/chat/useMessageSend.ts`
- `src/services/chat/sendTransaction.ts`
- `src/services/gateway/index.ts`
- `src/services/gateway/OpenClawSessionProjection.ts`
- `src/utils/openClawSessionProjection.ts`
- `src/stores/chatStore.ts`
- 对应测试、语言资源、文档和 `PROJECT_STATUS.md`

## 验证

- 纯状态矩阵证明同一状态只产生一个主操作。
- Gateway 分发测试证明转向使用 `chat.send queueMode: "steer"`，普通发送不附加覆盖。
- 投影测试证明只接受官方合法队列模式。
- 键盘测试证明 Enter、Shift+Enter、修饰键 Enter、Escape 和输入法组合互不冲突。
- 投影测试证明草稿和助手流式增量不会改变应用根运行态或输入框非文本依赖，并检查源码不再存在运行时无 selector 的 ChatStore 消费者。
- Stop 测试证明不会删除会话或 transcript，且键级停止按官方行为处理队列。
- WebView 连续验收记录亮色、暗色、窄窗口、焦点、加载、失败和从发送到停止的完整变化。

## 当前状态

输入区主操作、状态订阅和现有回归已完成；已发送消息操作栏的“编辑并重新发送”表达尚未实施。后续修改前先补充失败回归，完成后重新执行完整前端测试、lint、生产构建和真实 Tauri 视觉验收。当前源码的真实 Tauri 输入法、活动运行、暗色与窄窗口连续视觉状态尚未完成，没有用旧单实例窗口或模拟 Gateway 状态替代。
