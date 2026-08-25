# 协作运行时更新与混合 schema 恢复审计

## 范围与依据

本次审计覆盖桌面安装包、协作插件部署事务、运行中 Gateway 插件身份、数据库结构门禁和智能体办公室错误收敛。

- OpenClaw 官方主线 `70e6aa135a54280796f092b828dad4d159143560` 的
  [插件 CLI 文档](https://github.com/openclaw/openclaw/blob/main/docs/cli/plugins.md) 明确区分冷态安装记录与运行时加载结果；插件源或配置变化后必须重启实际 Gateway。
- OpenClaw 官方
  [插件文档](https://github.com/openclaw/openclaw/blob/main/docs/tools/plugin.md) 要求用运行时 inspect 与 Gateway 状态共同核验新插件，不能把安装记录当作长运行 Gateway 已加载新代码的证明。
- 仓库提交 `ebcacf30` 定义历史 schema 13，提交 `27411b08` 首次在 schema 14 增加 `commands_available`。
- 审计开始时安装包内协作插件为 `0.5.4`、schema 15；运行中 Gateway 实际插件检查仍返回 `0.5.1`。迁移修复曾错误地继续使用 `0.5.5`，最终固定包已升为 `0.5.6`。
- 对现有数据库只读检查确认 metadata 为 schema 13，且对象集合比历史 schema 13 精确多出 `commands_available`；未读取任何业务行。

## 发现

### BUG-01 严重：旧插件启动错误封死自身更新入口

**位置**：`src/stores/collaborationSetupStore.ts`

无活动恢复事务时，设置决策先处理 `DATABASE_SCHEMA_UNSUPPORTED` 和 `SERVICE_START_FAILED`，后比较已安装插件版本与当前固定包版本。旧插件因不能读取数据库而启动失败时，界面直接进入不可应用的 `service_failed`，不会进入本应可用的 `update`。

**影响**：

- 安装包内已包含新插件，但用户无法从协作设置覆盖旧插件。
- 界面错误地要求回滚到旧插件，实际又回到产生错误的版本。
- Gateway 不会加载新插件，数据库迁移代码没有执行机会。

**修复**：保留活动恢复事务的优先级；没有活动事务时，先根据受控 probe 判断插件缺失、版本落后或未加载，再处理同版本插件的服务启动失败。版本落后必须进入可应用的 `update`，部署后仍通过统一 Gateway 生命周期重启和能力核验闭环。

### BUG-02 严重：真实 schema 13 混合结构不在安全恢复集合

**位置**：`packages/junqi-collab/src/database-schema-initializer.ts`

真实数据库的版本仍为 13，但存在 schema 14 首次定义的 `commands_available`。当前门禁只接受历史 schema 13 的精确对象集合，因此即使部署 0.5.4，也会在迁移前将该库判为结构漂移。

**影响**：

- 旧插件更新完成后仍不能启动协作 service。
- 用户会从版本不兼容转入通用服务启动失败，业务仍不闭环。

**修复**：只增加一个经实证的混合结构候选：历史 schema 13 对象集合加上定义与当前权威完全相同的 `commands_available`。索引名称、SQL 或列定义任一不一致仍拒绝；迁移继续先做不可覆盖的私有备份，再在事务内归并收据、重建墓碑、删除退休表并升至 schema 15。

### BUG-03 中等：办公室错误文案把插件错误直接解释为数据只能回滚

**位置**：`src/pages/AgentHub/AgentHubOfficePanel.tsx`、`src/components/Collaboration/CollaborationSetupDialog.tsx`

`DATABASE_SCHEMA_UNSUPPORTED` 只证明当前已加载插件不能读取该库，不证明安装包内插件也不能迁移，更不证明回滚是唯一正确动作。

**修复**：文案要求先核对已加载插件版本和受控更新状态；只有存在当前目标的恢复事务时才展示回滚动作和语义。

### BUG-04 高：健康确认后仍长期保留旧插件归档

**位置**：`src-tauri/src/commands/collaboration_bootstrap.rs`

OpenClaw 对同一插件标识执行带 `--force` 的安装时会复用现有目标并原位覆盖，因此运行时只有一份活动插件。JunQi 为失败补偿创建的旧插件归档、配置备份和新包暂存目录原本在健康确认成功后仍被保留，状态接口也继续返回可恢复；后续更新会覆盖活动日志，并可能留下没有消费者的旧事务目录。

**修复**：回滚材料现在只存在于应用完成到真实 Gateway 能力确认之间。确认目标、连接、运行时路径、插件版本、schema 和能力契约后，事务先永久关闭恢复入口并清除日志中的制品引用，再安全删除旧插件归档、配置备份和暂存包。删除失败时返回明确的 `BOOTSTRAP_ARTIFACT_CLEANUP_FAILED`，但不重新开放已终止的回滚入口；界面保持独立清理失败状态，后续能力刷新只重试清理，不误报完全就绪。回滚完成并成功发出目标 Gateway 重启后，同样删除本次新包和回滚材料。

### BUG-05 严重：迁移修复与旧构建共用插件版本

**位置**：`packages/junqi-collab/package.json`、`packages/junqi-collab/openclaw.plugin.json`、`packages/junqi-collab/src/version.ts`

schema 迁移修复后的归档仍沿用 `0.5.5`。当前 Gateway 若加载较早的同版本构建并在 service 启动时返回 `DATABASE_SCHEMA_UNSUPPORTED`，能力 RPC 无法返回归档摘要，桌面只能看到相同插件版本，于是按同版本失败关闭处理，新的迁移实现没有受控部署入口。

**修复**：将迁移修复归档发布为 `0.5.6`，运行时常量、插件清单、包清单、生成元数据和固定归档保持一致。回归先证明旧 `0.5.5` 被误判为 `service_failed`，再证明 `0.5.6` 固定包会把同一现场状态判为可应用的 `update`。

## 严格代码质量复审

按 `thermo-nuclear-code-quality-review` 对完整变更复审。首次实现将 `database.test.ts` 从 998 行推到 1060 行，触发 1000 行结构门槛；历史 schema 构造器随后提取为测试专用夹具，主测试文件降至 967 行。生产状态文件没有增长，插件更新顺序仍由原决策函数统一拥有；混合结构判定只存在于数据库 schema 初始化边界，没有向服务、RPC 或界面扩散兼容分支。

复审未发现当前变更的结构阻断项。没有新增 `any`、静默 fallback、非事务数据库写入、第二套 Gateway 生命周期或重复插件更新入口。

## 已执行验证

- 修复前回归分别证明旧插件被错误判为 `service_failed`，真实混合 schema 13 被对象门禁拒绝。
- 修复后设置状态、设置面板、协作插件完整测试通过；根 `pnpm test`、`pnpm lint`、`pnpm build` 和 `git diff --check` 通过。
- 固定归档版本为 `0.5.6`、schema 15，SHA-256 为 `98120a67f389d6b0a96783bc0573645e3c3d6f038108d224d961822ec8f6099b`；两份生成元数据与归档字节一致。
- 现有数据库的只读复制在独立临时目录使用最终编译代码迁移成功，结果为 schema 15、`schema_migrated_from=13`、完整性 `ok`，并生成权限为 `0600` 的迁移前备份；原数据库未被修改。
- Rust 定向回归证明健康确认会删除旧插件归档、配置备份和暂存包，并将当前日志及其备份同时收敛为不可恢复；符号链接替换目录时不会跟随删除到边界外，且失败状态仍保持不可恢复。
- 当前 macOS Apple Silicon 本地测试 DMG 基于最终源码构建，SHA-256 为 `9ad8add9369743b0fa167dc04ed46fb60f87af700d2d3f3757c73713a9518044`；`hdiutil verify`、ARM64 架构和 ad-hoc 应用签名验证通过。只读挂载确认内嵌插件为 `0.5.6`、schema 15，归档摘要为 `98120a67f389d6b0a96783bc0573645e3c3d6f038108d224d961822ec8f6099b`，并与仓库受控资源一致。

## 验证边界

- 兼容范围只覆盖本次只读证据确认的 schema 13 加精确权威索引，不接受其他混合或漂移结构。
- 仍必须通过新桌面安装包部署固定包、重启实际 Gateway，并核对运行时插件版本、数据库迁移 metadata 和智能体办公室。
- 数据迁移前必须保留私有备份；不得删除、替换或手工改写现有数据库。
- 数据库迁移前备份属于持久化数据保护，不是插件回滚归档；本次只删除已经失去消费者的插件更新事务制品。
- 当前 DMG 仅为 ad-hoc 签名的本地测试候选，未完成 Developer ID 签名、公证或 updater 签名，也尚未在目标 Gateway 验证 `0.5.6` 实际加载和数据库迁移。
