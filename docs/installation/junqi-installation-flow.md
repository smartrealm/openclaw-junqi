# JunQi Desktop 安装与首次启动

JunQi 是 OpenClaw Gateway 的 Tauri 桌面客户端。安装流程只负责桌面运行时选择、环境检测、Gateway 生命周期交接和官方 OpenClaw Wizard 的呈现；模型、凭据、工作区、渠道、会话和工具的语义均由 OpenClaw 决定。

## 当前流程

1. 用户确认存储位置并选择 Native 或 Docker 运行时。该选择会持久化，失败时不会静默切换到另一运行时。
2. JunQi 按所选运行时检测或准备 Node、npm、OpenClaw、Docker 与必要系统能力。路径和凭据始终绑定该运行时，不能使用开发机默认值。
3. JunQi 启动或复用 Gateway，并在认证连接与 Runtime Identity 均完成核验后继续。端口可达或进程启动不等于交接成功。
4. JunQi 调用官方 `openclaw.setup.detect`。官方判断需要配置时，在同一会话呈现官方 Wizard；官方不支持该方法时才进入同一 Gateway 的官方 Wizard，不以本地标记跳过。
5. Wizard 的模型、凭据、工作区、渠道及可跳过步骤均按其结构化步骤呈现。确认步骤的提示只在其确认控件中显示一次；内容精简的通知、确认、进度和操作步骤默认展开日志，用户仍可手动收起。JunQi 不补充、改写或伪造任何 OpenClaw 结果。
6. 完成后进入 Dashboard。后续连接异常由统一 Gateway 生命周期协调器处理，不能把旧连接、文本日志或本地缓存当作成功。

## 当前验证与边界

自动化覆盖 Native 与 Docker 选择、配置交接和连接状态的协议边界。macOS、Windows 与 Linux 的安装器、系统服务、凭据库和真实官方插件行为仍须分别在目标设备验收；未验收时不得描述为跨平台已通过。

Gateway 启动环境使用 Gateway 配置中 `env.vars.OPENCLAW_LOCALE` 的值；JunQi 首次创建配置时才以当前应用语言写入对应的 OpenClaw 原生 locale。Wizard 步骤文本属于 Runtime 或插件所有；若第三方插件将文案静态写为单一语言，JunQi 保持其原始语义，不以客户端字符串匹配伪造翻译，需由该插件接入 OpenClaw 本地化接口后解决。

流程静态预览见 [`../previews/junqi-first-run-flow.html`](../previews/junqi-first-run-flow.html)。
