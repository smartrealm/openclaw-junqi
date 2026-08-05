# OpenClaw 审计账本对齐计划

日期：2026-08-03

## 实施顺序

1. 核对 `hello-ok.features.methods` 的保守发现语义，确保它不成为连接生命周期内的发送门禁。
2. 建立独立 `OpenClawAuditClient`，实现 activity 优先、正式未知方法后的 legacy 回退、请求校验和响应解析。
3. 在 Gateway facade 暴露只读 `listAuditEvents`，保持 `operator.read` 权限边界。
4. 让主 Chat 与 QuickChat 将 Gateway 返回的 metadata-only 事件映射到共享追溯面板。
5. 增加三语言文案、协议单元测试、连接生命周期测试和 UI 契约测试。
6. 执行类型检查、定向测试、全量测试、构建、边界检查和差异检查后提交中文 commit。

## 文件范围

- `src/services/gateway/Connection.ts`
- `src/services/gateway/OpenClawAuditClient.ts`
- `src/services/gateway/index.ts`
- `src/components/Chat/chatResponseTrace.ts`
- `src/components/Chat/ChatResponseTracePanel.tsx`
- `src/components/Chat/ChatView.tsx`
- `src/pages/QuickChatPage.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应测试、spec、docs 和索引

## 完成判据

只有在代码契约、自动化验证和文档未验证边界都同步后，才能声明本项完成。真实 Gateway、Windows、CentOS 和 Ubuntu 的联机行为仍需在各自目标环境单独记录，不能由本机测试代替。
