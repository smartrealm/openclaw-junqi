# JunQi 项目状态

更新时间：2026-08-25

## 当前目标

当前目标是修复协作插件更新入口被旧插件数据库错误封死、真实 schema 13 混合结构无法迁移的问题，并通过新桌面安装包完成实际 Gateway 更新、数据库迁移和智能体办公室恢复验收。

## 已完成内容

- 已确认审计开始时桌面安装包内协作插件为 `0.5.4`，但实际运行中 Gateway 加载的仍是 `0.5.1`；冷态安装记录不能替代运行时插件身份。
- 无活动恢复事务时，插件缺失、版本落后和未加载状态现在先于能力启动错误处理；旧插件返回 `DATABASE_SCHEMA_UNSUPPORTED` 时进入受控 `update`，同版本失败和 health-pending 恢复事务仍失败关闭。
- 数据库门禁只新增一种经实证的候选：历史 schema 13 对象集合加当前权威 `commands_available` 索引。错误 SQL、错误列或其他结构漂移继续拒绝。
- 协作插件已升为 `0.5.5`；办公室和设置页不再把旧插件无法读取数据直接解释为只能回滚。
- 使用 `thermo-nuclear-code-quality-review` 完成严格复审；数据库主测试文件从新增后的 1060 行收敛到 967 行，历史 schema 构造器提取为测试专用夹具。
- `main` 已包含 Jarvis 的 Cron 例行工作总览、当前会话运行控制台、只读 Task Ledger 状态流和目录选择式 Git 工作区。
- 依据最新版 OpenClaw 官方主线 `b8d6e799a31` 的 Task Ledger schema，任务流按 `queued`、`running`、`completed`、`failed`、`cancelled`、`timed_out` 六种状态原样分栏，不再合并为客户端自定义状态。
- 运行控制台在任务账本、审计或有效工具快照未返回和读取失败时保留未知语义，不再把未知数据展示为零；有效工具错误绑定产生错误的精确 Session。
- Cron 例行工作总览在断线、加载和读取失败时保留未知语义，只在当前 Cron 列表已确认时发布数量和下一次运行。
- Git 工作区只通过系统目录选择器确认。Rust 在当前进程会话内保存多个规范化工作区，并仅额外信任 Git 校验出的仓库根目录；已保存路径不会跨桌面会话自动取得权限。
- Git 单文件差异、暂存、取消暂存和历史文件读取继续拒绝绝对路径与父目录逃逸。
- `main` 同时保留 Gateway 生命周期串行化、管理员 scope 升级、设备凭据轮换、钉钉业务审计和宠物窗口修复。

## 关键技术决策

- OpenClaw 是任务、审计、工具、会话、Cron 和运行终态的唯一权威；JunQi 仅展示可追溯投影，不增加本地任务状态或成功推断。
- OpenClaw 能力核对以更新后的官方仓库主线为准；当前项目依赖和自动化环境仅用于复现与验证，不作为目标环境事实或版本门禁。
- Gateway 写操作、权限升级和重启绑定已核验连接与运行时身份；超时、断线或失败不推断远端副作用终态。
- Git 信任仅存在于当前桌面进程。嵌套目录的仓库根目录必须由该已确认目录内执行的 Git 命令返回，并通过包含关系校验。
- 普通 Gateway 连接保持最小权限，管理员权限只通过 OpenClaw 官方设备 scope 升级流程取得。
- 插件包版本、schema 能力和数据库 metadata 是不同契约；能力不能按本机安装版本硬编码门禁，更新后必须重启实际 Gateway 并做运行时检查。
- 混合 schema 恢复不使用通用兼容层，只接受权威索引定义完全匹配的已证实形态，并继续沿私有备份和单事务迁移执行。

## 核心文件

- `src/components/Activity/OpenClawRunConsole.tsx`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`
- `src/pages/CronMonitor.tsx`
- `src/pages/cronPresentation.tsx`
- `src/pages/GitPage.tsx`
- `src/stores/gatewayDataStore.ts`
- `src-tauri/src/commands/git_neu.rs`
- `src/stores/collaborationSetupStore.ts`
- `packages/junqi-collab/src/database-schema-initializer.ts`
- `packages/junqi-collab/src/database-schema-fixture.test-helper.ts`
- `src/components/Collaboration/CollaborationSetupDialog.tsx`
- `src/pages/AgentHub/AgentHubOfficePanel.tsx`
- `docs/quality/collaboration-runtime-update-and-mixed-schema-recovery-audit-2026-08-25.md`
- `specs/2026-08-25-collaboration-runtime-update-and-mixed-schema-recovery.md`
- `docs/design/openclaw-workspace-projections-2026-08-24.md`
- `specs/2026-08-24-openclaw-workspace-projections.md`

## 测试与验证

- 任务流、运行控制台和 Cron 未知状态定向回归通过，共 5 项。
- Git 工作区定向 Rust 测试 8 项通过，覆盖未确认目录、多工作区保留、嵌套仓库根目录和相对路径逃逸。
- 使用项目锁定的 `pnpm@9.15.9` 完成验证：前端测试 2931 项、脚本测试 238 项、协作插件测试 367 项全部通过。
- Rust 格式检查、`cargo check --lib` 和库测试通过；Rust 测试 658 项通过，1 项按既有条件忽略。
- `pnpm lint`、`pnpm build`、`pnpm collab:validate`、`pnpm verify:openclaw-docs` 和 `git diff --check` 通过。
- 旧插件更新决策、同版本失败、health-pending 回滚、schema 12、13、14 标准迁移、精确混合 schema 13 和错误索引拒绝回归通过。
- 对现有数据库只读复制后，在独立临时目录使用最终编译代码迁移成功：schema 15、`schema_migrated_from=13`、完整性 `ok`，迁移前备份权限为 `0600`；原数据库未修改。
- 生产构建重新生成并核对协作插件 `0.5.5`、schema 15 和固定归档 SHA-256 `fa2ab4fc4b06bd78965a3f146ce635445aa51f0e49b1147511e0caab88cb38e7`，两份元数据与归档字节一致。
- 本轮只完成自动化和构建验证，没有把当前机器的 Node.js、npm、Git、Gateway、配置、凭据或操作系统状态当作目标环境证据。
- 已从真实 Tauri 客户端窗口取得智能体办公室截图；当前已安装客户端仍返回 `DATABASE_SCHEMA_UNSUPPORTED`，因此该截图只证明既有安装包未通过协作恢复验收，不能替代当前源码重新打包后的复测。
- 已基于当前工作区生成 macOS Apple Silicon 本地测试 DMG。应用与构建版本均为 `3.2.1`，二进制为 ARM64；`hdiutil verify` 通过，DMG SHA-256 为 `7d6acea3f70bf067a8cc1ed130d4b6358e1f2da9720b5a5395e540bcc73598b4`。
- DMG 只读挂载确认内嵌协作插件版本为 `0.5.5`、schema 15，归档 SHA-256 为 `fa2ab4fc4b06bd78965a3f146ce635445aa51f0e49b1147511e0caab88cb38e7`，与仓库受控资源一致。

## 已知问题与未验证边界

- 尚未通过新 DMG 对实际 Gateway 执行受控插件更新，因此实际运行时仍未证明已加载 `0.5.5`，实际数据库也未执行迁移；当前不能宣称用户现场错误已经消失。
- 尚未在真实 Gateway 完成运行控制台、Task Ledger、Cron、scope 申请、用户批准、凭据轮换、重连和原操作继续的完整序列。
- 尚未在真实 Tauri WebView 连续验证亮色、暗色、窄窗口、键盘焦点、加载、空数据和失败状态；当前只有协作数据版本失败状态的单帧截图，没有完整序列或当前源码安装包的复测证据。
- 尚未在 macOS、Windows 和 Linux 目标环境验证目录选择、嵌套仓库操作、系统凭据、Gateway 重启、钉钉协议和宠物窗口行为。
- 完整测试仍输出既有的 Node.js `module.register()` 弃用提示和 Radix Select 服务端渲染提示；Rust 检查仍报告既有未使用函数 `current_search_path`。这些提示未导致本轮验证失败，也未在本任务中扩散。
- 合并前生成的安装制品已于 2026-08-25 移入废纸篓；当前已生成新的 ARM64 本地测试 DMG，但使用 `--no-sign`，没有 Developer ID 签名、updater 签名或公证，不能作为正式发布包。
- 未跟踪的 `.pnpm-store/` 与 `outputs/` 是用户既有内容，本轮未修改、删除或纳入提交。

## 失败方案

- 未保留 Jarvis 将三个原生任务终态合并为 `attention` 的实现，因为它改变了 OpenClaw Task Ledger 的状态语义。
- 未保留单个全局 Git 工作区信任槽位，因为确认第二个目录会错误撤销第一个目录，并阻断嵌套工作区派生的仓库根目录操作。
- 未把未加载任务、审计、工具和 Cron 数据显示为零，因为零代表已确认空集合，而不是未知状态。
- 不通过手工路径输入、持久化前端标记、目录前缀匹配或目标机器环境猜测扩大 Git 权限。

## 下一步顺序

1. 在真实 Gateway 与 Tauri WebView 验证活动中心和 Cron 从加载到结果的连续状态、Session 切换和失败恢复。
2. 在目标平台验证 Git 目录选择、多工作区、嵌套仓库及写操作确认，并记录平台差异。
3. 安装当前 ARM64 本地测试 DMG，在协作设置执行受控更新，核对实际 Gateway 运行时插件为 `0.5.5`、实际数据库为 schema 15、私有备份存在且智能体办公室恢复；正式分发前另行完成 Developer ID 签名、公证与 updater 签名。
