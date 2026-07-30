# Gateway AI 诊断实施计划

## 文件范围

- `src-tauri/src/commands/gateway_rescue.rs`
- `src-tauri/src/commands/openclaw_cli.rs`
- `src-tauri/src/lib.rs`
- `src/services/gatewayRescue.ts`
- `src/components/GatewayRescueChat.tsx`
- `src/components/GatewayAiDiagnosticDisclosure.tsx`
- `src/components/GatewaySelfRescuePanel.tsx`
- `src/pages/SetupPage/ProgressScreen.tsx`
- 对应 locale、测试和验证文档

## 实施顺序

1. 核对项目安装版本的 OpenClaw 模型发现与本地 inference 契约。
2. 删除前端 provider secret 解析和 Rust provider HTTP 分支。
3. 增加受控、参数不回显的 OpenClaw command wrapper。
4. 通过 OpenClaw 获取候选模型并执行有界、脱敏的诊断请求。
5. 抽取统一诊断 disclosure，接入 Gateway 自救与 Setup 错误页面。
6. 更新三种语言和回归测试。
7. 运行前端测试、Rust 测试、边界检查、生产构建和 diff 检查。

## 验证命令

```bash
pnpm lint
pnpm test
pnpm build
cd src-tauri && cargo fmt -- --check
cd src-tauri && cargo check --lib
cd src-tauri && cargo test --lib
git diff --check
```

## 真机边界

Windows Native、Docker Desktop 冷启动、macOS 正式签名与公证制品不由本次本机自动化替代，结论单独记录在验证文档中。

