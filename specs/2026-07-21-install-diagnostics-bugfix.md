# 安装诊断增强规格

## BUG-INSTALL-LOG-01

**Current**：实时日志在长安装中被截断，复制内容与屏幕的 100 条窗口绑定。

**Target**：内存保留 2000 条，屏幕使用有界渲染窗口，复制覆盖当前保留的全部日志，诊断行可识别。

**Acceptance**：长 npm 安装的首批慢请求仍可复制；UI 不渲染无界列表。

## BUG-INSTALL-LOG-02

**Current**：只有分散的步骤日志，OpenClaw 重试会接在旧文件后。

**Target**：每次安装进程维护滚动的统一会话日志；OpenClaw 每次事务有明确起点。

**Acceptance**：一次安装可按时间跨 Node、Git、OpenClaw 追踪，文件大小有上限。

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
