# 项目交接状态

更新时间：2026-08-24

## 当前目标

提交并打包会话权限恢复、协作 schema 14、目标 Node.js 契约、业务审计状态与宠物窗口交互修复。

## 已完成内容

- 仓库提交 `27411b08` 证明 schema 14 首次创建 `commands_available`；提交前的 schema 13 不含该索引。
- 修复 `legacySchemaObjectNames`：只有 schema 12、13 删除 `commands_available`，schema 14 保留历史真实索引。
- 修复历史数据库测试夹具：schema 14 不再伪造为缺索引结构，并核对迁移前私有备份仍包含该索引。
- 新增反向回归：schema 14 缺少 `commands_available` 时必须按结构漂移拒绝，且不创建备份、不修改 schema 元数据。
- 红灯验证已复现旧实现拒绝真实 schema 14；修复后数据库定向测试 29 项通过。
- 协作插件由 `0.5.3` 提升至 `0.5.4`。安装决策测试确认已安装 `0.5.3` 时显示更新入口。
- 固定协作归档和前端 metadata 已生成，插件归档 SHA-256 为 `458a2ca1c457db32e90e7cfcb4326bc26595dd33445b03bbb53e9772375f132c`。
- 包含本轮全部修复的 macOS ARM64 DMG 已重新生成并通过 `hdiutil verify`，SHA-256 为 `edcd61f9d7a5866edf1d280c5bd2e6cd0f81c2017ef3c11fa2f4b3b50d6b8162`。
- 用户截图确认首轮宠物对比度修复遗漏尺寸契约：`108 × 154` 窗口内的标题仍按 `240` 像素宽度排版并允许多行，导致操作提示遮挡 `96 × 110` 角色。
- 宠物标题已改为窗口内单行紧凑标签，水平各保留 6 像素，最大高度扣除角色和间距；长状态省略，完整任务详情保留在主窗口。
- 简体中文、繁体中文和英文悬停提示已改为短文案；标题圆角改为 7 像素并复用 `--aegis-bg-solid`、`--aegis-border`、`--aegis-text` 和 `--aegis-shadow-card`。
- 更新 OpenClaw 官方主线到 `a9fdb68496d636461d11e8be29323de55636e337` 后核对：会话模型覆盖使用 `operator.write`，thinking、fast、verbose、trace 和 reasoning 等运行参数使用 `operator.admin`。
- 新增统一 scope upgrade 协调器，通过当前已核验主连接调用官方 `device.scopes.requestUpgrade` 和 `device.scopes.waitUpgrade`；不依赖 hello 方法列表作为拒绝门禁。
- 权限申请使用 Gateway 结构化返回的实际缺失权限；日常连接仍保持读、写和 Talk 最小权限，管理员权限不会默认进入普通连接。
- 批准终态严格核对请求标识、轮换设备令牌和批准权限。轮换令牌先写入当前端点绑定的系统凭据作用域，再清除共享令牌优先级并用设备令牌重连。
- 后续普通启动优先恢复当前端点已持久化的设备凭据；首次设置和显式手工 token 仍严格使用当前请求指定的共享凭据。
- 原特权 RPC 在 scope 恢复期间保持挂起，只在新主连接完成身份核验后重新捕获来源并发送；取消、拒绝、过期、协议失败和凭据保存失败均不伪造成功。
- 统一权限恢复界面新增“请求所需权限”和准确请求批准入口；会话设置不再把底层 `missing scope` 英文错误直接显示为业务通知。

## 关键技术决策

- 历史 schema 对象集合以仓库对应提交的真实 `schema.ts` 为依据，不能由当前 schema 反推后再用统一删减近似。
- schema 12、13、14 仍必须精确匹配各自历史对象集合；额外或缺失对象继续失败关闭。
- 已失败的安装事务不能被新包静默覆盖。用户先在同一目标运行时恢复安装前插件和配置，再使用 `0.5.4` 更新；协作数据库不会因回滚被删除或迁移。
- 不扩大宠物原生窗口来容纳长文案，避免透明区域拦截更多桌面点击；宠物仅承担紧凑状态提示，详细内容由主窗口承载。
- scope 拒绝必须进入 OpenClaw 官方设备权限升级协议，不能只靠扩大普通连接权限、文本提示、版本门禁或盲目重试。
- 权限批准后的设备令牌轮换属于当前已核验 Gateway 端点；保存、重连和原操作恢复均受连接身份围栏保护。

## 核心文件

- `packages/junqi-collab/src/database-schema-initializer.ts`
- `packages/junqi-collab/src/database.test.ts`
- `packages/junqi-collab/src/version.ts`
- `src/stores/collaborationSetupStore.test.ts`
- `src/generated/collaborationPluginBundle.generated.json`
- `src-tauri/resources/collaboration/metadata.json`
- `src/pet/PetBubble.tsx`
- `src/pet/petTheme.ts`
- `src/pet/petTheme.test.ts`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `src/locales/en.json`
- `src/services/gateway/GatewayScopeUpgrade.ts`
- `src/services/gateway/Connection.ts`
- `src/services/gateway/index.ts`
- `src/components/PairingScreen.tsx`
- `src/hooks/chat/useSessionRuntimeSettings.ts`
- `docs/quality/gateway-admin-scope-upgrade-audit-2026-08-24.md`
- `specs/2026-08-24-gateway-admin-scope-upgrade.md`
- `plans/2026-08-24-gateway-admin-scope-upgrade.md`

## 测试与验证

- 修复前，真实 schema 14 夹具使迁移、收据冲突和非法墓碑三个测试按预期失败在错误的结构门禁。
- 修复后，数据库定向测试 29 项通过；协作插件完整测试通过。
- `pnpm collab:validate`、`pnpm collab:bundle`、`pnpm lint`、`pnpm build` 与 `git diff --check` 通过。
- 协作设置定向测试 18 项通过，覆盖 `0.5.3` 到 `0.5.4` 更新决策。
- 修改文件 Emoji 扫描通过；DMG 映像校验通过。
- 宠物标题修复先以新增几何回归复现两项失败；修复后按项目正式测试初始化运行宠物全目录测试，83 项全部通过。
- `pnpm lint`、`pnpm build` 与 `git diff --check` 通过；构建重新核对协作固定包仍为插件 `0.5.4`、schema 15 和既有 SHA-256。
- scope upgrade、凭据安全、连接目标恢复、会话设置和恢复界面定向测试 59 项通过，覆盖准确请求、响应校验、取消、先存后连、跨启动凭据恢复、身份换代和原操作恢复。
- 使用项目锁定 `pnpm@9.15.9` 执行完整验证：前端测试 2927 项、脚本测试 238 项、Rust 测试 654 项、协作插件测试 365 项全部通过；lint、Rust 格式检查、Rust 类型检查、协作包契约和 Tauri 生产打包通过。
- 新 DMG 大小为 8031429 字节，内含 Mach-O arm64 应用；映像 CRC 校验有效。应用只有 linker ad-hoc 签名，没有 TeamIdentifier。

## 已知问题与未验证边界

- 尚未在用户当前真实 Gateway 上执行旧安装事务回滚、`0.5.4` 更新、Gateway 重启及 schema 14 到 15 的完整序列。
- DMG 未使用 Developer ID 签名且未公证，只能用于本轮安装验证，不是正式发布制品。
- schema 11 及更早版本、未来版本和结构漂移数据库仍明确不迁移。
- 宠物标题尚未在新桌面安装包中进行 macOS 动态视觉验收；Windows 和 Linux 真机视觉也未验证。
- 尚未在目标 Gateway 上真实执行 scope 申请、用户批准、系统凭据库写入、主连接重连和原会话设置自动继续的完整序列。

## 失败方案

- 旧实现对 schema 12、13、14 无条件删除 `commands_available`，测试夹具又同步删除该索引，导致错误实现与错误测试相互验证，已修正。
- 直接覆盖未收敛的安装事务会破坏精确回滚证据，仍禁止；必须先恢复事务，再安装新的固定包。
- 只增加不透明白色底座、继续保留多行宽标题，会造成新的遮挡问题；该方案已被用户截图否定并删除。
- 把 `operator.admin` 加入日常连接只会扩大权限且仍绕过正式升级交互，未采用。
- 仅把 `missing scope` 翻译成本地化错误仍无法恢复原业务操作，未采用。
- scope 拒绝后直接重试旧设备凭据会重复失败；现在必须等待官方 waiter 返回轮换令牌并完成新连接身份核验。
- Corepack 命令入口不可用，未据此判断目标环境；最终验证改用显式的项目锁定 `pnpm@9.15.9` 执行器。

## 下一步顺序

1. 在目标环境安装本轮 DMG，真实执行会话 thinking 或 fast 参数修改，确认申请、批准、凭据轮换、重连和原设置自动成功的完整序列。
2. 复核配置、技能、渠道、安装向导和审批入口的最小权限申请；远程 Gateway 使用 Control UI 或目标机器审批，不把构建机器状态当目标证据。
3. 在亮色、暗色和不同桌面背景下验收宠物单行标题、点击恢复主窗口和拖动后不误触恢复。
