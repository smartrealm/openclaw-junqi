# 协作插件服务启动失败审计

## 目标

核对协作插件安装后 Gateway 断开、启用对话框长期停留在固定进度，以及协作办公室仅显示服务不可用的完整链路。

## 权威依据

- OpenClaw 官方仓库主线提交 `bafa32fd544b5ad8ac0cba75ebb76bef2250e1d7`。
- OpenClaw Gateway 启动阶段以 `registrationMode: "full"` 加载运行时插件，并启动插件注册的 service。
- 插件通过 `activation.onStartup: true` 进入启动选择是正式插件清单契约。
- 官方插件文档：<https://github.com/openclaw/openclaw/blob/main/docs/tools/plugin.md>
- 官方插件运行时文档：<https://github.com/openclaw/openclaw/blob/main/docs/plugins/sdk-runtime.md>

当前机器安装的 OpenClaw `2026.7.1-2` 仅用于复现兼容范围，不作为能力门禁。

## 根因

Gateway 已正常启动并注册 `junqi.collab.*` RPC。协作 service 打开持久化数据库时发现 schema 版本为 13，而当前固定插件只接受 schema 15，因此 service 启动失败。RPC 注册发生在 service 启动之前；service 未创建或创建失败时，必须返回稳定的 `SERVICE_START_FAILED` 或 `DATABASE_SCHEMA_UNSUPPORTED`，不能向桌面端泄漏通用 `UNAVAILABLE` 与英文运行时句子。

桌面端同时存在三个放大问题：

1. 能力读取失败被转换为 `null`，结构化错误码和详情丢失。
2. 安装专用重启命令返回后没有进入统一 Gateway 生命周期协调器等待新连接和身份核验。
3. 对话框使用 28、58、82 三个固定百分比模拟进度，并直接展示 Rust 或插件返回的英文消息。

### BUG-03 · 协作 RPC 契约变更未更新插件版本

当前固定包已将 service 缺失或启动失败收敛为 `SERVICE_START_FAILED`，但包清单、插件清单和
运行时版本仍为 `0.5.0`。安装器的更新判定依据是 Gateway 报告的插件版本；已安装旧实现也报告
`0.5.0` 时，会被误判为当前包，导致旧实现继续返回未经结构化的
`JunQi collaboration service is not running`。

影响是桌面端无法从错误对象取得稳定错误码，协作办公室只能显示原始英文消息，且安装入口不会提供
修复当前固定包的更新操作。

修复必须提升插件补丁版本并重新生成固定归档和双端 metadata。不得依据错误文本猜测服务状态，也不
得将旧错误文本映射为结构化错误码。

### 权限边界核对

协作插件的 `junqi.collab.capabilities`、运行查询和导出读取均注册为 `operator.read`，写操作注册为
`operator.write`。前端协作客户端也只经普通 Gateway 调用通道访问这些方法，不创建
`operator.admin` 临时连接。因此安装后出现的管理员授权或配对提示不属于协作读取的权限要求；它必须
由触发该管理操作的 OpenClaw 流程单独呈现和核验，不能被归因为协作服务失败。

## 数据边界

`packages/junqi-collab` 现在仅对版本库中已核对结构的 schema 13 和 14 提供迁移。迁移先以 SQLite `VACUUM INTO` 创建同目录、不可覆盖的一致性备份；取得 `BEGIN IMMEDIATE` 写锁后，再以同一连接的 `PRAGMA data_version` 确认备份期间没有其他连接提交写入，才归并收据、重建墓碑约束和移除 retired 表。schema 13 的删除收据、schema 13/14 的会话命令收据只有在与当前统一收据表不冲突时才归并。旧会话变更记录没有当前消费者，因此保留在备份中而不伪造为当前运行状态。未知结构、收据冲突、无效墓碑、备份失败或备份期间写入均停止启动，原数据库不发生提交。

当固定包启动失败且安装事务仍可恢复时，客户端必须：

- 停止健康确认和固定进度；
- 展示稳定、可本地化的启动失败类型；
- 保留原始诊断在技术详情中；
- 提供恢复到事务记录中准确旧插件与配置的回滚入口；
- 仅在用户明确执行回滚后修改目标状态。

## 目标链路

1. 插件 service 捕获启动失败并向已注册 RPC 暴露结构化、已脱敏的失败码。
2. 桌面协作客户端保留 RPC 错误码和详情。
3. 安装专用重启完成后，由统一 Gateway 生命周期协调器等待新连接和运行时身份核验。
4. 新连接上的能力探测成功才确认健康；明确失败则结束等待并进入可恢复错误态。
5. 协作办公室复用相同错误映射，不再展示通用英文服务错误。

## 未验证边界

- schema 13/14 以外的历史版本不提供迁移协议。
- Windows、Linux 目标平台的真实服务重启和回滚仍需目标平台验证。
- 正式签名、公证和线上发布不在本次审计范围。

## 实施与验证结果

- 插件数据库校验现在返回结构化 `DATABASE_SCHEMA_UNSUPPORTED`，只公开实际版本和期望版本。
- 其他 service 启动失败返回已脱敏的 `SERVICE_START_FAILED`，任意内部异常文本不会跨 RPC 边界公开。
- schema 13 回归测试证明可映射收据会进入统一收据表、retired 表只在事务成功后移除，且完整旧库仍保留在一致性备份中。
- 收据冲突回归测试证明迁移回滚后原库仍为 schema 14、旧表和行仍存在；备份可供人工恢复。
- 精确目标重启已纳入统一 Gateway 生命周期协调器；预期断连期间不再发布全局启动失败。
- 对话框已删除固定百分比；只有真实 Gateway 进度事件提供数值时才显示百分比，否则显示不确定进度。
- 主提示与协作办公室错误已覆盖简体中文、繁体中文和英文；协作设置界面引用的三语键已完整存在，原始技术诊断只在折叠技术详情中展示。
- service 为空且没有已记录启动异常时，同样返回已脱敏的 `SERVICE_START_FAILED`；不会再向用户主提示展示 “JunQi collaboration service is not running”。
- BUG-03 已修复：协作插件先提升为 `0.5.1`，随后因迁移实现提升为 `0.5.2`；固定归档与前端、Rust metadata 必须同步重新生成。已安装的旧插件会进入更新，更新后不会继续保留同版本旧 RPC 实现。
- 补充了安装决策回归，验证旧 `0.5.0` 已加载插件与当前能力投影会进入更新状态，而不是被判定为就绪。
- 协作安装决策定向测试与协作插件完整测试通过；真实 Gateway 的旧包更新、重启和权限配对仍待目标
  环境验证。
- 普通运行环境错误和目标阻断原因不再直接进入主提示；主提示只显示本地化的稳定状态，原始文本不会被作为界面事实展示。
- `pnpm lint`、`pnpm test`、`pnpm collab:validate`、`pnpm build`、`pnpm verify:openclaw-docs` 和 `git diff --check` 已通过。
- 尚未在真实 Tauri WebView 中完成亮色、暗色、护眼主题、窄窗口和回滚后的连续运行验收。
