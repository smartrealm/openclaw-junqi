# 项目交接状态

更新时间：2026-08-10

## 当前目标

保持 JunQi 作为 OpenClaw 桌面客户端，持续以官方 Gateway 协议、官方源码和结构化回执为唯一依据。当前正在收紧文档：删除已完成的逐项 OpenClaw 审计、规格和计划，只保留当前运行、合规、架构和交接所需记录。

## 已完成内容

- 普通 Gateway 的重连、恢复、重启和停止由 `GatewayLifecycleCoordinator` 统一处理；进程操作后必须等待新的认证连接和匹配的 Runtime Identity。
- 钉钉业务页通过统一生命周期刷新。Native DWS 安装绑定所选 Node、npm 和 prefix，安装及授权均以结构化 JSON 回执核验；Docker 路径保持在所选容器运行时内。
- 钉钉插件资源由归档 manifest 校验工具条目，不使用固定工具数量；当前资源元数据为 33 项工具。
- 普通聊天已删除本地任务图、检查点和 Tool 恢复路径，只投影 OpenClaw 的聊天、会话、transcript、工具事件和原生 Task Ledger。
- 安装完成使用 `openclaw.setup.detect` 的结构化结果；方法明确不支持时启动同一 Gateway 的官方 Wizard，不用本地状态跳过。
- 模型认证与模型目录按 Gateway 已确认的智能体作用域读取；配置写入使用 `config.patch`、`baseHash` 与明确成功回执。
- Cron 列表和运行记录遵守官方分页、快照与回执关系，拒绝旧数组、部分结果和本地截断。
- 文档从 `docs/` 300 份、`specs/` 241 份、`plans/` 237 份 Markdown 收敛为 10 份当前记录。删除项均为无代码消费者的已完成审计、临时规格或执行计划；已核对保留文档不存在失效本地链接。

## 关键技术决策

- OpenClaw 是运行时、会话、工具、任务、配置和插件状态的唯一权威；JunQi 只维护可追溯的桌面投影。
- 进程健康、认证连接和 Runtime Identity 是独立事实。任何业务页不能以端口可达、日志文本或本地标记推断成功。
- Stop 只中断当前 OpenClaw run，不清空会话、不伪造 Tool Result；未知副作用保持待核验，客户端不自动重放。
- Native、Docker、macOS、Windows 和 Linux 的运行时、凭据与服务行为必须分别验证，不互相推断。

## 修改过的核心文件

- `src/services/gateway/GatewayLifecycleCoordinator.ts`、`src/services/gateway/GatewayConnectionSettlement.ts`、`src/runtime/gatewayLifecycle.ts`：统一 Gateway 生命周期与连接核验。
- `src-tauri/src/commands/dws_operation.rs`、`src-tauri/src/commands/dingtalk_plugin.rs`、`packages/junqi-dingtalk/`：DWS 安装授权和插件资源核验。
- `src/pages/BusinessApplicationsPage.tsx`、`src/components/BusinessApplications/`：钉钉接入、身份与就绪状态投影。
- `src/services/chat/sendTransaction.ts`、`src/runtime/OpenClawChatEventRuntime.ts`、`src/task-execution/`：删除普通聊天本地任务语义。
- `src/services/setup/setupCompletionGate.ts`、`src/hooks/useSetupFlow/`、`src/services/openclawWizard.ts`：官方 Setup 与 Wizard 恢复。
- `src/services/gateway/OpenClawCronListClient.ts`、`src/services/gateway/cronRuns.ts`、`src/stores/gatewayDataStore.ts`：Cron 分页与快照一致性。
- `PROJECT_STATUS.md`、`docs/README.md`、`specs/README.md`、`plans/README.md`：当前权威来源、最小记录与交接状态。

## 测试与验证结果

- 合并后已通过 `pnpm lint`、`pnpm dingtalk:test`、Gateway 生命周期 25 项、钉钉授权与就绪界面 14 项定向回归、`cargo fmt -- --check`、`cargo check --lib`、完整 `pnpm test` 与 `pnpm build`。
- 完整前端与脚本测试共通过 2766 项；测试过程仅有既存 Node 弃用和 Radix SSR `useLayoutEffect` 警告，无失败。
- 生产构建已重新生成并核对 DingTalk 插件资源。尚未执行 Tauri 打包或真实安装器验收。
- 本次仅整理文档，已核对剩余 Markdown 的本地链接；尚未重新执行代码构建或真机验证。

## 已知问题

- 本次合并尚未在真实 Tauri 窗口执行 DWS 安装、扫码授权、Gateway 重启后的身份刷新。
- 旧 Gateway 的官方 Wizard 展示、多智能体私有模型认证、Cron 多页数据以及 macOS、Windows、Linux 真机行为仍待验证。

## 尝试过但失败的方案

- 把 `openclaw.setup.detect` 不支持当作配置已完成会跳过官方 Wizard，已删除。
- Cron 列表只读第一页或接受旧数组会漏任务，已删除。
- 聊天本地任务图会重定义 OpenClaw 语义，已删除。

## 下一步开发顺序

1. 用新的 Tauri 构建在不污染用户环境的前提下验证 Gateway 生命周期、DWS 安装授权与业务页刷新。
2. 分别在 Windows、Linux 验证服务、凭据和桌面交互；未验证项持续保留真实边界。
3. 后续较大变更只保留一份当前记录，完成后删除被取代的临时规格和计划。
