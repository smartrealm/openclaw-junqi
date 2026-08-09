# 项目交接状态

更新时间：2026-08-09

## 当前目标

以最新版 OpenClaw 官方源码和协议为权威，保持 JunQi 作为桌面客户端的边界。本阶段将
Blues-Code/dingtalk 的钉钉工作台信息架构与接入反馈合入 main，同时保留 main 已有的 DWS
安装、设备授权、取消、输出订阅和 Runtime Identity 围栏。

## 已完成内容

- 已按共同祖先 9f06255c 审查 dingtalk 增量；本次没有新增 Gateway RPC，也没有引入第二套业务运行时。
- 业务侧栏增加当前平台、Session、Agent、有效工具和最近操作摘要，数据仅来自当前会话、
  tools.effective 和本窗口脱敏活动投影。
- 工具筛选集中到独立筛选栏，支持名称、业务域和操作效果，并展示真实工具计数；Profile 仍只存在于
  工具详情和调用参数边界。
- 操作审计增加官方记录、本窗口投影、参与 Agent 和待处理状态摘要，不推断 Agent 委派关系或业务终态。
- 接入与授权工作区统一展示 Session、插件、Agent 双层授权、DWS 身份和当前核验证据。
- 就绪判定已抽为纯函数，并保留插件安装、Gateway 重启、Agent 授权、DWS 安装和 DWS 设备授权动作。
- restartRequired 与插件安装条件同时成立时优先引导重启，避免重复安装已经更新的插件。
- 插件安装和 Gateway 重启使用不定进度；只有命令明确完成时展示 100，不再用 25 或 60 模拟安装比例。
- 异步确认失败保留对话框和上下文，在操作附近显示真实错误，不把失败操作显示为完成。
- 三种语言资源、业务设计、运行时规格、实施计划和独立 HTML 预览已同步。

## 关键技术决策

- OpenClaw 的 tools.effective、tools.invoke、插件审批和结构化结果是业务能力与执行终态的权威来源。
- DWS 只由 junqi-dingtalk 插件执行；Tauri 仅在已验证且允许桌面变更的当前 Runtime 中承接受控安装与
  授权进程，不读取 DWS token，不向远程 Runtime 注入安装脚本。
- JunQi 本地活动记录只保存脱敏关联元数据，不能替代 OpenClaw 审计、钉钉业务实体或 Tool Result。
- 插件安装完成不等于当前 Session 已可用；必须重启 Gateway，并重新读取 tools.effective 与 DWS 身份。
- 未验证的 Runtime、Session、Agent、插件或 DWS 状态保持阻断、待核验或未知，不使用乐观状态补齐。

## 核心文件

- src/pages/BusinessApplicationsPage.tsx：当前 Session 工具、调用、插件和 DWS 操作编排。
- src/components/BusinessApplications/DingTalkReadinessPanel.tsx：接入检查、身份、证据和受控操作入口。
- src/components/BusinessApplications/dingTalkReadiness.ts：无副作用的就绪判定。
- src/components/BusinessApplications/BusinessActivityList.tsx：官方审计与本窗口活动投影。
- src/components/Layout/NavSidebarPanels.tsx：业务应用侧栏的实时上下文。
- src/components/shared/AlertDialog.tsx：全局异步确认、进度和失败反馈。
- src/business-applications/dingtalkPluginInstallPresentation.ts：插件安装阶段投影。
- specs/business/2026-08-08-dingtalk-business-runtime.md：运行时与 UI 验收契约。

## 测试与验证

- 13 项聚焦回归通过，覆盖审计摘要、重启优先级、插件安装入口、DWS 安装与授权动作、工具分组和确认进度。
- pnpm lint 通过；模块边界扫描检查 922 个文件且零违规，四处桌面版本均为 2.3.0。
- 完整 pnpm test 通过；仅输出既有的 Node module.register 弃用提示和 Radix 服务端渲染警告。
- pnpm dingtalk:test 通过 12 项，pnpm dingtalk:validate 通过插件包契约检查。
- pnpm build 通过；协作插件和钉钉插件重新打包，Vite 转换 9261 个模块并成功产出生产构建。
- 三个语言 JSON 已完成解析检查。

## 当前未验证

- 尚未使用正式 DWS 发布包和真实钉钉租户验证授权、业务响应、审批与权威重读。
- 尚未在最新版真实 Gateway 验证插件加载、tools.effective、tools.invoke 和审批事件往返。
- 尚未在真实 Tauri 窗口验证亮色、暗色、键盘焦点、窄窗口和减少动态效果。
- 尚未完成 macOS、Windows、Linux 与 Docker Gateway 的目标平台安装、凭据、重启和 UI 验收。
- 本轮没有修改 Rust 源码，因此未重新执行 Rust 格式、检查和测试。

## 尝试过但未采用的方案

- 未直接选择任一冲突侧；只保留 dingtalk 会丢失 main 的真实 DWS 操作链，只保留 main 会丢失侧栏、
  审计摘要、核验证据和筛选收敛。
- 未采用分支中用普通确认框直接安装插件的旧路径；保留 main 现有安装对话框、阶段反馈和 Runtime Identity 围栏。
- 未接受伪造安装百分比；Gateway 没有细粒度进度事件时只展示不定进度。

## 下一步顺序

1. 在受控最新版 Gateway 验证插件加载、工具投影、审批与 DWS 身份。
2. 使用测试租户复现读取成功、未授权、参数错误、取消和未知写结果。
3. 在 macOS、Windows、Linux 和 Docker Runtime 完成桌面视觉与运行验收。
4. 根据真实回执补充协议差异记录，不以当前安装版本建立永久能力门禁。
