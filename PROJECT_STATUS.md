# 项目交接状态

更新时间：2026-08-13

## 当前目标

全面对齐最新版 OpenClaw 首次安装方式，并完成 OpenClaw 官方配置终态到 JunQi 工作台的单一、可核验交接链路。默认使用官方 Guided inference；Classic Wizard 仅保留为用户显式选择的详细配置入口。

## 已完成内容

- 接入正式 `openclaw.setup.detect`、`openclaw.setup.auth.start`、`openclaw.setup.prepare.start`、`openclaw.setup.activate`、`openclaw.setup.verify` 和 `openclaw.chat` 协议，并严格解析结构化响应。
- 默认首次配置改为 Guided；缺少正式方法时明确要求更新 Runtime，不静默回退 Classic。
- 官方候选按返回顺序执行真实激活；供应商授权或准备结束后重新探测候选，不从授权页面、二维码消失或文本推断模型可用。
- Guided 和 Classic 共用 `performOpenClawSetupHandoff`：复用当前已核验连接，连接失效时才通过统一生命周期重连；交接期间绑定同一连接，并依次核验所选 Runtime、官方配置状态和真实模型。
- 官方配置正文复用稳定内容槽。用户取得下一官方步骤时从左向右短距离切换，返回外层阶段时从右向左切换；后台等待、错误和交接状态只淡入，减少动态效果时立即完成。
- 交接失败停留在当前配置阶段；重试不重启官方向导，不恢复旧二维码，不持久化完成标记。
- 冷启动本地完成标记只用于恢复尝试。工作台渲染前会先核验持久安装，再由当前 Gateway 的官方探测确认配置完成。
- 二维码只由当前官方结构化步骤或当前步骤中的唯一一次性授权地址派生；提交、步骤变化、失败、取消或终态后立即销毁。
- npm 12 安装命令加入官方要求的 `--allow-scripts=openclaw`；安装晋升继续核验官方 postinstall inventory 和 JavaScript 入口。
- 删除已被当前原生安装规格取代的旧首次设置与 Classic 完成凭据规格、计划以及相应旧实现。

## 关键技术决策

- OpenClaw 拥有模型、凭据、工作区、渠道、Wizard、onboarding chat 和完成状态；JunQi 只呈现协议并执行桌面交接门禁。
- Gateway 端口健康、进程存在、本地标记和二维码状态均不能证明配置完成。
- Guided 与 Classic 不并行、不互相自动回退，且不能维护不同的交接完成条件。
- 交接顺序固定为认证连接围栏、所选 Runtime 核验、`setup.detect`、`setup.verify`；只有连接失效才重连，未知结果不自动重放有副作用的配置操作。
- 冷启动已经配置的 Runtime 按官方 `setupComplete` 跳过 onboarding；fresh activation 和配置终态交接必须执行真实模型核验。

## 核心文件

- `src/services/gateway/OpenClawGuidedSetupClient.ts`
- `src/services/setup/openClawSetupHandoff.ts`
- `src/services/setup/setupEntryGate.ts`
- `src/hooks/useSetupFlow/useGuidedSetupSession.ts`
- `src/hooks/useSetupFlow/useWizardSession.ts`
- `src/hooks/useSetupFlow/index.ts`
- `src/pages/SetupPage/GuidedSetupScreen.tsx`
- `src/pages/SetupPage/OpenClawConfigurationScreen.tsx`
- `src/App.tsx`
- `src-tauri/src/commands/setup/openclaw.rs`
- `docs/quality/openclaw-native-installation-alignment-audit-2026-08-12.md`
- `specs/2026-08-12-openclaw-native-installation-alignment.md`
- `plans/2026-08-12-openclaw-native-installation-alignment.md`

## 测试与验证

- OpenClaw Guided、候选激活、授权二维码、认证连接围栏、冷启动门禁、Classic、内容方向过渡与设置导航定向测试：110 项通过。
- 完整前端测试 2700 项、脚本测试 238 项通过。
- Rust 库测试 635 项通过、1 项忽略；`cargo fmt -- --check` 与 `cargo check --lib` 通过。
- `pnpm lint`、`pnpm build`、`pnpm verify:openclaw-docs` 与 `git diff --check` 通过。
- 本阶段尚未提交、打包、推送或发布。

## 已知问题与未验证边界

- 真实 provider 登录、真实 completion、官方 onboarding chat、钉钉授权和 Classic daemon 选择尚未在当前 macOS 安装包中完成端到端验证。
- Windows、Linux、Docker、系统服务、凭据库和外部浏览器行为尚未在目标平台真机验证。
- 当前本机已安装的旧 OpenClaw 只能用于复现兼容差异，不能验证最新版 Guided 方法。
- 暗色主题、窄窗口、键盘焦点和减少动态效果尚未完成本轮真机视觉验收。
- 当前构建仍有既有 pnpm 配置迁移警告，但不影响本轮检查与生产构建结果。

## 下一步顺序

1. 在最新版 OpenClaw Runtime 上真机验证 Guided、真实模型、供应商授权与工作台交接。
2. 分别验证 macOS、Windows、Linux 和 Docker。
3. 完成暗色、窄窗口、键盘焦点和减少动态效果视觉验收。
4. 未经明确要求不提交、打包、推送、打 tag 或发布。
