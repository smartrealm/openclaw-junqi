# Windows OpenClaw Wizard 可视化加固计划

## 实施前提

- 权威版本为仓库锁定的 `openclaw@2026.7.1-2`。
- 在线文档用于确认当前公开行为，实际 wire contract 以安装版本的 schema 和 server methods 为准。
- 只增强官方步骤的表现层，不重写 onboarding。

## Phase A · 浏览器认证入口

| Bug | 文件 | 修改 |
| --- | --- | --- |
| BUG-WVW-01 | `src/services/openclawWizardPresentation.ts` | 新增纯函数，安全提取官方 note 中的 HTTP(S) URL 和明确标记的 device code。 |
| BUG-WVW-01 | `src/pages/SetupPage/WizardScreen.tsx` | 复用系统浏览器和 clipboard 操作，显示通用认证操作，不触发自动提交。 |
| BUG-WVW-01 | 对应测试 | 覆盖普通 OAuth、device-code、QR、文档链接和不安全 URL。 |

## Phase B · 长列表查找

| Bug | 文件 | 修改 |
| --- | --- | --- |
| BUG-WVW-02 | `src/pages/SetupPage/WizardScreen.tsx` | 超过阈值时增加过滤框、选项计数、无匹配状态和清除操作。 |
| BUG-WVW-02 | 对应测试 | 验证过滤不改变 value、顺序、初始选择和 multiselect 状态。 |

## Phase C · 无障碍闭环

| Bug | 文件 | 修改 |
| --- | --- | --- |
| BUG-WVW-03 | `src/pages/SetupPage/WizardScreen.tsx` | 补充焦点管理、alert、`aria-pressed`、输入 label 和 `focus-visible`。 |
| BUG-WVW-03 | 对应测试 | 使用组件行为测试覆盖步骤更新、错误播报和键盘状态。 |
| BUG-WVW-03 | `src/locales/en.json`、`zh.json`、`zh-TW.json` | 补齐搜索、计数、复制代码和空状态文案。 |

## Phase D · 文档与流程图

- 更新审计与验证结果。
- 更新 `docs/previews/junqi-first-run-flow.html`，把普通 OAuth/device-code 可视化入口加入 Wizard 区域。
- 保留真实 Windows 验收为待验证，不把自动化描述为真机结果。

## 验证顺序

1. 纯 presentation helper 测试。
2. WizardScreen 组件测试。
3. OpenClaw Wizard client、QR、Gateway authorization 和 Setup 定向测试。
4. `pnpm lint`、`pnpm test`、`pnpm test:rust`、`pnpm build`。
5. locale JSON 解析、禁用 Unicode 符号扫描和 `git diff --check`。
6. Windows Native、Docker Desktop、系统缩放、键盘、屏幕阅读器和真实 provider 人工验收。
