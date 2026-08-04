# OpenClaw 桌面会话查看声明对齐计划

1. [x] 核对官方 schema、handler、Control UI viewer presence store 与 JunQi 当前会话订阅和 Tauri
   主窗口焦点链路。
2. [x] 新增严格的 Gateway client，管理单连接的目标集合、响应确认、连接变更和传输重置。
3. [x] 以 Tauri 主窗口焦点和活动标签驱动声明，失焦、卸载和断线时回收。
4. [x] 补充回归、规格、质量记录与三层索引。
5. [ ] 执行完整验证并提交。

## 文件范围

- `src/services/gateway/OpenClawSessionViewerPresenceClient.ts`
- `src/services/gateway/OpenClawSessionViewerPresenceClient.test.ts`
- `src/services/gateway/index.ts`
- `src/runtime/OpenClawSessionViewerPresenceRuntime.tsx`
- `src/runtime/OpenClawSessionViewerPresenceRuntime.test.ts`
- `src/App.tsx`
