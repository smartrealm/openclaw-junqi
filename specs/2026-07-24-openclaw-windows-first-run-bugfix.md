# Windows First Run Bugfix Spec

## BUG-WFR-01 · Privileged pairing continuation

**Target**：`PAIRING_REQUIRED` 后每 5 秒重新建立 admin transient 连接，批准成功后继续原 RPC；5 分钟超时或用户取消后终止。

**Acceptance**：
- [x] 原管理 RPC 在批准前不发送，批准后只发送一次。
- [x] admin 握手成功事件关闭配对界面；取消会停止当前配对重试。
- [x] 非配对授权错误仍立即失败。

## BUG-WFR-02 · Wizard reconnect gate

**Target**：`wizard.next` 与 `wizard.back` 和 start/resume/retry 使用同一已验证连接门禁。

**Acceptance**：
- [x] Gateway 进程内重启期间不会本地提交管理 RPC。
- [x] 连接恢复后继续当前操作，超时后保留可重试错误。

## BUG-WFR-03 · Wizard error action

**Target**：错误位于向导内容顶部，主动作明确变为“重试”。

**Acceptance**：
- [x] 长页面无需滚到底即可看到错误。
- [x] 错误状态不会把主动作标为“下一步”。

## BUG-WFR-04 · Windows service timeout

**Target**：Windows 服务命令预算为 60 秒，其他平台保持 30 秒。

**Acceptance**：
- [x] 31 秒的正常 Windows 状态检查不会被桌面端提前清理。
- [x] 超时仍使用受控进程树清理并 fail closed。

## BUG-WFR-05 · Recovery classification

**Target**：仅当服务命令超时且清理已确认时建议 Retry；清理未确认不得降级。

**Acceptance**：
- [x] 已清理超时不启动 `openclaw update repair`。
- [x] 插件/载荷损坏仍建议 Repair。

## BUG-WFR-06 · npm progress and log density

**Target**：以 fetch、install/lifecycle、package summary 三类真实输出推进单调进度；HTTP 请求聚合到单一可替换 UI 行。

**Acceptance**：
- [x] npm 活动不再全程固定在 42%。
- [x] 每条 HTTP fetch 仍在原始进程日志中，但不逐条进入 UI。
- [x] 聚合摘要不包含 registry 凭据或完整 URL。

## BUG-WFR-07 · Silent but active npm process

**Target**：stdout/stderr 静默只更新可观测状态，不终止 npm；30 分钟绝对期限和明确慢源仍可终止。

**Acceptance**：
- [x] 静默超过原 10 分钟阈值的 npm 进程可继续运行并正常退出。
- [x] 绝对事务期限仍不会被输出或心跳延长。
- [x] 不再出现“无输出 10 分钟”后自动切换 registry 的路径。

## BUG-WFR-08 · Coalesced npm activity row

**Target**：每次 npm 尝试的连接、网络统计和静默心跳共享一个固定 `logSlot`；逐请求 HTTP 只写原始进程日志。

**Acceptance**：
- [x] 15 秒心跳替换已有 npm 活动行，不追加重复行。
- [x] 聚合行包含累计耗时、请求数、最慢请求及距最后 npm 输出时间。
- [x] setup UI 不接收逐请求 HTTP fetch 事件。

## BUG-WFR-09 · Warm npm cache preference

**Target**：实际安装使用 `--prefer-offline`；已选 registry 和 fallback 顺序保持不变。

**Acceptance**：
- [x] 热缓存元数据不再因安装器参数被强制重新校验。
- [x] 缓存缺失仍允许从 npmmirror 获取包。
- [x] 不使用严格 `--offline`，不改变用户全局 npm 配置。

## BUG-WFR-10 · Transient smoke probe forcing reinstall

**Target**：已安装且结构完好的 OpenClaw，不因一次瞬时 Node 冒烟失败（Windows Defender 冷启动扫描等）被判为损坏而触发全量重装；冒烟测试加重试，且未变更的已验证 payload 跳过重复冒烟。

**背景**：`installed = version_ok && package_valid && gateway_command_ok`，其中 `gateway_command_ok` 依赖每次启动都实跑的 Node 冒烟（`node --check` + 隔离目录 `--version`，各 30s 超时、无重试）。冒烟瞬时失败会令 `installed=false`，前端随即抹掉 `junqi-setup-done` 并把用户打回向导，`repairInvalidInstall` 触发完整 npm 重装。

**Acceptance**：
- [x] 冒烟失败最多重试 3 次带退避，扛过冷启动扫描；持续失败仍判 false，安全性不变。
- [x] path+version+entry(len,mtime) 未变化的已验证 payload 直接复用验证结果，跳过冒烟。
- [x] 安装/更新 payload 校验成功后写入验证缓存，首次安装后 detect 直接命中。
- [x] 缓存仅在 `package_valid` 成立时参与；成为运行时前仍有完整 payload 校验兜底。

## BUG-WFR-11 · Transient node/npm probe forcing reinstall

**Target**：已选定的 Node 运行时及其 npm，不因一次瞬时探测失败（Windows Defender 冷启动扫描等）被判为缺失，从而级联触发 Node 重装或硬阻断安装。

**背景**：`ensure_node_runtime` 在 `runtime.node().available` 为 false 时会重装 Node，而 available 源自 `resolve_node_runtime` 的单次 `node -p` 探测；`check_npm_for_node` 的单次 `npm --version` 超时会直接报错中断安装。两者与 WFR-10 同源（冷启动探测无重试）。

**Acceptance**：
- [x] 已选定 Node 探测最多重试 3 次带退避；持续失败仍判不可用。
- [x] npm 探测同样重试；成功立即返回，空版本/非零退出不误判为瞬时失败。
- [x] 仅对已选定/配置的运行时重试；多候选 PATH 扫描保持单次，避免拖慢多 Node 机器。

## BUG-WFR-12 · Complete dynamic Node probe coverage

**Current**：WFR-11 只对 `configured_node_path()` 返回的显式便携 Node 重试。默认 Windows 安装通过 PATH 动态发现，仍逐个串行执行最长 30 秒的单次探测；npm 还会重试非零退出和进程启动失败。便携 Node 解压及激活后的 `node --version` 校验则仍是单次 10 秒。

**Target**：保留 JunQi 配置入口的独占语义，不写死任何系统或用户路径。系统 Node 候选继续由平台 PATH 动态发现，并发完成首轮探测；只有首轮超时且没有可用完整运行时的候选才执行剩余重试。Node/npm 仅将超时视为可重试，确定性失败立即返回。便携 Node 安装前、staging 和激活后统一使用相同的 Node 探测策略。

**Acceptance**：
- [x] 显式配置的 Node 只探测配置所映射的可执行文件，不回落 PATH。
- [x] 多个 PATH 候选首轮并发执行，结果仍按 PATH 原始优先级选择。
- [x] PATH Node 首次超时后可恢复，持续超时才进入安装；非超时失败不重试。
- [x] npm 首次超时后可恢复，非零退出、空版本和启动失败立即返回。
- [x] 便携 Node staging 与激活后验证可承受首次冷启动超时。
- [x] 代码中不新增固定盘符、用户名、Program Files 或 AppData 路径。
