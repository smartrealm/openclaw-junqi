# Gateway AI 诊断与 OpenClaw 运行时验证

日期：2026-07-30

## 依据

- 本机项目环境安装的 OpenClaw 版本为 `2026.7.1-2`。
- 该版本通过 `openclaw models list --json` 提供当前运行时可用模型清单。
- 该版本通过 `openclaw infer model run --local --json --model <provider/model> --prompt <text> --thinking off` 执行一次性本地模型调用。
- OpenClaw 自身负责配置路径、认证资料和 provider 协议解析。JunQi 不应在 renderer 中重新实现这些职责。

## 原有行为与根因

旧实现由前端读取 provider 配置，再把 API Key、Base URL 和协议字段传入 Tauri command。配置中的凭据引用可能是 profile 或凭据存储引用，而不是可直接作为 Bearer token 使用的明文。JunQi 将引用误当成 API Key 后，会产生与 OpenClaw 实际认证状态不一致的 `401`。

这条链路还扩大了 secret 在 renderer、IPC 参数和错误信息中的暴露面，并复制了 OpenClaw 已拥有的 provider 适配逻辑。

## 目标行为

- 诊断模型只从当前已选 runtime 的 `models list --json` 结果中发现。
- 仅展示可用且带 `default` 或 `configured` 标记的模型，默认模型排在首位。
- 模型调用统一委托给 OpenClaw 的本地 inference command，JunQi 不读取或传递 provider secret。
- 诊断前后校验 runtime mode 和 config path，执行期间发生切换时明确失败。
- 错误与日志先限长并脱敏，再组成诊断上下文。
- 诊断入口复用同一 disclosure 组件，不分别维护不同状态机。

## 入口

当前统一入口包括：

1. 底部 Gateway 状态与自救面板。
2. Gateway 启动失败后的自救面板。
3. 首次设置流程任一错误步骤的进度页面。

入口存在不代表模型调用一定可执行。OpenClaw 尚未安装、所选 Docker runtime 不可用或没有已配置模型时，入口必须保留并显示真实失败原因，不得静默切换到 Native 或其他模型。

## 安全与资源边界

- renderer 只传 `modelRef`、对话和已脱敏诊断上下文。
- Rust 不接收 API Key、Base URL 或 provider protocol。
- command 启动错误不回显完整参数，避免诊断 prompt 进入错误文本。
- stdout、stderr、消息数量和各段文本均有限制。
- 当前 OpenClaw 稳定命令仅提供 `--prompt` 参数，因此脱敏后的有界 prompt 会短暂存在于子进程参数中。该边界未包含 secret，但仍应在上游提供 stdin 契约后重新评估。

## 验证范围

自动化覆盖模型过滤与排序、模型引用校验、上下文脱敏与限长、OpenClaw 输出解析、前端不再读取 provider secret、统一入口渲染和受控子进程输出。

2026-07-30 本机验证结果：

- `pnpm lint` 通过，模块边界检查覆盖 647 个文件。
- `pnpm test` 通过。
- `pnpm build` 通过，provider catalog、collaboration bundle、TypeScript 和 Vite 生产构建完成。
- `cargo fmt -- --check` 通过。
- `cargo check --lib` 通过。
- `cargo test --lib` 通过，共 657 项通过、3 项忽略、0 项失败。
- `git diff --check` 通过。
- 变更文件 Emoji 扫描无匹配。

以下项目仍需目标环境实测：

- Windows Native 的凭据存储与 OpenClaw inference。
- Docker Desktop 冷启动和容器内模型调用。
- macOS 正式签名与公证制品中的子进程权限。
