# 安装诊断增强规格

## BUG-INSTALL-LOG-01

**Current**：实时日志在长安装中被截断，复制内容与屏幕的 100 条窗口绑定。

**Target**：内存保留 2000 条，屏幕使用有界渲染窗口，复制覆盖当前保留的全部日志，诊断行可识别。

**Acceptance**：长 npm 安装的首批慢请求仍可复制；UI 不渲染无界列表。

## BUG-INSTALL-LOG-02

**Current**：只有分散的步骤日志，OpenClaw 重试会接在旧文件后。

**Target**：每个应用安装会话维护独立的统一时间线；OpenClaw 每次事务有明确起点。

**Acceptance**：一次安装可按时间跨 Node、Git、OpenClaw 追踪；当前会话不覆盖，历史按完整会话保留最近 8 次。

## BUG-INSTALL-LOG-03

**Current**：下载和 npm 网络日志缺少可比较的耗时/吞吐统计。

**Target**：下载记录响应头耗时、速率和总耗时；npm 记录请求、缓存与延迟汇总。

**Acceptance**：从控制台或磁盘日志可判断慢在连接、传输、缓存缺失还是生命周期脚本。

## BUG-INSTALL-LOG-04

**Current**：安装页无法定位磁盘日志。

**Target**：安装控制台可直接打开 JunQi 管理的诊断目录。

**Acceptance**：入口跨平台，不接收任意用户路径，不暴露凭据。

## BUG-INSTALL-LOG-05

**Current**：Gateway 启动输出只在当前进程内可见，安装失败后缺少持久证据。

**Target**：Gateway 输出经统一脱敏入口同时写入安装会话时间线。

**Acceptance**：依赖安装完成到 Gateway 就绪或失败的全过程可以按时间连续追踪。

## BUG-INSTALL-LOG-06

**Current**：固定的 current/previous 两文件会在超长安装中覆盖最早内容。

**Target**：每个安装会话拥有独立目录，当前会话不做覆盖式轮换；新会话开始时按目录数量清理旧会话。

**Acceptance**：单次安装中的早期内容不会因后续输出被覆盖，至少保留最近 8 个完整会话。

## BUG-INSTALL-LOG-07

**Current**：同一步骤重试时覆盖步骤日志。

**Target**：步骤日志按 attempt 追加边界。

**Acceptance**：同一会话内的首次尝试、回退源和后续重试都可追溯。

## BUG-INSTALL-LOG-08

**Current**：持久化失败静默发生。

**Target**：写入器返回错误，并通过独立事件在安装控制台上报一次。

**Acceptance**：目录不可写或磁盘写入失败时，用户不会看到虚假的“完整日志”状态。

## BUG-INSTALL-LOG-09

**Current**：winget 结束后仅保留 1200 字符摘要，npm/Gateway 原始输出受界面过滤限制。

**Target**：三个进程源均逐行写入带绝对时间戳和 stream 标识的脱敏日志。

**Acceptance**：界面限流、重复警告折叠和摘要长度不影响磁盘取证文件。

## BUG-INSTALL-LOG-10

**Current**：外部进程缺少统一的 PID、退出状态和耗时记录。

**Target**：进程开始和结束都写入会话时间线。

**Acceptance**：能够区分等待 UAC、包管理器下载、安装器执行和退出后的运行时收敛。

## BUG-INSTALL-LOG-11

**Current**：只能打开日志目录。

**Target**：用户选择目标后导出当前诊断目录的只读 ZIP 快照。

**Acceptance**：ZIP 不递归包含自身、不跟随符号链接，失败明确返回且不会留下半成品。
