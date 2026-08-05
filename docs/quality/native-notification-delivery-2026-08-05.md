# 桌面原生通知投递修复

## 依据

- Tauri 2 官方通知插件文档：<https://v2.tauri.app/reference/javascript/notification/>。
- 当前项目使用 Tauri `2.11.x`；本次加入官方 `@tauri-apps/plugin-notification` 与 Rust `tauri-plugin-notification` `2.3.3`，并在 capability 中授予 `notification:default`。
- 当前 OpenClaw 桌面源码的跨平台实现同样采用原生系统通知，而不是 Electron 或网页通知 API；JunQi 仅使用 OpenClaw Gateway 已投影出的会话与任务事件，不扩展或伪造 Gateway 协议。

## 修复前

1. `src/services/notifications.ts` 尝试调用不存在的 `window.aegis.notify`，再回退到网页 `Notification` API。
2. 应用完成安装后三秒自动请求网页通知权限，和桌面系统权限模型不一致，也会打断首次使用。
3. Rust 侧任务通知写入持久化仓库后没有事件通知，界面只能依赖最长 60 秒的轮询刷新。
4. 聊天通知没有会话目标，用户点击记录不能回到产生消息的会话。
5. 终端窗口的通知面板过滤掉非终端智能体记录，导致同一个持久化通知中心在不同窗口显示不一致。

## 当前行为

1. 前台聚焦时，在应用内显示 Toast；后台时调用官方 Tauri 原生通知插件。
2. 系统权限只在后台首次需要投递时，或用户在设置页主动点击“测试系统通知”时请求。应用启动和新手引导不再主动请求。
3. 用户的通知开关、勿扰模式与隐私锁仍在呈现前生效。隐私锁期间后端不会向 WebView 广播新通知内容。
4. Rust 任务模块持久化成功后发出 `junqi:notification-created`；运行时立即刷新通知中心并按当前偏好呈现，无需等待轮询。
5. 聊天通知持久化 `/chat?session=<encoded sessionKey>`，通知中心点击后使用既有内部路由解析回到对应会话。
6. 所有窗口使用同一持久化通知列表和未读数；终端窗口不再额外过滤通知来源。

## 验证

- `pnpm lint` 通过。
- `pnpm test` 通过：前端 2,820 项与脚本 246 项。
- `cargo fmt -- --check`、`cargo check --lib` 与 `cargo test --lib` 通过；Rust 单元测试 725 项。
- `pnpm build` 通过。
- 已检查 capability 生成物，`notification:default` 包含官方插件的权限与投递命令。
- 本机尚未做 macOS 原生通知权限弹窗、Windows 通知中心和 Linux 桌面环境的真机验收；这些系统行为不能由编译或浏览器预览替代。
