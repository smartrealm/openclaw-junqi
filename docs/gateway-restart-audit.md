# Gateway 重启链路审计

## 严重问题

### BUG-01 - Rust 重启标记不能阻止并发重启

位置：`src-tauri/src/commands/gateway.rs`

`restart_gateway` 每次进入都会直接把 `state.restarting` 写成 `true`。多个调用方可以同时拉起各自的 `openclaw gateway restart` 子进程。一次操作中反复出现 Doctor 警告和 `Restarted LaunchAgent`，正是该竞态的直接表现。

修复：增加进程级异步重启闸门。只有持有者执行重启；并发调用等待持有者完成，随后读取 Gateway 实际状态，不能再创建子进程。

### BUG-02 - 前端重试 API 没有单飞约束

位置：`src/api/tauri-adapter.ts`、`src/App.tsx`、`src/pages/ChannelsCenter/index.tsx`

启动恢复、手动重连、错误恢复、频道设置和配置保存都能调用同一重启 IPC，目前每次调用都会独立进入 Rust。

修复：所有 `window.aegis.gateway.retry()` 统一经过可复用的单飞协调器，并同步发布开始/结束事件。

### BUG-03 - 普通 Gateway 日志被误报为“重启中且未运行”

位置：`src/api/tauri-adapter.ts`

同一个 `handleProgress` 同时订阅 `gateway-log` 和 `gateway-restart-progress`。任何普通日志都会向状态机上报 `running: false`、`retrying: true`；Rust 又会同时发出这两个事件，导致重启日志被追加两遍。

修复：普通日志只更新诊断内容。只有明确的重启进度和重启生命周期事件能改变 retrying 状态，并去除相邻重复行。

## 中等问题

### BUG-04 - 重启 UI 出现晚，失败后还可能一直繁忙

位置：`src/api/tauri-adapter.ts`、`src/components/OfflineOverlay.tsx`

UI 要等异步 Tauri 进度事件到达才知道重启开始；retrying 又只在端口探测成功时清除，因此失败时可能长期卡住。

修复：围绕单飞 Promise 同步发出浏览器内开始/结束事件，结束后立即刷新真实状态。

### BUG-05 - 恢复日志区域太小

位置：`src/components/OfflineOverlay.tsx`、`src/components/BootTimelineOverlay.tsx`

当前只展示 6-8 条记录，高度仅 96-112px，一个 OpenClaw 配置警告块就已经放不下。

修复：加宽恢复区域、提高日志高度、保留更多行，并自动滚动到最新输出。

### BUG-06 - 萌宠 UI 强调色从蓝色变成了龙虾橙

位置：`src/pet/petTheme.ts`

控件、粒子、进度条和状态文字都复用了龙虾本体颜色，导致整个萌宠 UI 偏橙，且与珊瑚色龙虾缺少层次。

修复：恢复随主题变化的蓝色/青色 UI 强调色，龙虾本体颜色保持不变。
