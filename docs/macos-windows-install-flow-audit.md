# macOS / Windows 安装链路审查

审查日期：2026-07-16

范围：首次引导、系统 Node.js / Git、npm 全局安装、OpenClaw 更新与 Gateway 启动。

## 执行顺序

| 阶段 | 问题 | 文件 | 修复方向 |
| --- | --- | --- | --- |
| A | BUG-CPI-01 | `gateway.rs`、`useSetupFlow.ts` | 将 TCP 端口占用与已认证 Gateway 就绪分离。 |
| B | BUG-CPI-02 | `setup.rs`、`system.rs` | 新装只在已取得目标包 Node 契约后继续，并在安装后复核。 |
| B | BUG-CPI-03 | `useSetupFlow.ts`、`SetupPage.tsx` | macOS 缺失/不兼容 Node 进入专门的系统运行时恢复页。 |
| C | BUG-CPI-04 | `openclaw_update.rs` | 更新前必须确认目标 Node 契约，更新后复核并恢复 Gateway。 |
| D | BUG-CPI-05 | `node_runtime.rs`、`setup.rs` | 将 Node 校验信息与下载镜像分离，避免同源校验。 |
| E | BUG-CPI-06 | `setup.rs`、`tauri-adapter.ts` | 从实际配置/存储状态解析展示与打开路径。 |
| F | BUG-CPI-07 | `plugin_recovery.rs`、`useSetupFlow.ts`、`SetupPage.tsx` | 损坏插件的结构化定位、自愈梯子与"临时禁用并启动"降级。 |

### BUG-CPI-01 · 严重 - TCP 端口被误判为 Gateway

**位置**：`src-tauri/src/commands/gateway.rs`、`src/hooks/useSetupFlow.ts`

**问题**：TCP connect 成功即表示 Gateway 已就绪。另一个本机服务占用端口时，首次安装可能跳过配置和启动，并在后续 WebSocket 连接时失败。

**影响**：macOS 与 Windows 都可能显示安装完成，但无法连接 OpenClaw。

**修复**：保留 TCP 探测用于端口释放；新增调用 OpenClaw 文档化 `/health` 端点的 HTTP 健康探测，并让启动、引导和状态查询使用它。

### BUG-CPI-02 · 严重 - 新装时 Node 契约可退回到任意版本

**位置**：`src-tauri/src/commands/setup.rs`、`src-tauri/src/commands/system.rs`

**问题**：目标包元数据不可用时，新装会以 `*` 作为 Node 要求。

**影响**：旧 Node 可先显示通过，随后 npm lifecycle 或 Gateway 才失败。

**修复**：目标包 Node 契约是新装前置条件；安装后读取已安装包 `engines.node` 并再次确认运行时。

### BUG-CPI-03 · 中等 - macOS 系统 Node 不可恢复

**位置**：`src/hooks/useSetupFlow.ts`、`src/pages/SetupPage.tsx`

**问题**：macOS 默认不托管系统 Node，但缺失或不兼容时落入泛化错误页，重试无法改变环境。

**影响**：新用户没有明确的标准安装和重新检测路径。

**修复**：新增系统 Node 恢复页面，展示动态要求、系统安装说明与重新检测动作；保留自定义便携运行时选项。

### BUG-CPI-04 · 中等 - 更新可在未知目标 Node 契约下继续

**位置**：`src-tauri/src/commands/openclaw_update.rs`

**问题**：更新 dry-run 或目标包元数据失败时仍可能继续更新。

**影响**：特别在 macOS 上，包更新成功后 Gateway 才因 Node 不兼容停止。

**修复**：目标契约未确认时拒绝更新；更新成功后复核最终契约，并仅在恢复成功时报告完整成功。

### BUG-CPI-05 · 中等 - Node 下载与校验同源

**位置**：`src-tauri/src/commands/node_runtime.rs`、`src-tauri/src/commands/setup.rs`

**问题**：下载镜像与 SHA256 清单来自同一镜像集合。

**影响**：镜像整体被篡改时校验无法提供独立保障。

**修复**：Node 归档继续从国内镜像下载，校验清单改用官方 Node 发布源；无法取得官方校验值则停止安装。

### BUG-CPI-06 · 低 - 存储路径展示/兜底仍固定为默认目录

**位置**：`src-tauri/src/commands/setup.rs`、`src/api/tauri-adapter.ts`

**问题**：部分日志和“打开工作区/日志”回退写死 `~/.openclaw`。

**影响**：选择其他存储位置后，界面可能显示或打开错误目录。

**修复**：所有展示、工作区和日志打开操作都通过 Rust 的当前 bootstrap/config 解析。

### BUG-CPI-07 · 中等 - 损坏插件使 Gateway 启动陷入不可恢复的死循环

**位置**：`src-tauri/src/commands/plugin_recovery.rs`（新增）、`src/hooks/useSetupFlow.ts`、`src/pages/SetupPage.tsx`

**问题**：OpenClaw 的 post-core payload 烟测在任一启用插件损坏（如声明的 main entry 缺失）时拒绝启动 Gateway，但 CLI 的 `plugins list/inspect/doctor` 均不暴露该错误（2026-07-16 真机实测）。现有"修复并重试"链路的 `openclaw update repair` 与 `plugins update` 都无法修复此类损坏（版本比对相同即跳过），用户没有出口。

**影响**：一个可选插件的发布事故（实测上游 npm 包 `@larksuite/openclaw-lark@2026.7.9` 未打包其声明的 `dist/index.js`）即可让整个桌面端无法启动，惩罚不成比例。

**修复**：修复分支先做结构化插件巡检——`plugins list --json` 列表内逐个复刻文件级烟测（`package.json` 声明的 main entry 必须存在），错误文本仅提供交叉验证前的 ID 线索；随后按自愈梯子处理（定向更新 → 按 inspect install spec 强制重装，每级以复检收尾）；不可自愈时错误页降级为"临时禁用插件并启动"，禁用后明示可在设置中重新启用的恢复路径。全程零硬编码插件名、零人类文案匹配。

**补充（class 2，2026-07-16 演练发现）**：当插件注册的 extension entry 本身缺失时，OpenClaw 判定整个 config invalid，`plugins list/update/install/disable` 与 `update repair` 全部锁死——现有修复链在此状态下无解。对策：检测端在 `plugins list` 失败时兜底 `config validate --json`，从结构化 `issues[].path`（`plugins.entries.<id>`）定位插件；自愈端新增 rung 0 `doctor --fix`（invalid config 态下唯一可用的白名单修复命令，实测可重新下载载荷并恢复 config），仅在该状态触发。
