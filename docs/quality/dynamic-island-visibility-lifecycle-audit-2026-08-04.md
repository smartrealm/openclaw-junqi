# 灵动岛显隐生命周期审计

日期：2026-08-04

## 依据

- OpenClaw 官方 Gateway 协议将 `session.observer` 定义为安全的实时会话标题与状态摘要；它不定义桌面辅助窗口的显隐或关闭语义：
  <https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md>。
- JunQi 现有 `DynamicIslandRuntime` 是主窗口中的状态投影入口；Tauri
  `open_dynamic_island` 与 `close_dynamic_island` 控制本地 `dynamic-island`
  WebviewWindow。

## 审计结论

灵动岛是 JunQi 本地桌面展示层。OpenClaw 只提供可投影的会话摘要，不能把本地窗口
生命周期误称为 Gateway 状态或向 Gateway 追加私有命令。

原实现有两个独立的显隐写入方：主窗口运行时会根据 `shouldShow` 调用打开或关闭命令，
而辅助窗口的关闭按钮会直接调用关闭命令后再异步广播 `hide` 意图。两条 IPC 链到达
Rust 生命周期锁的先后不能由 React 状态保证。关闭先到、旧打开后到时，旧请求会再次
显示窗口，表现为预览长期停留或关闭按钮没有效果。

预览计时器只依赖 `clearTimeout`。在旧回调已经进入执行队列时，清理不保证其不会影响
随后的新预览，因此缺少代际围栏。

## 目标行为

1. 只有主窗口 `DynamicIslandRuntime` 向 Tauri 发出灵动岛显隐命令，并在单一串行队列中
   收敛最新可见性意图。
2. 辅助窗口关闭按钮只发送 `hide` 意图；主窗口根据当前快照决定停止预览或关闭用户启用
   设置，再由该队列关闭窗口。
3. 过期的打开完成后不得覆盖更新后的隐藏意图；显隐切换结束时以最新意图为准。
4. 每次预览启动拥有独立代际，过期回调不得结束后来启动的预览。
5. 预览仍不写入 `dynamicIslandEnabled`；非预览状态的隐藏仍保留关闭该用户设置的既有语义。

## 验证与边界

实现后以可控异步依赖测试打开完成后收到隐藏意图的顺序，以可控计时器测试过期预览
回调，并运行 TypeScript、前端、Rust 与构建验证。

已执行并通过：

- 灵动岛定向回归：14 项通过；
- `pnpm lint`；
- `pnpm test`：245 项通过；
- `pnpm build`；
- `pnpm verify:openclaw-docs`；
- `cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`：707 项通过，3 项
  因外部模型夹具未提供而忽略；
- `git diff --check` 与本次改动文件的 Emoji 扫描。

本机自动化不能替代 macOS、Windows、CentOS 与 Ubuntu 上的真实置顶、多显示器、最小化和
辅助窗口焦点验收；这些平台边界必须单独记录真实运行证据。
