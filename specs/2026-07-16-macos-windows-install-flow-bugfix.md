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
