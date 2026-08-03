# OpenClaw 审批界面与事件收敛计划

日期：2026-08-04

## 实施顺序

1. 核实当前官方 client guide、Gateway protocol 与 unified approval handler，并完成活动中心、
   facade、事件、状态、翻译、测试和文档的全局引用图。
2. 将 approval event bridge 改为仅识别官方事件名和 approval ID；保留 scoped transient
   连接的身份绑定、重连和释放，不接受旧 payload 作为状态投影。
3. 在统一审批面板中按监听、连接、list 回填的顺序订阅事件；事件仅刷新 pending snapshot，
   终态 history 保持按现有显式刷新与 resolve 后刷新读取。
4. 删除第二审批面板、旧 hook、旧 facade 与旧接口；清理活动中心、主事件路由、翻译、测试和
   过时文档链接。
5. 补充事件 ID、连接身份变化、回填竞态和单一审批入口的回归测试，执行定向与完整验证。

## 影响文件

- `src/pages/ActivityCenter.tsx`
- `src/components/Activity/OpenClawApprovalsPanel.tsx`
- `src/services/gateway/index.ts`
- `src/services/gateway/approvalEventBridge.ts`
- `src/services/gateway/collaborationEventBridge.ts`
- `src/stores/openclawApprovalsStore.ts`
- 对应测试、翻译和 Markdown 索引

## 完成判据

实现满足规格、旧引用归零、相关测试和全量静态验证通过，并以中文提交信息提交。
