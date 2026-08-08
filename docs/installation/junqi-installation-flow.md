# JunQi Desktop 安装与首次启动流程

日期：2026-08-08

状态：当前实现总览。具体问题的审计、规格、计划和验证记录仍以本页列出的专题文档为准。

## 适用范围

JunQi 是 OpenClaw Gateway 的 Tauri 桌面客户端。安装流程只负责桌面运行时选择、环境探测、Gateway 生命周期交接和官方
OpenClaw Wizard 的呈现；模型、凭据、工作区、渠道、会话和工具的语义由 OpenClaw 官方运行时决定。

当前支持的运行方式是用户明确选择并持久化的 Native 或 Docker。失败时不会静默切换运行方式，也不会用浏览器版 JunQi
替代桌面流程。

## 端到端步骤

### 1. 欢迎与环境检测

首次启动进入欢迎页后，JunQi 检测 Node.js、npm、OpenClaw 命令和 Docker 可用性。检测结果只作为当前设备的运行时事实，
不会把当前开发机的路径、用户或已有 Gateway 当作其他设备的默认值。

环境检测页支持重新检测、返回和继续。操作状态由同一组 `idle`、`navigating`、`redetecting` 状态同时驱动按钮禁用和
实际单飞保护。返回后再次继续必须重新可用，不能被上一次异步操作遗留的锁阻断。

### 2. OpenClaw 数据位置

用户选择并确认 OpenClaw 数据目录。路径由用户选择或已验证的运行时身份提供，不能在前端写死。Native 与 Docker 的
配置、凭据和工作区路径保持属于当前选择的运行方式。

环境检测页和数据位置页之间允许前进、返回、再次前进。步骤切换立即卸载旧页面，只让当前页面执行方向入场动效，旧页
不会继续持有异步引用或拦截新页面操作。

### 3. 选择并准备运行时

用户在 Native 与 Docker 之间做明确选择。随后 JunQi 根据所选运行时执行对应的准备流程：

- Native：检测或安装 Node.js、npm、OpenClaw 命令和所需系统能力；
- Docker：检测 Docker 客户端、守护进程和 OpenClaw 镜像可用性。

Git、Node.js 或 OpenClaw 缺失时进入对应的修复或安装步骤。任何安装、修复或取消都绑定当前运行事务和运行方式，
失败时保留诊断日志，不自动改用另一种运行时。

### 4. 启动 Gateway 并建立经认证连接

JunQi 按当前运行时读取 Gateway 配置，探测端口，复用或启动 Gateway，并建立经身份和权限核验的连接。Gateway 进程
可达不等于配置有效、设备身份正确、授权完成或模型可用。

Gateway 服务交接使用有界等待。服务已启动但连接身份发生变化、未完成认证或所选服务未被验证为运行中时，流程保留真实
失败原因，不以“端口可达”伪报成功。

### 5. 执行官方 OpenClaw Wizard

Gateway 就绪后，JunQi 启动并呈现 OpenClaw 官方 Wizard。模型、凭据、工作区、渠道以及官方允许跳过的步骤均由 Wizard
返回的结构化步骤决定。JunQi 不重写步骤、不猜测插件结果，也不把本地默认值写入 OpenClaw 配置。

Wizard 的交互请求必须在已核验的 Gateway 连接上执行。离开、取消、连接替换或失败后，旧 Wizard 操作不得继续提交；
失败时显示官方步骤标识和诊断，用户可以按官方流程重试。

### 6. 判定配置完成

完成条件分层处理：

1. 所选 Gateway 必须可连接并且身份、运行方式和配置目标一致；
2. OpenClaw 配置必须按官方 `config.get` 结果确认存在且有效；
3. 如果当前 Gateway 提供官方实时模型验证方法，验证结果必须是 `verified` 才能通过；
4. 如果当前 Gateway 没有该官方方法，结果是 `unavailable`，JunQi 显示“模型待核验”并允许继续，不伪报模型成功；
5. 官方方法明确返回认证失败、模型不存在、超时或其他失败时，结果是 `failed`，流程停留在修正模型或凭据的入口。

因此，“配置向导已完成”“Gateway 已启动”和“默认模型已通过实时验证”是三个不同事实，不能合并成一个成功提示。

### 7. 进入 Ready 与 Dashboard

Ready 页是配置完成后的交接页，不是永久健康保证。用户进入 Dashboard 前，JunQi 会在同一操作中再次核验当前 Gateway
和配置；核验失败会回到真实的 Gateway、Wizard 或模型待核验状态。

进入 Dashboard 后，短暂的“正在连接 Gateway”表示桌面工作台正在建立长期会话、模型目录和事件订阅连接，不代表正在重复
安装或重复运行 Wizard。Gateway handoff 已经核验时，工作台只保留必要的连接状态，不重放冷启动流程。

## 返回、取消与恢复

- 返回只回到上一个用户可见决策步骤，不回到会自动重放的安装运行步骤。
- 取消停止当前安装事务或 Wizard 操作，并保留诊断日志；不会删除用户选择的数据位置、OpenClaw 配置或会话记忆。
- Gateway 重启、连接身份变化和 Wizard 过期操作都使用运行事务围栏，旧请求不能覆盖新运行结果。
- 无法确认远端终态时保留“待核验”，不自动重放有副作用的配置或写操作。

## 平台边界

| 平台与运行方式 | 当前结论 | 验证边界 |
| --- | --- | --- |
| macOS Native | 已构建并安装验收 arm64 本机包 | 亮暗主题、窄窗口、快速连续点击仍需专项走查 |
| macOS Docker | 保留 Docker 运行链路 | 当前未完成完整桌面安装验收 |
| Windows Native/Docker | 有对应探测、服务和安装实现 | 需要 Windows 真机验证 UAC、服务归属、路径和凭据库 |
| Ubuntu/CentOS Native/Docker | 目标平台受运行时契约约束 | 未完成发行版真机验证，不扩展为已验证承诺 |

## 相关证据

- [首次启动往返导航审计](setup-round-trip-navigation-audit-2026-08-08.md)：回退、锁和页面生命周期根因；
- [首次启动往返导航修复验证](setup-round-trip-navigation-validation-2026-08-08.md)：自动化、本机安装包和未验证边界；
- [新手引导编排重构记录](onboarding-orchestration-redesign-2026-08-05.md)：状态归属和官方 Wizard 边界；
- [Wizard 与 Gateway 生命周期全量审查](wizard-and-gateway-lifecycle-full-audit-2026-08-02.md)：生命周期入口和协议审计；
- [首次启动流程预览](../previews/junqi-first-run-flow.html)：当前桌面流程的静态视觉预览；
- [`specs/installation/`](../../specs/installation/) 与 [`plans/installation/`](../../plans/installation/)：对应验收条件和实施顺序。

## 当前未验证项

本页不把自动化通过描述为跨平台真机通过。Windows、Ubuntu、CentOS、Docker 冷启动、系统权限提示、亮暗主题、窄窗口、
减少动态效果、快速连续点击、正式签名和公证仍需分别验证并记录。
