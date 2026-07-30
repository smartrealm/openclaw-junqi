# Gateway AI 诊断规格

## 问题

Gateway AI 诊断绕过 OpenClaw 的认证解析，在 JunQi 前端和 Rust 中重复读取并拼装 provider 请求，可能把凭据引用误当成 API Key，从而报告错误的 `401`。安装阶段和 Gateway 启动阶段的诊断入口也不一致。

## 目标

- 以当前选择的 OpenClaw runtime 和 config 为唯一权威源。
- 由 OpenClaw 完成模型发现、凭据解析和模型调用。
- 使用同一个可复用组件承载所有 Gateway 与安装失败诊断入口。
- 在 OpenClaw 不可用时保留入口并给出明确原因，不伪造诊断成功。

## 约束

- 不把 provider secret、Gateway token 或凭据引用写入前端状态、日志和诊断正文。
- Native 与 Docker 不得自动互相回退。
- 不硬编码 provider、模型或自定义 endpoint。
- 输入、输出、执行时间和错误文本必须有界。
- runtime 或 config 在诊断期间变化时必须中止结果。

## 验收条件

- `models list --json` 是可选诊断模型的来源，默认模型优先。
- `infer model run --local` 是诊断推理的执行入口。
- renderer IPC 请求不包含 API Key、Base URL 和 provider protocol。
- Gateway 自救和 Setup 错误使用同一个诊断 disclosure。
- 未安装 OpenClaw、runtime 不可用、没有已配置模型和模型调用失败都有明确错误状态。
- 回归测试覆盖模型筛选、脱敏、输出解析、统一入口和 secret 边界。
- TypeScript、Rust、边界检查和生产构建通过。

## 非目标

- 不替代 OpenClaw Wizard 或 provider 配置界面。
- 不在 JunQi 中实现 provider HTTP 协议。
- 不把 AI 诊断作为 Gateway 健康或安装完成的判定条件。

