# Windows 本地语音唤醒实施计划

## 根因与影响链路

Gateway 已保存唤醒词和路由，JunQi 也能读取配置并手动启动 Talk，但缺少 Windows 本地识别运行时。因此配置页看似具备唤醒信息，实际没有麦克风监听、权限错误、音频所有权协调或检测到唤醒词后的 Talk 转发。

链路为：Gateway 唤醒词与路由配置到前端运行时投影，再到 Tauri IPC，再到 Windows SAPI 共享识别器；检测事件返回前端后，先停止 SAPI，根据 Gateway 路由选择已有会话，再复用现有 Talk 入口。任何一层失败都保留真实失败状态。

## 实施顺序

1. 增加 Rust `voice_wake` 命令模块、SAPI 线程、所有权围栏、结构化事件和纯逻辑测试。
2. 注册 Tauri 命令并补充 Windows crate feature，核对 camelCase 参数与返回字段。
3. 增加 TypeScript 原生契约、命令适配和事件解码测试。
4. 增加桌面级 Voice Wake Hook，绑定 Gateway 连接、唤醒词事件、Talk 和手动录音状态。
5. 在 Jarvis 设置页复用现有主题 token 与共享开关，呈现 Windows 本地启用、监听、暂停、错误和不支持状态。
6. 更新当前质量记录、文档索引和项目交接状态，删除或修正被当前官方契约否定的过时结论。

## 验证顺序

1. 运行新增 Rust 与 TypeScript 定向测试。
2. 运行 `cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib`。
3. 运行 Windows 目标 `cargo check`，若当前主机缺少目标或链接环境则如实记录。
4. 运行 `pnpm lint`、完整 `pnpm test`、`pnpm build` 和 `git diff --check`。
5. 扫描全部修改文件和最终说明，确认没有 Emoji。
6. Windows 真机验证保留为独立验收项，不用 macOS 自动化结果替代。
