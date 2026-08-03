# OpenClaw 原生提供方配额对齐规格

日期：2026-08-03

## 目标

在 JunQi Provider 页面呈现当前 Gateway 的原生 provider 配额窗口，并使其与本机 CLI、认证健康、账单和模型调用结果保持
独立。

## 契约

1. 只能调用官方只读 `usage.status`；明确未广告时不得发送 RPC，也不得调用 provider API 或本机 CLI。
2. 请求必须绑定当前 attested Gateway connection；断线、未知方法、连接切换和畸形回包不得更新 UI。
3. 请求不传 Agent 参数，作用域为官方 handler 选择的 Gateway 默认 Agent。
4. 只投影 `updatedAt`、provider id/display name、窗口 label、0 到 100 的 `usedPercent` 与可选 `resetAt`。
5. 不得投影账户邮箱、套餐、账单、历史、请求数、错误文本、API-key 来源、环境变量、profile id 或 Secret。
6. UI 不得将配额窗口描述为本机 CLI 使用量、供应商账单、可用凭据或下一次请求成功保证。
7. 本项不得新增 Gateway scope、配置写入、登录、注销、凭据刷新或平台专属依赖。

## 验收

1. 已广告 Gateway 显示经过严格验证的 provider 配额窗口；不支持、断线、错误和空状态如实显示。
2. 原生 provider 不返回窗口时，页面显示该 provider 无窗口，而不是虚构零用量。
3. 敏感和不必要字段不进入 React 状态、UI 或日志。
4. 回归、静态检查、完整验证、文档和跨平台未验证边界均有记录。
