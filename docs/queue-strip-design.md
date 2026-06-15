# Queue Strip 排队消息设计

## 布局

```
┌─ Chat Messages ───────────────────────────────────────┐
│  User: 帮我写个报告                                      │
│  AI: [正在生成中...]                                     │
└───────────────────────────────────────────────────────┘

┌─ Queue Strip(排队中时出现) ────────────────────────────┐
│ ⏳ 排队中 · 3  等待 12s               ⌄¹    🗑        │  ← header
│                                                       │
│  帮我也算一下预算，看看大概多少钱和有哪些费用        ✕  │  ← line 1(default)
│ ┌──────────────────────────────────────┐  ✓  ✕     │  ← line 2(editing)
│ │ 最后总结一下所有要点和风险...          │            │
│ └──────────────────────────────────────┘            │
│  确认移除? 再点确定                                  ✕  │  ← line 3(confirming delete)
└───────────────────────────────────────────────────────┘

┌─ Input Bar ───────────────────────────────────────────┐
│  输入框...                           ■ Stop  │  发送   │
└───────────────────────────────────────────────────────┘
```

## 尺寸

| 元素 | 高度 |
|---|---|
| Header 行 | 22px |
| Queue line x3 | 66px(22x3) |
| Strip padding | 11px(5+6) |
| Queue Strip 总高 | ~100px |
| Input bar | ~46px |
| 底部总计 | ~146px |

## Header 行

| 元素 | 说明 |
|---|---|
| `⏳ 排队中 · N` | 时钟图标 + 总数 |
| `等待 Xs` | 最早排队消息等待时长,每秒更新 |
| `⌄¹` | 展开图标,右上角 badge 显示隐藏条数 |
| `🗑` | 清空按钮(二次确认) |

## 3 行排队消息

每行一条,仅显示前 3 条。第 4+ 条通过 ⌄ 展开。每行三种状态:

| 状态 | 外观 | 触发 |
|---|---|---|
| default | 灰色文字,右侧 `✕` hover 出现 | 默认 |
| editing | 文字变 input,右侧 `✓` + `✕` | 点文字 |
| confirming delete | 红底 + 删除线 + "确认移除? 再点确定" | 点 `✕` |

## 交互细节

### 编辑(点文字)
1. 文字 -> input 框,可修改
2. `✓` 保存 -> 更新队列中此条 text
3. `✕` 取消 -> 恢复原文
4. Enter 保存,Escape 取消

### 删除(点 ✕)
1. 第一次 -> 行变红 + "确认移除? 再点确定" + `✕` 常显
2. 第二次 -> 从队列移除
3. 3 秒无操作自动取消确认态

### 清空(点 🗑)
1. 第一次 -> header 变红 + "确认清空? 再点确定"
2. 第二次 -> 清空整个队列
3. 3 秒自动取消

### 展开(⌄)
- 点 -> 显示全部排队消息(>3 条时)
- 再点 -> 收起回 3 条

### Stop 按钮
- 红色方块,无文字,无数字 badge
- AI 回复中或队列非空时可见
- 点 -> abort 当前回复 + 清空队列(二次确认)

## 队列生命周期

```
消息1发送 -> AI 处理中(isTyping=true)
消息2发送 -> typingBySession 已 true -> 进队列 -> QueueStrip 出现
消息3发送 -> 继续进队列 -> 计数更新
AI 回完消息1 -> drainQueue -> 消息2 发送 -> QueueStrip 计数-1
AI 回完消息2 -> drainQueue -> 消息3 发送
队列空 -> QueueStrip 消失
```

## 数据流

| 数据 | 来源 |
|---|---|
| `messageQueue[activeSessionKey]` | `chatStore` |
| `typingBySession[activeSessionKey]` | `chatStore` |
| `drainQueue(key)` | `chatStore` |
| `clearQueue(key)` | `chatStore` |

`QueueStrip` 纯展示组件,通过 props 接收数据。编辑/删除/清空通过回调操作 store。

## 组件结构

```
MessageInput.tsx
├── QueueStrip(function component)
│   ├── Header: ⏳ + count + wait + expand + trash
│   └── Lines(x3 max): text + edit input + delete icon
├── Input bar: textarea + file preview + Stop + Send
└── VoiceRecorder(voice mode)
```

## 关键修复点

1. queue check 在 `setIsTyping(true)` 之前 - 第一条消息不会误排队
2. 排队 return 时 `setIsSending(false)` - 不会锁死后继消息
3. `drainQueue` 用 `get()` 不用 `useChatStore.getState()` - 避免 store circular ref
4. `clearQueue` 标记 status='cancelled' 而非物理删除 - 可恢复
