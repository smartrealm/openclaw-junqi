# OpenClaw 桌面语音与 Jarvis 实施计划

1. [x] 直接审阅 OpenClaw 官方 Voice Wake、Talk、会话组文档、schema、Gateway handler 与客户端实现。
2. [x] 审查 JunQi 设置、运行时、会话、音频、灵动岛、萌宠、IPC、持久化、测试与国际化调用图。
3. [x] 删除本地关键词模型、后台唤醒、待机绑定、自动会话分组及其无引用代码和历史说明。
4. [x] 将设置页收敛为 Gateway 全局触发词和官方路由编辑器，分别处理加载、写入和事件投影。
5. [x] 将 Jarvis 收敛为用户主动启动的全窗口 Talk：严格读取 catalog 和会话音频格式，使用原生采集与播放。
6. [x] 加入固定 Gateway 连接租约、session、turn 与 generation 所有权围栏，以及输入背压、超时、取消和播放缓存上限。
7. [x] 对齐官方 Talk 中继工具链、`clear` 与 `mark`，使用精确 session、turn、call、run 身份等待、中止、确认播放并提交 provider 工具结果，不介入聊天 ReAct 恢复。
8. [x] 统一停止确认、barge-in、播放溢出、会话替换与失败释放，未确认 worker 退出时显式失败，保留 OpenClaw session 历史和服务端工具恢复语义；普通发送继续服从 Gateway 队列权威。
9. [x] 同步真实原生音量、灵动岛、萌宠与国际化投影，修复预览关闭竞态、全窗口最高应用层和键盘交互；清理旧许可与无生产调用方的 Jarvis 任务来源。
10. [x] 运行完整 TypeScript、Rust、协作插件、构建、文档链接、无引用、Emoji 与差异验证，并记录未执行的目标平台与真实音频边界。
11. [x] 复核本地 `main`，审查最终暂存差异并使用中文提交。
