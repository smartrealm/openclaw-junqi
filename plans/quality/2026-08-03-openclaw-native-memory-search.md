# OpenClaw 原生记忆检索对齐计划

日期：2026-08-03

## 实施顺序

1. 以当前 OpenClaw 官方 descriptor、handler、memory host types 和 protocol 文档确认
   `memory.search` 的权限、请求和响应边界。
2. 新增严格 `OpenClawMemorySearchClient`，只解析官方字段并保留可选状态元数据。
3. 在 `gatewayDataStore` 中绑定连接实例、最新查询和断线清理；能力发现遗漏不作为发送门禁。
4. 在 Memory Explorer 保留工作区文件视图，增加显式 Gateway 检索视图和错误状态。
5. 补充三种语言、协议回归、状态栅栏回归和页面边界测试，执行完整验证并使用中文 commit。

## 文件范围

- `src/services/gateway/OpenClawMemorySearchClient.ts`
- `src/services/gateway/OpenClawMemorySearchClient.test.ts`
- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/pages/memory-explorer/MemoryExplorerPage.tsx`
- `src/pages/memory-explorer/MemoryExplorerPage.test.ts`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引和全局能力拓展计划

## 不做的事情

- 不调用 `doctor.memory.*` 修复方法、写操作、工具执行、MCP 或审批 RPC。
- 不把工作区文件、transcript XML、浏览器数据或自定义 HTTP API 合成为 Gateway 记忆结果。
- 不因 Gateway 实际未知方法而静默切换到伪造的远程结果；发现列表遗漏时仍请求，本地工作区视图仍保持独立可用。
