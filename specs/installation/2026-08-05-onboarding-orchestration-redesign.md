# 新手引导编排重构规格

日期：2026-08-05

## 依据

- JunQi 是 OpenClaw Gateway 的桌面客户端，不拥有 OpenClaw 的配置决策、模型认证或向导步骤。
- 官方 OpenClaw 当前源码 `docs/reference/wizard.md` 说明 `wizard.start`、`wizard.next`、`wizard.status`、`wizard.cancel` 供客户端呈现向导步骤；客户端不得重实现其业务流程。
- 官方 OpenClaw 当前源码 `docs/start/onboarding-overview.md` 说明图形 macOS App 仅适用于 macOS，CLI 覆盖 macOS、Linux、Windows/WSL2。JunQi 的 Native 与 Docker 运行时必须按本机能力检测，不得假设某个操作系统或工具已存在。

## 当前行为

新手引导把持久化导航、安装事务、Gateway 启动、OpenClaw Wizard 会话和模型验证拆分在多个状态源中。

- `gateway-stopped` 的页面文字表示 Gateway 未运行，但进入该状态后会自动启动 Gateway，主按钮只是禁用的加载态。
- `checking`、安装、Gateway 就绪和普通错误共用进度页面，用户无法从页面结构判断当前是否需要等待、重试或返回。
- Wizard 会话仅保存一个未绑定运行时身份的 WebView 本地键；更换 Native/Docker 或 Gateway 目标时可能先恢复旧会话。
- QR、进度与完成页存在依赖文本内容的客户端自动推进逻辑。

## 目标行为

引导必须是由当前真实运行时驱动的可解释流程，而不是多个页面状态的叠加。

1. 引导页面以五个稳定阶段呈现：环境、数据位置、运行时准备、OpenClaw 配置、验证完成。
2. 每个页面明确属于以下之一：用户决策、可取消执行、可恢复失败、官方 Wizard 交互、已验证完成。禁止把这些语义混在同一通用页面。
3. Gateway 启动属于可取消执行状态，页面必须说明正在启动并给出取消动作；不得显示“已停止”同时在后台自动启动。
4. Wizard 会话持久化必须至少绑定选中的运行时模式和 Gateway WS 地址。绑定不一致时只能忘记本地会话记录并启动或恢复当前 Gateway 的官方会话，不得把旧会话号发送给新目标。
5. OpenClaw 返回的已知 Wizard 步骤字段继续严格校验；未知附加字段只做兼容性投影。JunQi 不根据渠道名称、固定 URL 字段或自造配置字段改变向导业务状态。
6. 完成标记仍须同时满足：当前 Gateway 可达、当前运行时配置不要求 onboarding、当前模型探测成功。
7. 外部 OAuth 或渠道授权可经 Tauri Shell 打开系统浏览器；这仅是第三方授权交接，JunQi 主流程仍运行在桌面窗口中。

## 非目标

- 不新增 OpenClaw 未提供的远程配置、Provider、渠道、模型或安装能力。
- 不修改 OpenClaw 配置文件格式、Wizard RPC 参数或 Gateway 服务所有权。
- 不以固定 Node、Git、Docker 路径、平台名称或下载镜像替代 Rust 能力探测。

## 验收条件

1. Gateway 自动启动时，页面标题与操作均表示“正在启动”，可取消并回到最后一个稳定决策点。
2. 运行时切换后，旧 Wizard 会话 ID 不会用于新运行时或新 Gateway WS 地址。
3. 页面阶段由状态模型导出，普通错误、进行中操作和 Gateway 就绪分别有独立摘要与可用操作。
4. 已有运行时、Native、Docker、Gateway 重启、配置改写后重新连接、Wizard session lost、模型不可用均有回归测试。
5. Windows、macOS、Linux 的实际安装与服务行为只在对应真机或 CI 目标上声明验证；本机静态检查不能代替目标平台验收。
