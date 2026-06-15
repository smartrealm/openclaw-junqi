# JunQi Desktop — 最近修改汇总

## 1. 文件去重修复

**问题**: AI 回复中的文件显示两次 — 一次是 MessageBubble 从 `📎 file:` 文本解析的 FileCard,一次是 ChatView render block 的 FileResultCard。

**修复**: MessageBubble.tsx — 助理消息的 `📎 file:` 文本行不再渲染 inline FileCard,保留 ChatView 的 FileResultCard(含 Open/Reveal/Copy 按钮)。

**文件**: `src/components/Chat/MessageBubble.tsx` (L483)

---

## 2. 历史加载 limit 提升

**问题**: 会话历史只加载最近 200 条,长会话被截断,显示无效 banner。

**修复**: `HISTORY_LIMIT: 200 → 1000`,一次加载 5 倍历史。

**文件**: `src/components/Chat/ChatView.tsx` (L24)

---

## 3. 切会话自动滚到底

**问题**: 切 tab 后新会话停在顶部,不会自动滚到底(因为 scrollLockedRef 跨 session 残留)。

**修复**: 当 `activeSessionKey` 变化时重置 `scrollLockedRef.current = false`。

**文件**: `src/components/Chat/ChatView.tsx` (L131)

---

## 4. 排队消息系统

### chatStore

- `messageQueue: Record<string, Array<{id, text, timestamp}>>` — 每个 session 独立队列
- `drainQueue(key)` — AI 回复完成后自动取队首发下一条
- `clearQueue(key)` — 清空队列,标记消息 status='cancelled'
- `queueSize(key)` — 返回队列长度

**文件**: `src/stores/chatStore.ts`

### MessageInput

- 排队拦截: typingBySession 为 true 时新消息入队而非发送
- QueueStrip 组件: 3 行叠加排队条,含编辑/删除确认/清空确认
- Stop 按钮: abort 当前 + 清空队列
- Drain effect: 监听 typingBySession→false 自动排下一条

**文件**: `src/components/Chat/MessageInput.tsx`

### MessageBubble

- 排队消息 indicator: ⏳ 图标 + "排队中" 文案

**文件**: `src/components/Chat/MessageBubble.tsx`

---

## 5. 文件管理(Tauri IPC)

新增 `managed_files.rs` Tauri 命令:

- `managed_file_open(path)` — 默认 app 打开文件
- `managed_file_reveal(path)` — Finder 显示
- `managed_file_exists(path)` — 检查文件存在

**文件**: `src-tauri/src/commands/managed_files.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src/api/tauri-adapter.ts`

---

## 6. 滚动锁定

**问题**: 翻看历史消息时新消息一直抢滚到底。

**修复**: scrollLockedRef + atBottomStateChange + followOutput 条件化 + CSS scroll-behavior:smooth。

**文件**: `src/components/Chat/ChatView.tsx`

---

## 7. 语音录制优化

- Canvas RMS 包络波形(180 buffer)
- 静音检测(平线)
- Pause/Resume + 计时器冻结
- 自适应噪点门限

**文件**: `src/components/Chat/VoiceRecorder.tsx`

---

## 8. Session Context Bar 重设计

- agent 名称(从 agents 列表查)
- token % + 消息数 + 会话开始~最后活跃时间(右侧)

**文件**: `src/components/Chat/SessionContextBar.tsx`

---

## 9. 其它

- TopBar: 多个 agent 同时工作时显示全部 agent 名称
- Settings: OpenClaw 版本检查 + 更新 badge
- 编辑/重新发送: handleResend 带 prevId 替换原消息(不再出两条)
- 编辑框: min-h 60→100px
- i18n: 三语(queue/refresh history 等 key)

---

## 10. 应用图标规格(dock 图标核对结论)

**问题**: `tauri dev` 调试构建在 macOS dock 里图标显得偏大/异常,疑为图标被改。

**核对结论**: 图标文件**未被改动**(git 无记录,mtime 停在 6/11,早于本次开发),构图符合规范,无需调整。

**图标规格**(`src-tauri/icons/`):

- 源图 `icon.png`: 256×256
- `icon.icns`: 含 1024×1024 表示
- PNG 集: `32x32.png` (32)、`128x128.png` (128)、`128x128@2x.png` (256)
- 构图: 主体(黑色 "JQ" 方块)占画布中心 **~80%**,四周 **~10%** 边距;背景为撑满画布的圆角渐变矩形(橙→蓝→紫)——符合 macOS 应用图标规范
- `tauri.conf.json` `bundle.icon`: `["icons/32x32.png","icons/128x128.png","icons/128x128@2x.png","icons/icon.icns","icons/icon.ico"]`

**关键事实**:

- macOS dock 每个 app 图标格子大小一致,由系统「dock 大小」滑块控制,**app 无法让自己的 dock 图标比别的 app 大**。
- dock 图标显示异常仅出现在 `tauri dev` 调试构建;release `.app`(`/Applications/JunQi Desktop.app`)图标正常。
- 想要打磨过的 dock 图标,需 `npm run tauri build` 出 release 包。


