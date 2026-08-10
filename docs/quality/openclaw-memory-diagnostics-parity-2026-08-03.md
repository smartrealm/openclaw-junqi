# OpenClaw Memory 只读诊断能力对齐

状态：历史记录。本文依据的安装包曾包含 `doctor.memory.remHarness`，但 OpenClaw 最新主线已删除该方法。
JunQi 当前只保留 `doctor.memory.status`；现行边界见
[`Gateway 原生能力与扩展一致性审计`](gateway-native-extension-consistency-audit-2026-08-10.md)。

## 依据

本机已安装 OpenClaw `2026.7.1-2`。依据来自随包源码：

- `dist/server-methods-NpEcZnvp.js` 将 `doctor.memory.status` 与 `doctor.memory.remHarness` 注册为 Gateway 方法。
- `dist/doctor-CY1P6IgW.js` 定义了两个方法的参数和响应结构。
- `doctor.memory.status` 接受可选 `agentId`，`probe` 或 `deep` 会触发 embedding 探测；未探测时可能返回 `checked: false`。
- `doctor.memory.remHarness` 返回有界的 REM、grounded 和 deep 预览，并将候选数量限制在 1 到 100。

## 当前行为

- `src/services/gateway/memoryDoctor.ts` 提供参数构造和严格响应解析。
- `src/services/gateway/index.ts` 通过已认证的日常 Gateway 连接调用两个只读 RPC；不使用 `operator.admin`，不调用修复类 Memory 方法。
- `Memory Explorer` 保留 `MEMORY.md` 与 `memory/` 文件浏览，同时显示 Gateway 返回的 embedding 状态、Dreaming 阶段统计和 REM 只读预览。
- Gateway 诊断失败不会阻断本地文件浏览；状态、REM 和文件视图分别保留自己的加载与错误状态。

## 边界

- `doctor.memory.status` 的 `deep` 请求会触发 embedding provider 探测，页面只在用户打开 Memory Explorer 或手动刷新时执行，不在后台轮询。
- `doctor.memory.remHarness` 只展示官方返回的有界预览；未接入 `dreamDiary`、`backfillDreamDiary`、`resetDreamDiary`、`repairDreamingArtifacts`、`dedupeDreamDiary` 等会写入或清理数据的方法。
- Gateway 端只返回当前默认智能体的 REM 预览；页面不自行拼接其他工作区或推断路径归属。

## 验证

- `src/services/gateway/memoryDoctor.test.ts` 覆盖官方降级响应、Dreaming 统计、REM 成功/失败响应、参数上限和不完整载荷拒绝。
- `src/pages/memory-explorer` 保持 Gateway 诊断失败时的本地文件浏览回退。
- 已执行 `pnpm exec tsc --noEmit`、相关 Node 测试和 `git diff --check`。

## 未验证边界

- 当前机器未连接真实 Gateway 执行这两个 RPC；响应契约来自安装包源码，桌面端真机权限和 provider 延迟仍待验证。
- 未在 Windows、Linux 和 Docker 运行时分别做 Memory provider 探测；页面会如实显示 Gateway 返回的错误，不切换运行时。
