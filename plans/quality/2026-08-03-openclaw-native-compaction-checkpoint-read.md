# OpenClaw 原生压缩检查点只读计划

日期：2026-08-03

1. 核对最新版官方 schema、query handler、权限与 Session Manager 现状。
2. 新增严格、连接围栏保护的 checkpoint reader 和回归测试。
3. 在 Session Manager 按用户显式操作呈现列表和详情，不接入写操作。
4. 补充文案、验证记录、全量检查和中文提交。

## 文件范围

- `src/services/gateway/OpenClawSessionCompactionCheckpointsClient.ts`
- `src/services/gateway/OpenClawSessionCompactionCheckpointsClient.test.ts`
- `src/services/gateway/index.ts`
- `src/hooks/useOpenClawSessionCompactionCheckpoints.ts`
- `src/pages/SessionManager.tsx`
- `src/locales/{en,zh,zh-TW}.json`
- 对应 docs、specs、plans 索引

## 不做的事情

- 不创建或恢复 branch，不更改 transcript、Task checkpoint、模型或会话状态。
- 不使用浏览器、shell、本地文件或静态数据推导 checkpoint。
