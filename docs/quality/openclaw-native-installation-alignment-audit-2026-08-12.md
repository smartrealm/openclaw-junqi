# OpenClaw 原生安装与 JunQi 首次配置对齐审计

审计日期：2026-08-12

## 结论

JunQi 当前安装器能够安装官方 OpenClaw npm 包、维持用户选择的 Native 或 Docker 运行方式，并通过统一 Gateway 生命周期完成进程启动、认证连接和服务交接。这些基础设施没有另起一套 OpenClaw Runtime。

但是，首次配置主链路没有对齐 OpenClaw 最新主线。OpenClaw 默认 `openclaw onboard` 已改为“推理能力检测、真实 completion、成功后提交配置、进入 OpenClaw 对话式配置”；经典 `wizard.start` 只用于用户明确选择的详细配置。JunQi 仍把经典 Wizard 当作默认流程，并且现有文档错误地把正式注册的 `openclaw.setup.*` 与 `openclaw.chat` 判定为不存在。当前实现因此缺少最新版默认安装流程的真实推理门禁。

本审计已驱动业务实现：支持正式 Guided RPC 的 Runtime 使用 guided inference；明确返回 unknown-method 的 Runtime 使用官方 Classic Wizard。两者共享 Gateway 与 Runtime 交接门禁，但 Classic 不调用其 Runtime 未提供的 Guided 专属方法。

## 权威基线

本次已重新抓取并核对 OpenClaw 官方仓库主线提交 `812bbd88844769b9abf0ab8b586ada80380aa0f5`，同时保留当前本机稳定发行的复现记录。主线定义 Guided 协议和经典 Wizard；当前本机 Runtime 只注册 `wizard.start/next/status/cancel`。JunQi 依据当前 Runtime 对正式请求的结构化响应协商模式，不使用版本号作为能力开关。

- [Onboarding overview](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/docs/start/onboarding-overview.md)
- [Install guide](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/docs/install/index.md)
- [Guided onboarding implementation](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/src/commands/onboard-guided.ts)
- [Remote Gateway onboarding adapter](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/src/commands/onboard-remote-gateway.ts)
- [System agent Gateway handlers](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/src/gateway/server-methods/system-agent.ts)
- [Gateway method descriptors](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/src/gateway/methods/core-descriptors.ts)
- [Wizard handler](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/src/gateway/server-methods/wizard.ts)
- [Wizard protocol schema](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/packages/gateway-protocol/src/schema/wizard.ts)
- [OpenClaw setup protocol schema](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/packages/gateway-protocol/src/schema/openclaw.ts)
- [Official npm update command builder](https://github.com/openclaw/openclaw/blob/812bbd88844769b9abf0ab8b586ada80380aa0f5/src/infra/update-global.ts)

## OpenClaw 当前原生流程

### 默认引导

1. `openclaw onboard` 默认进入 guided inference 流程。
2. Runtime 检测已有 AI 访问方式与可用 provider。
3. 选择候选项后执行真实 completion。
4. 只有 completion 成功后才提交模型与凭据。
5. 推理能力成立后，OpenClaw 通过 `openclaw.chat` 继续工作区、Gateway、渠道、智能体和插件等配置。
6. 已连接 Gateway 的默认智能体已有配置模型时，跳过首次引导并进入正常界面。
7. 用户需要详细模型、自定义 provider、渠道、远程 Gateway 或导入设置时，显式运行 `openclaw onboard --classic`。

### 正式 Gateway 方法

以下方法已在官方协议、handler 与方法描述符中正式注册，权限均为 `operator.admin`：

| 方法 | 作用 |
| --- | --- |
| `openclaw.setup.detect` | 检测候选 provider、认证方式、准备步骤、工作区和当前完成状态 |
| `openclaw.setup.auth.start` | 启动结构化认证流程 |
| `openclaw.setup.prepare.start` | 启动 provider 准备流程 |
| `openclaw.setup.activate` | 执行真实推理并在成功后提交配置 |
| `openclaw.setup.verify` | 核验当前默认模型的真实推理能力 |
| `openclaw.chat` | 使用 `welcomeVariant: "onboarding"` 继续 OpenClaw 对话式设置 |

这些方法不能再被描述为伪 RPC，也不能从 JunQi 默认流程中删除。

### 经典 Wizard

`wizard.start` 仍是官方能力，负责经典详细配置与渠道专用配置。其 `start` 参数包含 `mode`、`workspace`、`installDaemon`、`flow` 和 `channel`。它不是最新版默认推理引导的替代品。

### npm 安装

官方安装文档明确指出 npm 12 默认阻止 lifecycle script。OpenClaw 的直接全局安装必须允许 `openclaw` 的安装脚本：

```bash
npm install -g openclaw@latest --allow-scripts openclaw
```

官方更新实现同样生成 `--allow-scripts=openclaw`。单独使用 `--foreground-scripts` 不能表达 npm 12 的 allow-scripts 授权。

## JunQi 修复后调用链

### 已对齐部分

- Native 安装会先解析目标 npm 源的确切最新版、Node.js engines 和安装包来源，再安装固定版本，避免一次事务内版本漂移。
- 备用 npm 源只有在确切版本和 Node.js 契约一致时才参与安装，不会把镜像结果冒充官方最新版。
- OpenClaw 安装到隔离 staging prefix，验证包契约后再切换，失败不会覆盖当前有效运行时。
- Native 与 Docker 是用户显式选择并持久化的运行方式，流程中没有静默切换。
- Gateway 启动、认证连接、重启与官方服务交接复用统一生命周期管理器。
- `wizard.start` 的步骤、二维码、终态与进程内 session 生命周期采用结构化投影，没有根据文案伪造成功。
- 存储位置、工作区和桌面运行时路径由 Tauri 与受控配置提供，不依赖当前浏览器路径。

### 当前默认路径

1. 本地 marker 只触发恢复尝试；进入工作台前仍核验安装健康与当前官方配置状态。
2. 连接所选 Gateway 后调用 `openclaw.setup.detect` 协商能力；成功时进入 Guided，明确 unknown-method 时进入官方 Classic。
3. 未完成时按官方候选执行真实激活，或呈现官方认证、准备和结构化 Wizard。
4. 供应商授权结束后重新探测候选，不从授权页面或二维码消失推断成功。
5. 推理成立后通过 `openclaw.chat` 继续官方 onboarding；不支持 Guided 的 Runtime 由 Classic 覆盖完整官方配置。
6. 两条路径的终态统一复用当前已核验连接；连接失效时才重连。Guided 继续核验 `setup.detect` 与 `setup.verify`，Classic 使用当前官方 Wizard 的 `done`。
7. Ready 进入工作台时再次核验，成功后才写入 JunQi 完成标记。

所选 Runtime 的 Gateway 启动属于新的连接代次：启动前主动断开旧 socket，连接动作忽略历史手动地址并重新读取所选 Runtime 的正式目标。读取正式目标失败时进入统一错误态，不回落到默认端点。只有新连接的 `hello-ok`、当前连接围栏和 Runtime Identity 核验全部收敛后，首次设置才可进入配置能力协商。普通设置页的显式连接地址仍保留原行为，不受该首次设置边界影响。

配置步骤正文使用共享稳定内容槽。用户提交后取得新的官方步骤时从左向右短距离切换；返回外层阶段时由全局步骤场景从右向左切换。检测、等待、错误和 Gateway 交接属于后台状态，只做透明度过渡，不用方向动效伪造用户导航。步骤器、标题、日志和底部操作不会随正文重新挂载。

稳定内容槽只稳定页面层级、滚动所有权和过渡身份，不再要求步骤卡片填满窗口剩余高度。官方 `done`、短说明和紧凑状态按真实内容高度呈现，长选项与日志继续使用各自明确的局部滚动边界。JunQi 不裁剪、不补齐也不改写官方步骤正文。

数据位置步骤读取完成后始终停留在完整表单，由用户明确点击“下一步”。提交成功后直接进入运行时阶段，不再插入独立完成页；已有配置、位置修改与恢复事务共享相同的用户确认边界和错误门禁。读取路径不再拥有任何阶段完成调用，避免再次把已有配置误解释为用户确认。

## 差异矩阵

| 编号 | 严重度 | OpenClaw 原生契约 | 修复结果 | 状态 |
| --- | --- | --- | --- | --- |
| INS-01 | P0 | Guided Runtime 先检测并真实验证推理，稳定 Classic Runtime 使用官方 Wizard | 正式请求协商模式，两个流程都保留官方终态 | 代码已修复 |
| INS-02 | P1 | 已配置状态由 Gateway 的 setup 检测与当前默认模型事实决定 | marker 只触发恢复，工作台渲染前复核安装与官方配置 | 代码已修复 |
| INS-03 | P1 | npm 12 安装必须允许 OpenClaw lifecycle script | npm 12 及以上加入 `--allow-scripts=openclaw`，晋升前校验官方 inventory | 代码与 Rust 测试通过 |
| INS-04 | P1 | 经典 Wizard 允许用户明确不安装 daemon | 删除无条件系统服务交接，统一核验当前所选 Runtime | 代码已修复，真机待验证 |
| INS-05 | P1 | `openclaw.setup.*` 与 `openclaw.chat` 是正式 `operator.admin` 方法 | 文档、服务和测试已改用正式方法 | 已修复 |
| INS-06 | P2 | CLI 原生支持 local、remote、Native、WSL2 与详细 classic 模式 | JunQi 仍只声明 Native 与 Docker 本地运行方式，不暗示完整覆盖 | 产品边界，未扩展 |
| INS-07 | P2 | Guided 与 Classic 都是官方配置路径 | 按真实 RPC 能力协商；支持 Guided 时详细配置仍是次级入口 | 代码已修复 |
| INS-08 | P1 | 官方激活、验证和 onboarding chat 可在同一已认证连接内完成 | 不再强制制造新连接；失效时才重连，并以连接标识围栏整个接管过程 | 代码已修复 |
| INS-09 | P0 | 客户端自有数据位置必须由用户确认后才能提交和推进 | 删除读取完成后的自动推进；只有 `configure_storage` 成功事件可以进入运行时 | 代码已修复，真机待验证 |
| INS-10 | P0 | 连接与配置操作必须绑定当前所选 Runtime 和当前认证连接 | 首次设置启动前断开旧连接；连接目标忽略历史手动地址；`connected` 不再替代 Runtime Identity 核验 | 代码已修复，真机待验证 |
| INS-11 | P1 | 官方短步骤应忠实呈现真实内容，不由客户端制造固定高度 | 删除通用步骤场景和正文切换容器的强制满高；页面主内容区继续拥有纵向滚动 | 代码已修复，真机待验证 |
| INS-12 | P1 | 客户端国际化叶子必须保持稳定类型 | 删除 `storage.progress` 的对象与扁平字符串冲突，并在资源加载与测试中拒绝同路径类型冲突 | 代码已修复 |

## 根因

主根因不是某个页面渲染错误，而是协议基线冻结在旧提交：

1. 项目曾基于旧版 OpenClaw 得出 `openclaw.setup.*` 不存在的结论。
2. 后续加固围绕经典 Wizard 的 session 丢失、二维码和服务交接持续演进。
3. 上游后来把 guided inference 和 system agent RPC 正式合入主线，但 JunQi 没有重新执行最新版契约审计。
4. 本地安装版本被用于否定上游最新能力，违背了“本地版本只用于复现兼容差异”的项目规则。
5. 后续删除“数据位置已就绪”重复页时，没有先固定用户确认状态机，而是把“页面读取完成”和“用户提交完成”合并为同一推进事件；实现、测试和流程预览一度共同固化了错误行为。
6. Gateway 启动动作曾在任意旧连接处于 connected 或 connecting 时直接返回，安装等待也只检查布尔连接状态；这使同端口、切换 Runtime 或历史手动地址场景可以把旧 socket 错当成本次启动和身份核验的结果。
7. 显式启动命令与进程状态订阅曾同时驱动首次连接；端点就绪事件如果先于启动命令终态到达，会提前消耗所选 Runtime 的连接策略。当前实现把启动命令终态固定为首次连接的唯一触发点，订阅在该窗口内只更新诊断日志。
8. 稳定向导骨架曾错误等同于固定内容高度，使官方 `done` 等短步骤被空白卡片撑满窗口；稳定边界应属于页面骨架和滚动所有权，而不是步骤正文高度。
9. `storage.progress` 曾同时作为嵌套对象和扁平字符串存在。i18next 按路径解析时返回对象，错误文本因此进入用户界面。资源契约此前只检查键是否存在，没有检查同路径类型冲突。

## 不应修改的既有边界

- 不删除经典 Wizard。它仍是用户显式选择详细配置和渠道配置的官方路径。
- 不把 `hello-ok.features.methods` 当作唯一能力清单。认证完成后按正式契约调用，再依据结构化 unknown-method 或授权响应判断。
- 不用文本解析模拟 `openclaw.setup.*`。
- 不因版本号、功能清单、断线或权限错误切换配置模式。只有正式请求明确返回 unknown-method 时才使用同一 Runtime 已注册的官方 Classic Wizard。
- 不把 Gateway 健康、端口占用、配置文件存在、二维码消失或本地 marker 当作推理完成事实。
- 不让 JunQi 自己定义 provider、认证状态、渠道完成或 OpenClaw 对话状态。

## 验证边界

本轮已完成官方源码、协议 schema、handler、权限描述符、JunQi TypeScript/Rust 调用图和 npm 命令的静态核对。数据位置确认与 Gateway 连接代次的新增定向回归已通过；完整验证结果以本轮结束时的 `PROJECT_STATUS.md` 为准。Windows、Linux、Docker、真实 provider 登录、真实 completion、官方对话式配置和 classic daemon 选择仍需目标环境验证。
