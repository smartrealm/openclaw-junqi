# OpenClaw 2026.8.1 桌面兼容实施计划

日期：2026-09-01

## 实施顺序

1. 为问题协议解析、主连接 `operator.questions`、事件刷新和提交竞态增加修复前失败的回归测试。
2. 新增独立问题 domain、客户端、主连接事件桥和最小 Zustand 投影；不增加并行 Gateway 生命周期。
3. 在主会话与 Quick Chat 输入区上方新增问题卡，答案保留在组件局部状态，完成展开替换输入框、折叠恢复、键盘、输入法、加载、错误和窄窗口交互。
4. 将两个内置插件的开发依赖和构建元数据升级到 2026.8.1，升级插件版本并重建固定包。
5. 将真实协作 Gateway 验证切换到官方 2026.8.1 不可变容器 digest，更新相应契约测试。
6. 更新安装和升级文档，明确 2.0 迁移继续由官方 `openclaw doctor --fix` 拥有。
7. 运行定向测试、插件验证、前端测试、lint、边界检查、Rust 受影响测试、生产构建和 `git diff --check`。
8. 连续检查问题加载、事件到达、提交成功、提交失败、断线恢复和晚到 resolved 事件；记录未完成的真实 Tauri 视觉与目标平台验证。
9. 更新 `PROJECT_STATUS.md`，只记录当前代码和实际验证结果。

## 文件范围

- `packages/junqi-collab/`
- `packages/junqi-dingtalk/`
- `scripts/verify-collaboration-real-gateway.mjs`
- `src/services/gateway/`
- `src/stores/`
- `src/hooks/`
- `src/components/Chat/`
- `src/pages/ChatView.tsx`
- `src/pages/QuickChatPage.tsx`
- `src/locales/`
- `docs/installation/`
- `docs/quality/`
- `specs/`
- `plans/`
- `PROJECT_STATUS.md`

## 停止条件

- 官方协议字段或权限语义与 tag 源码无法对应时停止实现并标为待验证。
- 密钥值需要进入前端全局状态、日志或持久化才能工作时停止，不以安全降级换取表面可用。
- 真实镜像 digest 无法从官方包记录取得时，不更新真实 Gateway 验证基线。
