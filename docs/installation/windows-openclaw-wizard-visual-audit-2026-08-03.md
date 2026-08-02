# Windows OpenClaw Wizard 可视化链路复审

日期：2026-08-03

## 审查目标

本次只读复审聚焦 Windows 安装 JunQi 后，用户在 JunQi 内完成 OpenClaw 官方 Wizard 的可视化操作是否忠实、完整、可恢复和可访问。

审查链路：

```text
Windows NSIS
→ 首次启动与存储选择
→ Native / Docker runtime
→ OpenClaw 与 Gateway 启动
→ operator.admin Wizard RPC
→ JunQi WizardScreen 可视化
→ 官方服务交接
→ selected Gateway 复核
→ 模型 live probe
→ Ready
```

## 权威依据

1. 在线官方文档：<https://docs.openclaw.ai/zh-CN/start/wizard>，本次已实际读取。
2. 仓库锁定版本：`openclaw@2026.7.1-2`。
3. 本机 CLI：`OpenClaw 2026.7.1-2 (0790d9f)`。
4. 已安装源码与协议：
   - `docs/start/wizard.md`
   - `docs/reference/wizard.md`
   - `docs/start/wizard-cli-reference.md`
   - `dist/schema-BuOFpc7K.js`
   - `dist/session-Db7bzmh4.js`
   - `dist/wizard-Cl5NHpYn.js`

在线文档和已安装版本均确认：官方 Wizard 负责风险确认、模型与认证、工作区、Gateway、渠道、Web Search、后台服务、健康检查和技能；Gateway 通过 `wizard.start`、`wizard.next`、`wizard.cancel`、`wizard.status` 暴露结构化步骤，客户端应渲染这些步骤，而不是重新实现官方流程。

## 当前实现结论

JunQi 的总体边界正确：

- 使用官方 `wizard.*` RPC，不运行一套平行配置器。
- Wizard 请求使用 `operator.admin` 临时管理通道。
- 支持官方七种步骤类型：`note`、`select`、`text`、`confirm`、`multiselect`、`progress`、`action`。
- 保留官方标题、消息、选项、初始值、敏感字段和 executor。
- 敏感文本使用 password input，前端不持久化答案历史。
- rejected answer 不推进官方会话；Retry 读取当前官方步骤，不重放答案。
- 最终完成仍需官方服务所有权交接、selected Gateway 身份复核和真实模型调用。
- Native 与 Docker 不静默互换。

但可视化层仍有三个需要整改的问题，以及两个明确的协议限制。

## 发现

### BUG-WVW-01 · HIGH · 浏览器认证信息没有通用可视化操作面

**位置**：

- `src/pages/SetupPage/WizardScreen.tsx`
- `src/services/openclawWizardQr.ts`

**当前行为**：

JunQi 只有在官方消息同时包含“扫描”语义时，才提取 HTTP(S) URL，并显示复制链接和浏览器打开按钮。普通 OAuth、device-code 或浏览器认证 note 仍只显示为纯文本。

已安装 OpenClaw 的 xAI device-code 流会产生如下官方 note：

```text
Open this URL in your browser and enter the code below.
URL: <verification URL>
Code: <user code>
Code expires in ... minutes.
```

这不是 QR scan note，因此当前 `resolveOpenClawWizardQrUrl()` 返回 `null`，JunQi 不提供“打开浏览器”“复制链接”“复制代码”操作。

OpenAI Codex OAuth 还会由 Gateway 进程调用 `openUrl()`。Native Windows 用户会话中通常可以打开系统浏览器；Docker 容器、后台服务、浏览器启动失败或远程 Gateway 中则不能把“Gateway 尝试打开浏览器”等同于“用户已看到认证页面”。

**影响**：

- Windows Docker 路径可能进入等待认证，但用户没有明确的宿主浏览器入口。
- device-code 流只能让用户从大段纯文本中手工选取 URL 和代码。
- 认证失败看起来像 Gateway 或模型故障，而不是缺少用户可执行的浏览器动作。
- QR 特例的视觉体验优于普通 OAuth，官方认证方式之间不一致。

**目标**：

- 从官方 `note.message` 中提取浏览器安全的 HTTP(S) URL，作为只读表现增强；不得改写原文。
- 普通认证 note 显示“在浏览器中打开”和“复制链接”。
- 对明确标记的 `Code:` / “代码：”行，仅提供复制代码，不自动提交、不写日志、不持久化。
- generic URL 不触发自动推进；只有当前已验证的 QR polling 语义可以自动确认官方步骤。
- URL 必须拒绝非 HTTP(S)、userinfo 和无法解析的值。

### BUG-WVW-02 · MEDIUM · 大型 provider、model 和 channel 选项缺少查找能力

**位置**：`src/pages/SetupPage/WizardScreen.tsx`

**当前行为**：

`select` 和 `multiselect` 将全部官方 options 直接渲染为两列卡片。没有搜索、选项计数、当前筛选结果或无匹配状态。

OpenClaw 2026.7.1-2 的官方 Wizard 已包含大量模型提供方、自定义提供方、模型目录、渠道插件、Web Search provider 和技能选择。模型选择还可能来自动态 provider catalog，数量不受 JunQi 控制。

**影响**：

- Windows 小屏、系统缩放和窄窗口中需要滚动很长距离才能找到目标项。
- 模型和渠道名称相近时，用户容易选错。
- 两列卡片适合少量选择，不适合动态长目录。
- Setup footer 虽然保持可见，但内容查找效率仍然很低。

**目标**：

- 当选项超过明确阈值时显示本地搜索框和总数；少量选项保持当前紧凑布局。
- 搜索只过滤官方 `label` 和 `hint` 的显示，不修改 option value、顺序或提交语义。
- 已选择的 multiselect 项在筛选后仍保持选择状态。
- 提供无匹配状态和清除搜索操作。
- 不根据 provider、model 或 channel 文本猜测业务分类。

### BUG-WVW-03 · MEDIUM · 步骤切换和错误状态的无障碍反馈不完整

**位置**：`src/pages/SetupPage/WizardScreen.tsx`

**当前行为**：

- 新官方步骤到达后，没有把焦点移动到步骤标题或首个输入控件。
- 错误卡没有 `role="alert"` 或 live region。
- 单选卡使用普通 button 表达选择，但没有 `aria-pressed`。
- text step 的可访问名称优先使用 title；多数官方 text step 只有 message，因此回退为泛化的“OpenClaw 配置值”，没有直接绑定官方问题文本。

**影响**：

键盘和屏幕阅读器用户可能不知道步骤已更新、回答被拒绝或当前单选状态改变。Windows 高对比度和辅助技术场景下，状态不能只依赖边框和颜色。

**目标**：

- 步骤变化时聚焦可聚焦的步骤标题容器，随后保持正常 Tab 顺序。
- 错误使用 alert/live 语义，但不得重复播报持续轮询状态。
- select option 增加 `aria-pressed`。
- text input 使用官方 message 作为 label 或 `aria-labelledby` 来源，同时保留 placeholder。
- 所有新增焦点样式使用 Aegis token，并支持 `focus-visible`。

## 协议限制，不作为 JunQi 缺陷

### LIMIT-WVW-01 · 官方 RPC 不提供稳定阶段、总步数或百分比

`WizardStepSchema` 只有 step id、type、title、message、options、initialValue、placeholder、sensitive 和 executor。没有 phase、total、index 或 percent。

因此 JunQi 不能从标题、模型名、渠道名或自然语言猜测“当前处于模型阶段”或“完成 60%”。当前顶层只显示“OpenClaw 配置”一个产品阶段是正确的 fail-closed 行为。

### LIMIT-WVW-02 · 当前安装版本的 Gateway prompter 不发出连续 progress step

虽然 wire schema包含 `progress`，但 `WizardSessionPrompter.progress()` 在 2026.7.1-2 中是 no-op。JunQi 已支持 Gateway-owned progress step 的单次恢复读取，但不能凭空生成真实进度。

## 已确认无新增缺陷的边界

- 官方风险确认的 confirm 明确传入 `initialValue: true`；JunQi 对 confirm 初始值的处理与当前版本一致。
- select 初始值不存在时选择首个官方 option，与交互式 CLI 的默认选择语义一致。
- text validation error 保留当前 session 和 step，不会把失败答案写入前端历史。
- `wizard.status` 后无答案的 `wizard.next` 用于读取当前步骤，符合已安装服务端实现。
- Wizard 终态不直接进入工作台；仍通过 handoff、selected Gateway probe 和 model live probe。
- QR URL 只接受 HTTP(S)，拒绝 URL userinfo；终端 QR 读取失败不会伪造成功。

## 建议实施顺序

1. 先补 BUG-WVW-01，保证 Windows Docker、device-code 和浏览器失败路径有明确可执行入口。
2. 再补 BUG-WVW-02，改善模型、渠道和搜索提供方长列表。
3. 最后补 BUG-WVW-03，并用真实组件行为测试替代新增源码字符串断言。

## 验证要求

自动化：

- 普通 OAuth note、device-code note、QR note、文档 note 和不安全 URL 的解析测试。
- WizardScreen 组件测试覆盖打开、复制、搜索、单选、多选、错误 alert 和焦点。
- OpenClaw Wizard client、Gateway authorization、Setup 路由完整回归。
- TypeScript、模块边界、完整前端测试、Rust library tests、build 和 `git diff --check`。

Windows 真机：

- Native x64 和至少一个 ARM64 或 x86 架构。
- Docker Desktop 冷启动后的 OAuth/device-code。
- OpenAI Codex OAuth、xAI device-code、API key、自定义 provider。
- 长模型列表、渠道多选、200% 系统缩放、窄窗口、键盘和屏幕阅读器。
- Scheduled Task、Startup-folder fallback、Gateway handoff 和模型 live probe。

## 本次验证边界

本次完成了文档、已安装源码和当前 JunQi 实现的交叉审查，并用当前 `WizardScreen.wizardInitialValue()` 验证 confirm omitted/true/false 的实际映射。未修改运行时代码，未启动或终止 Tauri，未重启 Gateway，未在 Windows 真机执行 Wizard，也未声称在线文档已经固定为本地安装版本的不可变契约。
