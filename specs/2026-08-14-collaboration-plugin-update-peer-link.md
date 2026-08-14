# 协作插件更新 Peer Link 修复规格

日期：2026-08-14

## BUG-01 OpenClaw host link 阻断更新

### 当前行为

更新前备份遍历已安装插件目录，遇到任意符号链接即失败。OpenClaw 官方生成的 `node_modules/openclaw` 因而无法通过预检。

### 目标行为

- 仅排除由插件根 `package.json#peerDependencies.openclaw` 声明且路径严格为 `node_modules/openclaw` 的符号链接。
- 不读取、归档、复制或跟随该链接的宿主内容。
- 其他路径的符号链接继续拒绝。
- 未声明对应 peer dependency 时，同一路径的链接仍拒绝。
- 归档哈希和回滚后内容哈希使用同一排除规则。
- 回滚仍调用 OpenClaw 官方安装命令重建派生链接并核验恢复结果。

### 验收条件

- [x] 包含合法 host link 的旧插件可生成回滚归档。
- [x] 合法 host link 不进入归档，改变其宿主目标不改变插件内容哈希。
- [x] 任意其他链接以及无 peer 声明的 `node_modules/openclaw` 均返回明确错误。
- [x] 既有无链接插件的精确归档和回滚测试继续通过。

## BUG-02 schema 版本身份不唯一

### 当前行为

schema 13、14、15 均可能报告插件版本 0.4.0。

### 目标行为

当前 schema 15 插件统一报告版本 0.5.0，生成归档和 Desktop metadata 与其一致。

### 验收条件

- [x] `package.json`、`openclaw.plugin.json` 和 `src/version.ts` 均为 0.5.0。
- [x] `pnpm collab:validate` 和 `pnpm collab:bundle` 通过。
- [x] 生成 metadata、归档名与内嵌资源均指向 0.5.0 和 schema 15。
