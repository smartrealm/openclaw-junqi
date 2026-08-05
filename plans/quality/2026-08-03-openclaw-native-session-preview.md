# OpenClaw 原生会话预览对齐计划

日期：2026-08-03

## 实施顺序

1. 核对官方 `sessions.preview` schema、handler、权限、64-key 限制和响应状态。
2. 新增严格的 `OpenClawSessionPreviewClient`，验证请求边界和完整响应 key 集合。
3. 在 Gateway data store 中按连接和请求代次缓存预览，处理能力未声明、分批请求、
   断线清理和迟到响应。
4. 在 Session Manager 卡片呈现官方最近消息状态，补充多语言和客户端回归测试。
5. 更新三层文档，执行 TypeScript、lint、全量测试、构建、官方链接、差异检查并提交。

## 文件范围

- `src/services/gateway/OpenClawSessionPreviewClient.ts`
- `src/services/gateway/OpenClawSessionPreviewClient.test.ts`
- `src/stores/gatewayDataStore.ts`
- `src/pages/SessionManager.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 索引和全局能力拓展计划

## 不做的事情

- 不在 JunQi 本地读取 transcript 文件或合成最近消息。
- 不调用未由官方 schema、handler 和方法目录证明存在的 RPC。
- 不把 `sessions.preview` 变成会话分组、Task 状态机、Stop 恢复或工具结果来源。
- 不把安装版本号或 Gateway 保守发现列表写成能力开关；连接能力以 Gateway 正式响应为准。
