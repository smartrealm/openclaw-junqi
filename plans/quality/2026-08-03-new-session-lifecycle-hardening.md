# 新建会话生命周期加固计划

## 执行顺序

1. [x] BUG-NS-01：在 `OpenClawSessionLifecycleClient` 与 `sessionCreate` 中加入受验证的 `fork` 创建意图；`SessionActionsMenu` 使用该意图。
2. [x] BUG-NS-02：以完整规范化创建意图去重；`NavSidebar` 复用当前 Agent 解析；普通会话省略持久 `label`，本地化空标题仅用于展示。
3. [x] BUG-NS-04：重构 `useAgentScopedSession`，成功后才消费 URL 参数，失败时由 `ChatPage` 提供显式重试。
4. [x] BUG-NS-05：运行并保持 session projection revision 的竞态回归测试。
5. [x] 增加协议、协调器、路由行为回归测试，执行 lint、`git diff --check` 与 Emoji 扫描；全量测试和生产构建未取得可判定终态，详见审计记录。

## 平台边界

本计划只修改 React 端与 Gateway protocol client，不改变 Rust/Tauri command、Native/Docker 运行时选择或任何操作系统启动项。真实 Gateway transcript 分叉以及 macOS、Windows、Ubuntu、CentOS UI 验收分别记录为未验证边界。
