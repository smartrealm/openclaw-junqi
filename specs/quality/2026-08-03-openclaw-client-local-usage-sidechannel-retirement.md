# OpenClaw 客户端本机用量旁路退役规格

日期：2026-08-03

## 目标

移除不属于 OpenClaw Gateway 契约的本机 Claude/Codex 用量读取，避免 JunQi 将 Gateway 默认 Agent 或本地 CLI 的账户
额度错误标注为当前 PTY 任务的额度。

## 约束

1. JunQi 只能通过 OpenClaw Gateway 展示 OpenClaw 原生提供的配额事实。
2. 不得读取本机 Claude OAuth 凭据、调用 provider 用量 HTTP 接口、启动本机 Codex app-server 或注册对应 Tauri command。
3. 不得用 `usage.status` 伪造本地 PTY 任务的 Claude 或 Codex 配额；该方法不接收客户端指定 Agent。
4. Provider 页面既有 `usage.status` 展示必须保持独立，不得因退役旁路而回退到本机 CLI。
5. 删除后不得保留 Windows 专属禁用、平台路径、Secret 或无引用类型。

## 验收

1. 前端、Tauri command 注册和 Rust 模块均不存在 `read_usage_snapshot` 或本机 OAuth 用量实现。
2. AgentRunView 不显示由本机 Claude/Codex CLI 派生的 5h 或 7d 额度。
3. 回归测试防止 AgentRunView 重新接入该旁路。
4. 文档记录官方能力边界、跨平台影响、验证结果与未验证边界。
