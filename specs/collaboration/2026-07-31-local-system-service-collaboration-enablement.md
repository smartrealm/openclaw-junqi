# 本机 System Service 协作启用归属修复规格

日期：2026-07-31

## 问题

当官方 OpenClaw System Service 在 JunQi 启动前已经运行时，`ensure_gateway_running` 只看到一个通过选定配置认证的健康端点。若进程内尚未记录 owner，它会把该端点归类为 `External`，即使官方 service 状态明确证明 service 正在运行且绑定 JunQi 当前选定的 state/config/runtime。

Chat 的“启用多 Agent 协作”随后把该错误身份投影为外部管理员手工流程，要求用户传输 `junqi-collab.tgz` 并自行执行 CLI。对于本机、已由选定官方 System Service 持久运行的 Gateway，这与产品目标不符。

## 当前行为

```text
本机官方 service 已运行
JunQi 启动时内存 owner=None
健康端点认证通过
owner=External
Collaboration target=external_local
显示管理员手工安装
```

## 目标行为

```text
本机官方 service 已运行
健康端点认证通过
读取官方 gateway status
service 已安装且正在运行，state/config 属于当前选定目标，runtime 身份可归属或可由官方 handoff 修复
owner=SystemService
Collaboration target=system_service
用户在 JunQi 内确认并启用固定协作插件
```

## 安全约束

1. 健康端点或 localhost 本身不能证明 System Service 归属。
2. 只有官方 service inspection 同时证明 `installed=true`、`running=true`，state/config 属于当前选择，且 runtime/locale 为精确匹配或被现有官方 handoff 契约分类为可重建的 `StaleRuntime` / `StaleLocale`，才恢复 `SystemService` owner。
3. `Foreign`、`Unverifiable`、`Absent`、未运行 service 或检查失败均不得被接管，继续按 `External` fail closed。
4. 不改变 External Gateway 的只读与管理员手工安装契约。
5. 不放宽 collaboration bootstrap 的 target fingerprint、connection、path、ownership、持久性和固定包校验。

## 验收条件

- 已认证健康端点对应匹配且运行中的官方 service 时，运行时身份是 `system_service / junqi_managed / desktop_independent`。
- Chat 协作启用决策为 `install` 且 `canApply=true`。
- 远程 External Gateway 仍为 `manual` 且 `canApply=false`。
- Foreign 或 Unverifiable service 不被恢复为 System Service。
- 自动化不能替代真实 macOS launchd、Windows Scheduled Task、Linux systemd 和完整安装/重启视觉验收。
