# 协作插件更新与 OpenClaw Peer Link 审计

日期：2026-08-14

## 范围与依据

本审计覆盖 JunQi 协作插件的已安装目录发现、更新前备份、官方 CLI 安装、失败回滚、内容核验和 Gateway 健康确认。

权威依据：

- OpenClaw 官方远端 `main` 的 `src/plugins/plugin-peer-link.ts` 会为声明 `openclaw` peer dependency 的外部插件维护 `node_modules/openclaw` host link。
- 本机 OpenClaw 2026.7.1-2 的发布源码包含同一行为，并在自身 npm 插件回滚快照中排除该派生链接。
- 本机已安装 `junqi-collab` 的唯一链接是 `node_modules/openclaw`，其目标为当前 OpenClaw 包根。
- Rust 官方标准库文档确认 Windows junction 属于重解析点边界；实现以 `FILE_ATTRIBUTE_REPARSE_POINT` 同时覆盖符号链接和 junction，不在 Windows 上递归进入宿主目录。

## 缺陷

### BUG-01 严重：合法 OpenClaw host link 阻断所有协作插件更新

位置：`src-tauri/src/commands/collaboration_bootstrap.rs`

当前 `collect_plugin_tree_entries` 拒绝插件树中的所有符号链接。OpenClaw 官方安装器生成的 `node_modules/openclaw` 因此使更新在任何写操作前以 `ROLLBACK_SNAPSHOT_FAILED` 失败。

影响：

- schema 不兼容时无法安装当前 JunQi 内嵌插件。
- 用户不能通过协作设置界面完成更新或修复。
- 手工删除链接会破坏 OpenClaw SDK 的标准解析路径，不能作为恢复方案。

修复边界：仅当根 `package.json` 明确声明非空 `peerDependencies.openclaw`，且链接相对路径严格等于 `node_modules/openclaw` 时，将它视为 OpenClaw 可重建的派生产物并从归档和内容哈希中排除。其他链接、特殊文件和路径继续失败关闭。回滚继续通过官方 `plugins install --force --pin` 重建插件和 host link，再核验插件快照与排除派生产物后的内容哈希。

### BUG-02 严重：不兼容 schema 变化共用插件版本

位置：`packages/junqi-collab/package.json`、`openclaw.plugin.json`、`src/version.ts`

已安装 schema 13 与当前 schema 15 都报告插件版本 0.4.0。插件版本无法唯一标识加载代码，诊断、安装记录和健康确认只能依赖额外 schema 差异发现漂移。

影响：

- 相同版本对应不同物理数据库契约。
- 安装记录不能证明当前代码与 JunQi bundle 一致。
- 发布和回滚审计缺少稳定版本身份。

修复边界：将当前不兼容契约提升为插件版本 0.5.0，并同步包清单、OpenClaw 清单、运行时常量、README、生成 bundle metadata 和归档。

## 未验证边界

- 自动化可以验证归档、哈希和测试桩中的官方重装调用，不能替代真实 Gateway 更新、重启和能力握手。
- Windows junction 的真机行为、Docker 挂载路径和跨平台文件权限需要目标平台验证。

## 验证结果

- 新增三项 Rust 回归测试：旧实现上的合法 peer link 用例先以原错误失败；修复后合法链接、无声明同名链接和其他链接用例全部通过。
- `pnpm collab:test` 通过，355 项测试全部通过。
- `pnpm collab:validate` 与 `pnpm collab:bundle` 通过；生成插件为 0.5.0、schema 15，双端 metadata 与归档 SHA-256 一致。
- `cargo fmt -- --check`、`cargo check --lib` 和 `cargo test --lib` 通过；Rust 库测试为 638 项通过、1 项忽略。
- `pnpm lint`、`pnpm test`、`pnpm build` 和 `pnpm verify:openclaw-docs` 通过。
- 当前机器没有执行真实插件覆盖、Gateway 重启或 Windows、Linux、Docker 真机验证。
