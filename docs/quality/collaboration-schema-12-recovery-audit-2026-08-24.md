# 协作 schema 12/14 恢复与钉钉核验证据审计

## 范围与依据

本次审计覆盖已安装协作插件在启动时的数据库初始化，以及钉钉运行页的核验证据展示。

- 仓库提交 `af091393` 定义了协作 schema 12。
- 提交 `ebcacf30`、`27411b08` 与 `a9aaf11e` 分别将结构推进至 schema 13、14、15。
- 当前 `packages/junqi-collab/src/database-schema-initializer.ts` 只允许 schema 13、14 进入迁移。
- 钉钉运行页的证据区域由 `DingTalkReadinessPanel` 投影当前 Gateway、Session 与 DWS 返回值；它不是钉钉业务操作结果。

## 发现

### BUG-01 严重：已发布 schema 12 被升级路径拒绝

**位置**：`packages/junqi-collab/src/database-schema-initializer.ts`

schema 12 是本仓库已发布的历史结构，但 `LEGACY_SCHEMA_VERSIONS` 不包含 12。数据库带有合法
schema 12 元数据时，不会创建备份或执行事务迁移，而是直接返回
`DATABASE_SCHEMA_UNSUPPORTED`。这使已有协作数据无法随当前插件恢复，安装界面只能建议回滚。

**影响**：

- 用户安装当前桌面包后，协作 service 无法启动。
- 用户被引导到回滚而不是安全升级，协作业务链路无法闭环。

**修复**：以历史 schema 12 的精确对象集合为门禁，复用现有一致性备份、写锁与事务围栏，将可映射
收据归并到当前权威表，补建 schema 13 至 15 新增对象，最后删除已退休表。结构、收据或墓碑不满足
已核对条件时保持失败关闭，原库不提交修改。

### BUG-02 中等：钉钉运行页把内部核验证据作为常规业务信息

**位置**：`src/components/BusinessApplications/DingTalkReadinessPanel.tsx`

页面直接展示完整 Session key、Agent id 与插件版本。Session key 是内部路由身份，不是用户完成钉钉
业务操作所需的信息；插件版本也不能证明业务调用成功。该布局容易让用户把“DWS 身份已就绪”和
“钉钉业务调用已成功”混为一谈。

**修复**：主界面仅展示已核验状态、已授权 Agent 与可用工具数。完整 Session key 和版本号移入默认
收起的技术详情，并保留明确边界：审计读取失败是未知态，不代表钉钉调用成功或失败。

### BUG-03 严重：schema 14 的合法命令索引被对象门禁误删

**位置**：`packages/junqi-collab/src/database-schema-initializer.ts`

仓库提交 `27411b08` 将协作结构提升为 schema 14，并在同一结构中首次创建
`commands_available`。当前对象门禁却对 schema 12、13、14 无条件删除该索引；测试夹具也对三个版本
无条件删除索引，因此测试构造的 schema 14 并非历史真实结构。

**影响**：真实 schema 14 在备份和事务迁移前即被判定为结构漂移，插件返回
`DATABASE_SCHEMA_UNSUPPORTED`，既有协作数据无法进入已设计的恢复链路。

**修复**：只有 schema 12、13 的预期对象集合删除 `commands_available`；schema 14 必须保留该索引。
测试夹具按历史版本构造索引，并在 schema 14 迁移测试中核对私有备份仍包含该索引。

## 未验证边界

- schema 11 及更早版本、未来 schema 与结构漂移数据库不迁移。
- 真实 Gateway 中的 schema 12、13、14 数据库升级仍需由用户目标环境验收；自动化仅验证插件持久化行为。
- 钉钉业务结果仍只由该次官方工具调用及其返回核验，运行页状态不替代结果。
