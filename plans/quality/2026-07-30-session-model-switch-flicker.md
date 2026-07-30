# 会话模型切换闪动修复计划

日期：2026-07-30

## 实施

- [x] 追踪模型选择器到 `sessions.patch`、Gateway 事件和聊天状态投影的完整链路。
- [x] 核对安装版 OpenClaw `sessions.patch` 的响应与 `sessions.changed` 契约。
- [x] 增加重复失效通道和等价会话投影的回归测试。
- [x] 删除 `aegis:model-changed` 自定义刷新通道。
- [x] 为 `chatStore.setSessions` 增加完整投影结构共享。
- [x] 运行完整 lint、测试、生产构建和差异检查。
- [ ] 在真实 Gateway 配对环境录制并确认模型切换无整页闪动。

## 文件范围

- `src/components/Chat/session-runtime/useSessionRuntimeSettings.ts`
- `src/App.tsx`
- `src/stores/chatStore.ts`
- 对应回归测试
- `docs/quality/`、`specs/quality/`、`plans/quality/`
