# JunQi 项目状态

更新时间：2026-08-25

## 当前目标

当前目标是完成协作插件受控更新闭环：修复旧插件数据库错误封死更新、真实 schema 13 混合结构迁移、插件构建版本碰撞和健康确认后的旧插件回滚制品残留，并通过新桌面安装包完成实际 Gateway 更新、数据库迁移、制品清理和智能体办公室恢复验收。

## 已完成内容

- 已确认审计开始时桌面安装包内协作插件为 `0.5.4`，但实际运行中 Gateway 加载的仍是 `0.5.1`；冷态安装记录不能替代运行时插件身份。
- 无活动恢复事务时，插件缺失、版本落后和未加载状态现在先于能力启动错误处理；旧插件返回 `DATABASE_SCHEMA_UNSUPPORTED` 时进入受控 `update`，同版本失败和 health-pending 恢复事务仍失败关闭。
- 数据库门禁只新增一种经实证的候选：历史 schema 13 对象集合加当前权威 `commands_available` 索引。错误 SQL、错误列或其他结构漂移继续拒绝。
- 协作插件已升为 `0.5.6`；旧 `0.5.5` 即使返回 `DATABASE_SCHEMA_UNSUPPORTED` 也会被识别为版本落后并进入受控更新，不再因新旧构建共用版本而封死更新入口。
- OpenClaw 对同一 `junqi-collab` 标识执行受控覆盖，运行时只维护一份活动插件；旧插件归档、配置备份和新包暂存只在健康确认前用于精确失败补偿。
- 真实 Gateway 确认目标、插件版本、schema 和能力契约后，事务永久关闭恢复入口，删除旧插件归档、配置备份、暂存包和操作目录，并清除当前日志及其备份中的制品引用；回滚重启成功后执行同样清理。
- 健康确认后的安全删除失败会返回 `BOOTSTRAP_ARTIFACT_CLEANUP_FAILED`，但不会重新开放缺少完整制品的回滚动作；重复确认可重试清理。
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
- 协作插件源码、迁移或运行契约发生变化时必须发布新的插件版本；不得让不同归档内容共用同一版本，否则服务启动失败时 Gateway 无法提供内容摘要供客户端区分构建。
- 混合 schema 恢复不使用通用兼容层，只接受权威索引定义完全匹配的已证实形态，并继续沿私有备份和单事务迁移执行。
- 插件更新回滚窗口只存在于真实 Gateway 健康确认前。终态只保留插件版本、包摘要、目标身份和健康结果等最小审计事实，不保留旧插件文件、配置副本、暂存包或可恢复语义。
- 数据库迁移前备份与插件回滚归档是不同生命周期：数据库备份继续承担持久化数据保护，插件归档在更新事务终止后必须删除。

## 核心文件

- `src/components/Activity/OpenClawRunConsole.tsx`
- `src/components/Activity/OpenClawTaskLedgerPanel.tsx`
- `src/pages/CronMonitor.tsx`
- `src/pages/cronPresentation.tsx`
- `src/pages/GitPage.tsx`
- `src/stores/gatewayDataStore.ts`
- `src-tauri/src/commands/git_neu.rs`
- `src/stores/collaborationSetupStore.ts`
- `src-tauri/src/commands/collaboration_bootstrap.rs`
- `src-tauri/src/commands/collaboration_bootstrap/tests/terminal_cleanup_tests.rs`
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
- 插件事务制品清理定向回归 2 项通过：健康确认删除旧插件归档、配置备份和暂存包并关闭恢复状态；符号链接替换目录时拒绝越界删除且保持不可恢复。
- 本轮 Rust 库测试 661 项中 660 项通过、1 项按既有条件忽略；`cargo check --lib` 与格式检查通过，仍输出既有未使用函数 `current_search_path` 警告。
- `0.5.5` 版本碰撞回归在修复前稳定得到 `service_failed`，版本升为 `0.5.6` 并重建固定包后得到可应用的 `update`；协作插件完整测试 367 项通过。
- 本轮根前端 2933 项、脚本 238 项、Rust 660 项通过，Rust 另有 1 项按既有条件忽略；`pnpm lint` 与 Tauri 生产构建通过。
- 对现有数据库只读复制后，在独立临时目录使用最终编译代码迁移成功：schema 15、`schema_migrated_from=13`、完整性 `ok`，迁移前备份权限为 `0600`；原数据库未修改。
- 当前固定归档已重建为协作插件 `0.5.6`、schema 15 和 SHA-256 `98120a67f389d6b0a96783bc0573645e3c3d6f038108d224d961822ec8f6099b`；两份元数据与归档字节一致。
- 本轮只完成自动化和构建验证，没有把当前机器的 Node.js、npm、Git、Gateway、配置、凭据或操作系统状态当作目标环境证据。
- 已从真实 Tauri 客户端窗口取得智能体办公室截图；当前已安装客户端仍返回 `DATABASE_SCHEMA_UNSUPPORTED`，因此该截图只证明既有安装包未通过协作恢复验收，不能替代当前源码重新打包后的复测。
- 已基于当前源码生成 macOS Apple Silicon 本地测试 DMG。应用版本为 `3.2.1`，二进制为 ARM64，DMG 大小为 7997948 字节，SHA-256 为 `9ad8add9369743b0fa167dc04ed46fb60f87af700d2d3f3757c73713a9518044`；`hdiutil verify` 和应用 `codesign --verify --deep --strict` 通过。
- DMG 只读挂载确认内嵌协作插件为 `0.5.6`、schema 15，归档 SHA-256 为 `98120a67f389d6b0a96783bc0573645e3c3d6f038108d224d961822ec8f6099b`，metadata 与仓库受控资源逐字节一致。

## 已知问题与未验证边界

- 尚未通过新 DMG 对实际 Gateway 执行受控插件更新，因此实际运行时仍未证明已加载 `0.5.6`，实际数据库也未执行迁移；当前不能宣称用户现场错误已经消失。
- 当前 ARM64 本地测试 DMG 已包含 `0.5.6` 固定包，但尚未在目标 Gateway 核对实际加载、数据库迁移和旧插件归档删除。
- 尚未在真实 Gateway 完成运行控制台、Task Ledger、Cron、scope 申请、用户批准、凭据轮换、重连和原操作继续的完整序列。
- 尚未在真实 Tauri WebView 连续验证亮色、暗色、窄窗口、键盘焦点、加载、空数据和失败状态；当前只有协作数据版本失败状态的单帧截图，没有完整序列或当前源码安装包的复测证据。
- 尚未在 macOS、Windows 和 Linux 目标环境验证目录选择、嵌套仓库操作、系统凭据、Gateway 重启、钉钉协议和宠物窗口行为。
- 完整测试仍输出既有的 Node.js `module.register()` 弃用提示和 Radix Select 服务端渲染提示；Rust 检查仍报告既有未使用函数 `current_search_path`。这些提示未导致本轮验证失败，也未在本任务中扩散。
- 合并前生成的安装制品已于 2026-08-25 移入废纸篓；当前已生成新的 ARM64 本地测试 DMG，但仅使用 ad-hoc 签名，没有 Developer ID 签名、updater 签名或公证，不能作为正式发布包。
- 未跟踪的 `.pnpm-store/` 与 `outputs/` 是用户既有内容，本轮未修改、删除或纳入提交。

## 失败方案

- 未保留 Jarvis 将三个原生任务终态合并为 `attention` 的实现，因为它改变了 OpenClaw Task Ledger 的状态语义。
- 未保留单个全局 Git 工作区信任槽位，因为确认第二个目录会错误撤销第一个目录，并阻断嵌套工作区派生的仓库根目录操作。
- 未把未加载任务、审计、工具和 Cron 数据显示为零，因为零代表已确认空集合，而不是未知状态。
- 不通过手工路径输入、持久化前端标记、目录前缀匹配或目标机器环境猜测扩大 Git 权限。

## 下一步顺序

1. 在真实 Gateway 与 Tauri WebView 验证活动中心和 Cron 从加载到结果的连续状态、Session 切换和失败恢复。
2. 在目标平台验证 Git 目录选择、多工作区、嵌套仓库及写操作确认，并记录平台差异。
3. 安装当前 ARM64 本地测试 DMG，在协作设置执行受控更新，核对实际 Gateway 运行时插件为 `0.5.6`、实际数据库为 schema 15、数据库迁移备份存在、插件更新事务制品已清理且智能体办公室恢复；正式分发前另行完成 Developer ID 签名、公证与 updater 签名。
