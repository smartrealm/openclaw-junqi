# macOS / Windows 安装链路修复规格

## BUG-CPI-01 · Gateway 真实健康验证

**Current**：端口 TCP 可连即视为 Gateway 已就绪。

**Target**：仅将 TCP 探测用于端口可用性；调用 OpenClaw 文档化的本地 `/health` 端点并校验响应身份后才报告 ready。

**Acceptance**：
- [x] 非 Gateway 的 TCP listener 不会使 setup、状态或启动流程成功。
- [x] 已认证 Gateway 在 macOS/Windows 都可被识别为 ready。
- [x] 端口释放与进程树结束仍只依赖轻量 TCP 探测。

## BUG-CPI-02 · 新装 Node 契约门控

**Current**：目标 npm 包元数据缺失时以 `*` 继续。

**Target**：新装必须取得目标 `engines.node`；npm 安装后从实际 `package.json` 重新读取并验证 Node。

**Acceptance**：
- [x] 无目标契约时不会执行 npm 安装。
- [x] 已安装 OpenClaw 保持从自身 package metadata 读取契约。
- [x] Node 步骤与最终安装成功状态都对应同一动态契约。

## BUG-CPI-03 · macOS Node 恢复页

**Current**：macOS 系统 Node 缺失/不兼容时进入通用错误重试。

**Target**：进入专用 Node 系统恢复页，展示要求、标准安装提示和重新检测。

**Acceptance**：
- [x] macOS 不会自动写入 JunQi 私有 Node 目录。
- [x] 用户完成系统安装后可从页面重新检测并继续。
- [x] Windows 继续使用系统安装器/包管理器回退。

## BUG-CPI-04 · 更新目标契约与恢复

**Current**：无法确认目标包契约时仍可继续更新。

**Target**：元数据不可用即停止更新；更新后验证最终 Node 契约，Gateway 恢复失败使结果明确为失败。

**Acceptance**：
- [x] 未知 target contract 时不会停止 Gateway 或替换包。
- [x] 更新后的 Node 不兼容会在更新流程内被处理，而非留到下次启动。
- [x] Gateway 恢复失败不会显示为完整成功。

## BUG-CPI-05 · Node 下载独立校验

**Current**：镜像下载和 checksum 清单同源。

**Target**：国内镜像下载，官方 Node 发布源解析 SHA256。

**Acceptance**：
- [x] 归档 URL 不必访问海外源。
- [x] SHA256 清单只来自官方 Node 发布源。
- [x] 官方清单不可用时拒绝安装。

## BUG-CPI-06 · 动态存储路径

**Current**：部分 UI 与日志固定指向 `~/.openclaw`。

**Target**：所有路径通过当前配置或 bootstrap 解析。

**Acceptance**：
- [x] 自定义 state/workspace 后，界面打开正确目录。
- [x] 进度日志显示实际配置文件路径。
- [x] 无任何 Node/Git 默认路径写入 OpenClaw state。

## BUG-CPI-07 · 损坏插件的定位、自愈与降级

**Current**：单个损坏插件使 Gateway 拒绝启动，用户陷入"修复并重试→仍失败"死循环。2026-07-16 真机演练确认存在两类损坏：
- **Class 1**（`package.json` main 缺失、加载入口存在）：CLI 结构化命令全部报 loaded，仅 Gateway 烟测拦截；
- **Class 2**（注册的 extension entry 缺失）：config 整体判定 invalid，`plugins list/update/install/disable` 与 `update repair` **全部锁死**，现有修复链无解。

**Target**：修复分支先做结构化插件巡检（`plugins list --json` + 逐插件复刻文件级烟测；list 被锁死时兜底 `config validate --json` 的结构化 `issues[].path`），错误文本中引号内的插件 ID 仅作线索并与结构化列表交叉验证；随后执行自愈梯子（rung 0 `doctor --fix`（仅 invalid config 态）→ 定向 `plugins update` → 按 inspect install spec 强制 `plugins install --force`，每级以复检收尾）；不可自愈时 UI 提供"临时禁用并启动"（`plugins disable`），并明示恢复路径。

**Acceptance**：
- [x] 生产代码零硬编码插件名、零人类文案匹配（错误文本仅提供交叉验证前的线索；class 2 的 ID 来自 validator 的结构化 path 字段）。
- [x] 每级自愈以可判定的复检收尾，梯子不可能死循环。
- [x] 上游发布缺文件的插件（实测 `@larksuite/openclaw-lark@2026.7.9`）被判定为不可自愈，一次点击禁用后 Gateway 正常启动（CLI 路径已真机验证）。
- [x] 本地损坏的插件可被自愈修复（2026-07-16 以 `dingtalk-connector` 真机演练：class 2 损坏 → `doctor --fix` 重新下载载荷至新 generation、config 恢复 valid、通道配置无损；npm 强制重装重新下载载荷的机制经 lark 实测确认）。
- [x] Class 2 检测兜底与 rung 0 的 CLI 行为逐条真机验证（list 锁死、validate 可用且结构化、update/install/disable 锁死、doctor --fix 治愈）。
- [x] Docker 运行时巡检返回空，由镜像刷新修复路径覆盖。
