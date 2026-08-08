# 项目交接状态

更新时间：2026-08-08

## 当前目标

修复 Windows 安装完成并重启 JunQi 后的 Gateway 认证恢复；固定 OpenClaw 官方默认主会话；并修复
Windows 新建会话被错误当作未知历史会话、进入历史加载门禁的问题。

## 已完成内容

- 核对 JunQi 从首次配置、Gateway 地址持久化、冷启动目标解析、所选 runtime 凭据读取、认证连接
  到工作区状态展示的完整链路。
- 核对最新版 OpenClaw 官方源码中的 `agents.list.mainKey`、主会话身份和 Windows Gateway 服务
  生命周期；参考 `openclaw-desktop` 的桌面交互，但未复制其硬编码主会话身份。
- 修复 Gateway 地址采用字符串全等判断的问题。等价的本机回环地址现在使用统一端点规则匹配，
  冷启动时可以继续使用当前所选 runtime 的 token。
- 首次配置只持久化当前 Gateway 地址首选项，删除旧 `aegis-config` 存储结构及其清理包装，不保留
  兼容读取、迁移或凭据 fallback。
- 将默认主会话固定规则下沉到 `chatStore`。官方 `mainKey` 到达后，页签持久化、拖拽、键盘切换和
  渲染统一使用规范化顺序。
- 默认主会话不可拖拽、不可关闭、不可中键关闭，也不能从会话菜单或会话管理页删除；其他会话仍可
  关闭和排序。
- 新增回环地址认证恢复、Gateway 地址持久化、主会话固定、官方自定义 `mainKey` 和删除保护回归测试。
- 对照最新版 OpenClaw `sessions.create` 服务确认：未指定 key 的普通创建会生成新的 dashboard 会话，
  无初始 turn 且非 fork 时 transcript 为空。
- 复现 `sessions.list` 稀疏行先于本地创建提交的竞态。旧 `addNativeSession` 看到相同 key 已存在时只
  激活页签，遗漏创建响应中的 sessionId、Agent 身份和空 leaf，因此触发 `chat.history`。
- `addNativeSession` 现在始终把官方创建确认合并到同 key 行，同时保留列表已提供的其他元数据；
  已确认空会话继续直接进入可发送状态，普通历史会话仍按官方历史读取。

## 关键技术决策

- Gateway 进程可达不等于认证连接成立。冷启动必须保留所选 runtime 身份、配置和凭据作用域，不用
  独立设备凭据掩盖目标身份误判。
- 是否属于同一个 Gateway 由已有端点规范化契约判断，不能用原始 URL 字符串全等判断。
- 默认主会话身份只取 OpenClaw 官方 `agents.list.mainKey`。连接前可保留现有默认占位，收到官方
  快照后立即收敛；不写死特定 Agent 名称。
- 固定顺序属于会话状态不变量，不能仅在 React 渲染数组中临时排序。
- 本轮没有证据表明 Windows Scheduled Task 或官方 Gateway 服务恢复实现需要改写，因此未改变 Rust
  服务生命周期和 OpenClaw 官方安装语义。
- 新会话是否为空只接受 `sessions.create` 的确认身份和空 leaf 投影，不能依据消息数组为空推断。
- `sessions.list` 与 `sessions.create` 的先后顺序不能改变最终会话事实；创建确认在本地提交边界补齐
  同 key 稀疏行，不新增本地会话语义或跳过旧会话历史。

## 修改过的核心文件

- `src/services/gateway/GatewayConnectionTargetResolver.ts`：等价 Gateway 端点识别和所选 runtime
  凭据恢复。
- `src/hooks/useSetupFlow/helpers.ts`、`src/api/tauri-adapter.ts`：当前 Gateway 地址持久化及旧存储路径删除。
- `src/stores/chatStore.ts`：默认主会话身份、页签顺序和关闭不变量。
- `src/stores/chatStore.ts`、`src/stores/chatStore.test.ts`：列表先到竞态下的创建确认合并和历史加载分流回归。
- `src/App.tsx`：将官方 `agents.list.mainKey` 同步到会话状态层。
- `src/components/Chat/ChatTabs.tsx`：默认主会话拖拽、关闭和中键交互限制。
- `src/components/Chat/session-actions/SessionActionsMenu.tsx`、`src/pages/SessionManager.tsx`、
  `src/utils/sessionDelete.ts`：默认主会话删除保护。
- `docs/quality/windows-gateway-cold-start-and-main-session-pinning-2026-08-08.md`、对应规格和计划：
  本轮依据、行为契约和验证边界。
- `docs/quality/openclaw-confirmed-empty-session-audit-2026-08-05.md`、对应规格和计划：新建会话竞态依据、
  修复设计和验证结果。

## 测试与验证结果

- 聚焦回归已通过：Gateway 目标解析、首次配置持久化、会话页签状态和会话删除保护，共 61 项。
- `pnpm lint` 已通过，包含 TypeScript 静态检查、模块边界和版本一致性检查。
- 新建会话与历史分流聚焦测试 70 项通过；新增测试已先在修复前复现 sessionId 丢失。
- 完整 `pnpm test` 已通过：前端与应用测试 2821 项，脚本与发布契约测试 243 项，均无失败。
- `pnpm build` 已在最终代码上通过，协作资源打包、TypeScript 编译和 Vite 生产构建均成功。
- Windows 安装、重启、Scheduled Task、Credential Manager 和真实认证恢复尚未在 Windows 真机验证。
- 亮暗主题、窄窗口、键盘切换和拖拽的桌面视觉验收尚未执行。
- Windows 真机的新建会话、输入框首发和无历史加载提示尚未使用本轮构建验收。

## 已知问题

- 当前开发环境不能证明 Windows 登录后 Gateway 服务启动时序和凭据库行为；代码回归通过不等于
  Windows 真机验收完成。
- 如果 Windows 真机仍显示未连接，需要采集所选 runtime、规范化后的 Gateway 目标、服务归属和
  结构化认证错误；不得通过切换 runtime 或伪成功绕过。
- 本轮实现、测试和文档按用户要求纳入同一中文提交；后续修改应继续从清晰工作区开始。

## 尝试过但失败的方案

- 仅调整“正在连接”或“未连接”界面文案不能恢复认证，根因位于 Gateway 目标身份和凭据作用域。
- 直接复制参考客户端并写死 `agent:main:main` 会忽略 OpenClaw 官方可返回的自定义 `mainKey`，已放弃。
- 在没有证据时改写 Windows 服务安装或重启逻辑会越过 OpenClaw 官方生命周期边界，未采用。
- 保留旧 `aegis-config` 读取、迁移或清理兼容层会继续形成双轨状态，已删除。
- 仅在 `ChatView` 根据“消息为空”跳过历史会伪造 transcript 事实，且会误伤已有空历史会话，未采用。
- 将该问题归因于 Windows 或直接关闭所有新页签的历史读取会掩盖真正的创建与列表竞态，未采用。

## 下一步开发顺序

1. 在 Windows 真机使用安装包完成安装、退出、系统重启、重新启动 JunQi 和认证连接验收。
2. 连续新建多个不同 Agent 会话，确认每个会话初始为空、输入框立即可用、首次发送成功且不显示历史加载。
3. 验证默认主会话始终位于最左侧，并覆盖关闭按钮、中键、拖拽、快捷切换和删除入口。
4. 若 Windows 真机仍失败，依据结构化日志继续定位服务归属、凭据读取或认证协议，不增加兼容 fallback。
