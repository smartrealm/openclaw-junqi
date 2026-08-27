# 主窗口生命周期恢复审计

日期：2026-08-26

## 审查范围

本次审查覆盖主窗口原生关闭、最小化、macOS Dock 再激活、托盘菜单、托盘图标、单实例启动、萌宠窗口、灵动岛和 OpenClaw 控制窗口返回桌面的完整调用链。窗口行为以项目锁定的 Tauri `2.11.5` API 与当前源码为准；当前机器运行状态只用于复现，不作为其他目标环境的默认条件。

官方依据：

- Tauri [`WebviewWindow::close`](https://docs.rs/tauri/2.11.5/tauri/webview/struct.WebviewWindow.html#method.close) 会先发出 `WindowEvent::CloseRequested`，应用可以通过 [`CloseRequestApi::prevent_close`](https://docs.rs/tauri/2.11.5/tauri/struct.CloseRequestApi.html#method.prevent_close) 阻止销毁。
- macOS Dock 再激活通过 [`RunEvent::Reopen`](https://docs.rs/tauri/2.11.5/tauri/enum.RunEvent.html#variant.Reopen) 进入应用事件循环。
- [`AppHandle::show`](https://docs.rs/tauri/2.11.5/tauri/struct.AppHandle.html#method.show) 用于在 macOS 取消应用级隐藏，`WebviewWindow::unminimize`、`show` 与 `set_focus` 分别恢复窗口状态、可见性和前台焦点。

## 已确认问题

### BUG-WIN-01 · 严重 · 红色关闭没有结束整个应用

位置：`src-tauri/src/lib.rs`、`src/api/tauri-adapter.ts`

当前主窗口没有处理 `WindowEvent::CloseRequested`。原生关闭按钮和前端 `close()` 都会销毁 `main` 窗口；托盘和萌宠仍可使应用进程继续运行。此后 Dock、单实例和托盘恢复入口调用 `get_webview_window("main")` 得到空值并直接结束，形成“应用仍在运行但窗口永远打不开”的状态。

影响：

- 用户点击 Dock、托盘或再次启动应用都无法恢复主窗口。
- Gateway、终端或其他常驻任务可能仍在后台运行，界面却没有可达恢复入口。
- 现有入口普遍忽略错误，无法区分主窗口缺失和恢复动作失败。

修复方案：主窗口收到关闭请求时先阻止默认窗口销毁，再调用 `AppHandle::exit(0)` 结束整个桌面应用及其附属窗口。黄色最小化、应用级隐藏和辅助窗口返回主界面继续通过统一恢复函数处理；主窗口缺失时返回明确错误并记录诊断。

### BUG-WIN-02 · 中等 · 恢复顺序和失败语义分散

位置：`src-tauri/src/lib.rs`、`src-tauri/src/tray/menu.rs`、`src-tauri/src/commands/pet.rs`、`src-tauri/src/commands/console.rs`、`src-tauri/src/commands/dynamic_island.rs`

至少六个入口分别组合 `show`、`unminimize` 和 `set_focus`，调用顺序不一致，多数通过 `let _ =` 丢弃错误。macOS 应用级隐藏也没有统一调用 `AppHandle::show`。任一入口修复后，其他入口仍可能保留旧缺陷。

影响：

- 最小化、应用级隐藏和普通失焦在不同入口表现不一致。
- 恢复失败只能表现为无响应，无法从日志定位失败步骤。
- 后续窗口行为修改容易继续产生多套实现。

修复方案：建立唯一的主窗口恢复函数，按“显示应用、取消最小化、显示窗口、聚焦窗口”的固定顺序执行；托盘切换只负责决定隐藏或恢复，不再自行实现恢复步骤。

## 验证边界

自动化回归必须覆盖主窗口存在与缺失、统一恢复入口和托盘最小化决策。Rust 格式、编译、测试和生产前端构建通过后，仍需在真实 macOS 应用中连续验证原生关闭、最小化、Command+H、Dock 点击、托盘点击和再次启动；Windows 与 Linux 的关闭到托盘和托盘恢复需要目标平台实测。

## 验证结果

- 新增 3 项 Rust 回归通过，覆盖关闭请求先阻止默认销毁再请求应用退出、最小化或隐藏状态选择恢复路径，以及主窗口缺失返回明确错误。
- `cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib` 通过；完整 Rust library 测试为 663 项通过、1 项既有忽略。
- `pnpm lint` 通过，模块边界检查覆盖 949 个文件，四处桌面版本保持 `3.2.1`。
- `pnpm build` 通过，协作与钉钉固定插件包契约、TypeScript 和 Vite 生产构建完成。
- 当前未重启正在运行的客户端，避免中断用户的 Gateway 与会话；macOS 连续真机交互、Windows 和 Linux 目标平台验证仍未执行。
