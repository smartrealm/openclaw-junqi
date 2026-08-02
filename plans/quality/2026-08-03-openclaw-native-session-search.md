# OpenClaw 原生会话检索对齐计划

日期：2026-08-03

## 实施顺序

1. 以当前 OpenClaw 官方 protocol、session schema、sessions-read handler 和 method
   scope 核对请求、响应、权限和索引状态。
2. 新增严格 `OpenClawSessionSearchClient`，只构造官方参数并解析官方命中。
3. 在 `gatewayDataStore` 中绑定能力广告、连接实例、最新查询、响应状态和断线清理。
4. 在 Session Manager 保留本地元数据筛选，增加 Gateway 转录命中区域和明确状态。
5. 补充三种语言、协议回归、请求栅栏回归和断线回归，执行完整验证并使用中文 commit。

## 文件范围

- `src/services/gateway/OpenClawSessionSearchClient.ts`
- `src/services/gateway/OpenClawSessionSearchClient.test.ts`
- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/pages/SessionManager.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引和全局能力拓展计划

## 不做的事情

- 不调用 `sessions.resolve`、写操作、工具执行、浏览器 API 或客户端自建索引。
- 不把 `sessions.preview`、本地 metadata 或 transcript 缓存冒充 `sessions.search` 命中。
- 不因 Gateway 未广告方法而静默切换到伪造的远程结果；页面只显示官方能力状态。
