# OpenClaw 原生产物协议对齐计划

日期：2026-08-03

## 实施顺序

1. 核对官方 artifacts schema、handler、权限、scope 解析和下载模式。
2. 新增严格 `OpenClawArtifactsClient`，覆盖 list、get、download 三个只读 RPC。
3. 在 Gateway data store 中按连接、请求代次和 session 生命周期管理摘要，保存动作绑定
   Gateway 响应和桌面文件保存边界；相对 API URL 绑定当前连接的 HTTP 基址。
4. 在 Chat 会话顶部增加按需加载的产物面板，显示真实摘要和可下载状态。
5. 补充测试、三层文档和跨平台未验证边界，执行全量验证并使用中文 commit。

## 文件范围

- `src/services/gateway/OpenClawArtifactsClient.ts`
- `src/services/gateway/OpenClawArtifactsClient.test.ts`
- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/components/Chat/SessionContextBar.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引和全局能力拓展计划

## 不做的事情

- 不从 XML、workspace、本地路径或浏览器历史合成 Gateway artifact。
- 不调用写操作、工具执行、MCP 或审批 RPC。
- 不把 URL、base64 或 unsupported 模式互相转换成未经 Gateway 确认的下载能力。
