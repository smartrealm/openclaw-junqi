# OpenClaw 会话读取目标围栏计划

日期：2026-08-04

## 执行顺序

1. 审计 facade 默认会话目标、官方协议和全部生产调用方。
2. 对每个受影响读取和读写入口复用既有会话目标守卫，删除默认参数并阻止空 key 进入 mutation coordinator。
3. 增加缺失目标在连接请求或 mutation coordinator 前失败的可执行回归测试。
4. 同步三层文档并执行完整自动化验证。

## 文件范围

- `src/services/gateway/index.ts`
- `src/services/gateway/OpenClawSessionTarget.test.ts`
- 本规格、验证记录和三个索引

## 约束

- 不新增 OpenClaw 能力或客户端自建 session 路由。
- 不将当前主会话、运行时、平台或用户身份作为缺失输入的 fallback。
