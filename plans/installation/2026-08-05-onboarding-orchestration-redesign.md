# 新手引导编排重构计划

日期：2026-08-05

## 实施顺序

1. 已建立纯前端引导呈现状态模型，统一阶段、标题、等待说明、错误动作和取消语义。
2. 已让 Setup 页面按呈现模型选择执行页、Gateway 就绪页和失败页，移除“Gateway 已停止但自动启动”的冲突文案。
3. 已为 OpenClaw Wizard session store 引入运行时与 Gateway 目标范围，并在目标变化时隔离旧会话。
4. 已收紧 Wizard 页面：只对已验证的官方步骤类型交互；二维码仅作为本地呈现辅助，不以非协议文本制造完成状态。
5. 已以行为测试替代新增的源码字符串断言，覆盖状态模型、会话范围和关键恢复路径。
6. 已执行 TypeScript、前端测试、构建与文档契约验证；Rust 未改动，Windows/Linux/macOS 真机验收仍待执行。

## 文件范围

- `src/pages/SetupPage/`：引导屏幕选择与 Gateway 启动呈现。
- `src/components/setup/`：阶段条、状态面板与可恢复执行页面。
- `src/hooks/useSetupFlow/`：现有安装、运行时和 Gateway 生命周期的状态接线。
- `src/services/openclawWizard.ts`：按运行时身份范围持久化官方 Wizard 会话。
- `src/hooks/useSetupFlow/useWizardSession.ts`：获取已验证的当前 Gateway 目标并应用会话范围。
- `src/services/**/*.test.ts`、`src/components/**/*.test.tsx`：行为回归测试。

## 验证顺序

1. 相关单元测试。
2. `pnpm lint`。
3. `pnpm test`。
4. `pnpm build`。
5. `pnpm test:rust` 与 `cargo check --lib`，若 Rust 无改动则记录为回归验证。
6. `pnpm verify:openclaw-docs`、`git diff --check`、完整文件 Emoji 扫描。
