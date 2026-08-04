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

审计时发现既有文档与源码不一致：文档描述辅助窗口会先调用原生关闭命令，但关闭按钮
实际上只异步广播 `hide` 意图。事件发送成功不代表主窗口监听器已处理该意图，因此主
窗口无响应或事件链断开时，辅助窗口没有任何即时反馈，表现为关闭按钮没有效果。

主窗口运行时仍是唯一的通用显隐写入方：它根据 `shouldShow` 在串行队列中调用打开或
关闭命令。辅助窗口不能反向调用通用关闭命令，否则两条显隐请求到达 Rust 生命周期锁
的先后不能由 React 状态保证；关闭先到、旧打开后到时，旧请求会再次显示窗口。

预览计时器只依赖 `clearTimeout`。在旧回调已经进入执行队列时，清理不保证其不会影响
随后的新预览，因此缺少代际围栏。

## 目标行为

1. 只有主窗口 `DynamicIslandRuntime` 向 Tauri 发出通用灵动岛打开或关闭命令，并在单一
   串行队列中收敛最新可见性意图。
2. 辅助窗口关闭按钮并行发出专用 `request_dynamic_island_hide` 请求和 `hide` 意图。专用
   请求只让当前辅助窗口立即隐藏、撤销进行中的尺寸动画，并且不写入设置、不打开窗口、
   不替代主窗口的通用显隐队列。
3. 主窗口根据 `hide` 意图决定停止预览或关闭用户启用设置，再由该队列收敛后续显示状态。
4. 过期的打开完成后不得覆盖更新后的隐藏意图；显隐切换结束时以最新意图为准。
5. 每次预览启动拥有独立代际，过期回调不得结束后来启动的预览。
6. 预览仍不写入 `dynamicIslandEnabled`；非预览状态的隐藏仍保留关闭该用户设置的既有语义。

## 验证与边界

实现后以可控异步依赖测试打开完成后收到隐藏意图的顺序，以可控计时器测试过期预览
回调；关闭按钮测试必须同时覆盖原生即时隐藏和主窗口意图，以及原生调用失败时主窗口
意图仍被发送。随后运行 TypeScript、前端、Rust 与构建验证。

已执行并通过：

- 灵动岛定向回归：15 项通过，覆盖专用原生隐藏、主窗口意图保留、可见性队列和预览代际；
- `pnpm lint`；
- `pnpm test`；
- `cargo fmt -- --check`、`cargo check --lib`、`cargo test --lib`：708 项通过，3 项因
  外部模型夹具未提供而忽略；
- `pnpm build`；
- `pnpm verify:openclaw-docs`。

已执行 `git diff --check` 与改动完整文件的 Emoji 扫描。

本机自动化不能替代 macOS、Windows、CentOS 与 Ubuntu 上的真实置顶、多显示器、最小化和
辅助窗口焦点验收；这些平台边界必须单独记录真实运行证据。
