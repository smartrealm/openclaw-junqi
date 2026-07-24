# Windows 首次安装观测复审

审计输入：JunQi Desktop 1.4.11 在 Windows x86_64 上安装 OpenClaw 2026.7.1-2 的逐阶段时间线、进程观测和 Gateway 日志。

## 已证实缺陷

### BUG-WFR-01 · 管理权限配对提示不会自动完成

`createPrivilegedRequester()` 在 admin 握手收到 `PAIRING_REQUIRED` 后立即拒绝原请求并销毁 transient socket。界面虽然显示“每 5 秒重试”，但该管理连接没有重试循环，批准设备后也没有成功事件关闭弹窗。

影响：用户完成 `openclaw devices approve` 后仍停留在等待弹窗，必须手动关闭并重新提交管理动作。

### BUG-WFR-02 · Wizard 步骤提交绕过 Gateway 重连门禁

向导 start/resume/retry 使用 `waitForGatewayConnection()`，但 `wizard.next` 和 `wizard.back` 直接发出管理请求。Gateway 因配置变化进程内重启时，桌面连接会短暂处于未验证状态。

影响：重启窗口内点击下一步会在本地直接失败，产生 `A verified Gateway connection is required for this management action`，Gateway 端没有对应 RPC。

### BUG-WFR-03 · 向导错误位置和主动作语义错误

长向导页面把错误放在内容底部，同时主动作仍显示“下一步”。在 200% DPI 下错误和按钮可能都在首屏之外。

影响：用户无法及时看到失败原因，并可能把重试误解为继续提交答案。

### BUG-WFR-04 · Windows 服务状态命令预算小于实测正常耗时

服务归属检查统一限制为 30 秒；同机独立测量约 12.3 秒，而首次流程两次观测分别约 31 秒和 27.1 秒。第一次在临界点被终止，第二次成功。

影响：Windows 冷缓存或杀毒扫描稍慢时，已注册的 Scheduled Task 会被判定为无法验证，阻断前台 Gateway 启动。

### BUG-WFR-05 · 已完成清理的服务检查超时被误判为需要完整 Repair

服务命令超时且进程树清理成功后，诊断分类仍落入默认 `Repair`。恢复按钮因而运行 `openclaw update repair`、插件扫描和 completion cache，而不是直接重试已知瞬态检查。

影响：一次临界超时会放大为约 4 分钟的无关修复流程。

### BUG-WFR-06 · npm 阶段进度固定且 HTTP 日志淹没主时间线

npm 子进程所有输出统一映射到安装区间的 40%，对应界面的 42%；367 条 `npm http fetch` 又逐条进入 UI，虽然完整原始输出已经单独写入进程日志。

影响：约 5 分钟内进度看似停滞，用户难以区分下载、生命周期脚本和真正卡死。

### BUG-WFR-07 · npm 输出静默被误判为进程无活动

第二次 Windows 记录中，npm 于 15:57:44 完成最后一个可见 HTTP 请求后继续产生 CPU/磁盘活动，但没有 stdout/stderr。安装器仅以输出行更新 activity watch，10 分钟后主动终止 npm；失败文案随后明确记录 `npm install produced no child-process output for 10 minutes`。

影响：正常但静默的依赖解析、解压、原生构建或杀毒扫描会被桌面端误杀。该失败不是 npm 退出码、镜像错误或 OpenClaw 校验错误。

### BUG-WFR-08 · npm 聚合状态仍重复占用时间线

第二次记录同时出现逐请求 `npm http fetch` 诊断和每 15 秒新增的同类心跳。虽然心跳包含请求数与最慢耗时，但没有使用与 Node.js 下载一致的固定可替换行。

影响：长时间静默会生成几十条近乎相同的记录，真正的阶段变化和失败原因仍被淹没。

### BUG-WFR-09 · 已验证源仍强制重新校验 npm 热缓存

安装命令使用 `--prefer-online`。第二次记录中多数包明确显示 `cache revalidated`，59 个请求平均仍耗时 3.583 秒。

影响：即使 npm 默认缓存已有元数据，安装器仍产生不必要的镜像往返；这不会减少隔离 prefix 的本地解压成本，却放大了重复安装的网络阶段。

## 本次不据此修改的现象

- npm 安装最终退出码为 0，约 5 分 15 秒本身不能证明安装失败，也不能证明必须改用 pnpm。
- Gateway 冷启动约 85.7 秒，但最终 ready；本次先消除其前后的错误超时和重连竞态，不把启动耗时直接归因到某个插件。
- CMD 闪窗没有捕获命令行、PID 或退出码，不能据此修改进程启动方式。
- 200% DPI 的整体偏移、持久化日志乱码和安装目录变更后的旧日志缺失均为有效观测，但缺少足够边界证据，不与本次连接/恢复修复混合。

## 验收原则

- 管理 RPC 在 scope upgrade 配对获批后自动继续，原动作最多执行一次；取消必须终止重试。
- 每个 Wizard 管理动作在发送前都必须通过已验证连接门禁。
- Windows 服务检查给足冷启动预算；确认清理完成的超时只建议 Retry。
- npm UI 使用可观测阶段里程碑和聚合网络摘要，完整第三方输出仍保留在进程诊断日志。
- npm 输出静默不得单独触发终止；绝对事务期限与明确慢源继续拥有终止权。
- 同一次 npm 尝试的心跳与网络统计必须使用一个固定 `logSlot` 原位更新。
- 已锁定版本并完成源健康探测后优先使用热缓存；缓存缺失仍从当前选定镜像获取。
