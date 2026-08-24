# 业务审计与模型选择器状态审计

## 目标

核对钉钉业务审计空状态与错误状态混用，以及 Session 运行时模型列表在有限高度弹层中被裁切的问题。

## 审计结论

### 业务审计状态

`BusinessActivityList` 只根据“是否存在记录”选择空状态标题，再把官方审计读取失败放进描述。因此请求失败时会同时显示“尚无审计”和“请求失败”，把未知结果误报为空结果。

目标状态必须互斥：

1. 正在读取时只显示加载状态。
2. 官方请求失败时只显示对应错误和重试入口。
3. 请求成功且返回零条记录时才能显示真实空状态。
4. 存在官方记录或本窗口投影时显示列表；官方刷新失败只作为列表内的非阻断警告。
5. 审计页必须绑定精确 Session key。切换 Session 后，旧页即使仍在内存中也不能投影到新会话；只有同一 Session 的刷新失败才能保留已经确认的官方记录。
6. Gateway 断开时立即撤回当前页的已读取账本、游标和“加载更多”状态，并发布“无法读取账本”的失败状态；不能等待异步 effect 后才清除旧数据。

已于 2026-08-21 刷新 OpenClaw 官方 `origin/main` 至
`75c44b2b98d508593b71501da80c12aa63a7e672`。其
`docs/gateway/protocol.md`、`src/gateway/server-methods/audit.ts` 与
`src/gateway/methods/core-descriptors.ts` 确认：`audit.activity.list` 是首选的
版本化 metadata-only 账本，要求 `operator.read`；`audit.list` 仍是官方保留的旧版
运行与工具账本。2026-08-24 再次核对官方 `docs/cli/audit.md`，该权限要求仍为
`operator.read`。

活动账本只有收到官方未知方法结构化响应时才判定为旧协议不支持。`missing scope: operator.admin`
或任何其他权限错误必须保留为真实失败；不得依据错误文本、`hello-ok.features.methods` 或本地版本
猜测其代表旧 Gateway 不支持，避免把授权、配对或 Gateway 配置问题伪装成可安全降级的读取。

### 管理员 scope 恢复链路

日常 Gateway socket 仅申请 `operator.read`、`operator.write` 与 `operator.talk`；协作插件的读取和
写入分别请求 `operator.read` 与 `operator.write`。配置、安装、二维码登录、模型探测和受保护的会话
运行时操作通过一次性独立 socket 请求 `operator.admin`，不提升日常连接权限。

OpenClaw 当前 Gateway 协议将 `AUTH_SCOPE_MISMATCH` 定义为已识别设备 token 未覆盖所请求 scope，并要求
客户端提示重新配对或批准更宽的 scope。JunQi 现只依据该结构化错误或 `MISSING_SCOPE` 打开统一授权
恢复界面：有官方 `requestId` 的配对请求继续使用现有批准与原请求重试流程；没有请求 id 的 scope 拒绝
只展示缺失 scope、OpenClaw 控制台恢复方向和手动 token 入口，不自动重试写操作，也不取消日常连接。

2026-08-24 复查浏览器控制、配置、技能安装、Cron、渠道生命周期、会话恢复与分支切换、模型探测、二维码登录、
Agent 管理和引导向导入口，均通过同一个短生命周期高权限请求器。审批动作单独使用 `operator.approvals`，未发现
绕过统一授权恢复界面的生产入口。恢复界面标题改为“额外授权”，按 Gateway 的结构化缺失 scope 展示，不把所有
scope 拒绝错误报为管理员权限。

当且仅当活动账本被官方判定为缺失，且查询不涉及 `message`、`direction` 或 `channel` 时，JunQi
可重试官方 `audit.list`。返回结果必须标记为 `legacy`，只呈现 Agent 与工具元数据；消息审计绝不
回退。解析失败、未授权、连接失败和已通告活动账本的失败均不回退，也不以本窗口调用投影代替官方账本。

### Session 模型选择器

模型选择器把供应商、模型和后续运行参数放在同一个纵向滚动容器中，同时只给模型网格设置最大高度。模型数量较多时，模型列与外层滚动相互竞争，用户难以判断模型列表能否继续滚动，窗口高度较小时还会被后续参数区挤压。

目标布局将模型目录与运行参数拆成两个明确页签和滚动区域：

- 默认展示模型目录页签，供应商列和模型列使用完整主体高度并各自独立纵向滚动。
- 模型列始终保留滚动条空间，避免内容宽度随滚动条出现而跳动。
- 模型目录提供按名称、别名和完整 id 筛选；即使目录超过可视高度，用户也能定位并滚动到任一
  Gateway 返回的模型，而不是把有限高度误解为目录终点。
- 运行参数页签使用单独滚动区，不再挤占模型目录。
- 底部恢复、取消和保存操作保持可达，不随内容滚出弹层。
- 弹层通过共享视口碰撞宿主渲染，桌面窗口缩小时仍保持在可视区域内。
- 共享宿主挂载到文档根节点后，必须显式标记为 Tauri 非拖拽区域；不能依赖触发按钮的祖先标记，
  否则无边框窗口会截获模型目录的点击和滚动事件。

## 边界

- 审计结果首选 OpenClaw 官方 `audit.activity.list`；只有官方允许的旧 Gateway 工具审计范围可受限回退到 `audit.list`，并显示实际账本来源。请求失败不推断为空记录。
- 模型目录仍来自当前 Session 的 OpenClaw 投影；本次只修复桌面展示与滚动边界，不创造模型或能力。
- 真实 Tauri WebView 的触控板、鼠标滚轮、键盘和三种主题仍需连续视觉验收，尤其要确认文档根
  节点上的菜单不会落入标题栏拖拽区域。

## 验证结果

- 2026-08-24 Gateway 凭据安全与授权错误定向回归 43 项通过，覆盖日常 `read/write/talk` handshake、单 RPC 管理员临时 socket、配对重试、结构化 `MISSING_SCOPE` 发布授权恢复入口，以及拒绝后不分发有副作用 RPC。
- 2026-08-24 定向 `OpenClawAuditClient` 回归 8 项通过，覆盖官方未知方法时的受限旧账本回退、消息筛选禁止回退、无效旧账本 schema 拒绝，以及 `missing scope: operator.admin` 原样失败且不请求 `audit.list`。
- 定向回归 17 项通过，覆盖活动账本、两种旧协议缺失响应、受限 `audit.list` 回退、消息筛选禁止回退、旧协议 schema 拒绝、失败与空结果互斥、Session 隔离和断连撤回。
- `pnpm lint` 通过，模块边界检查覆盖 942 个生产文件。
- `pnpm test` 全量通过。
- `pnpm build` 通过，Vite 生产构建完成。
- `git diff --check` 通过。
- 本轮补充断连时即时撤回旧账本的回归；钉钉身份修订门禁、审计、模型目录和深链定向回归 50 项通过。`pnpm lint`、`pnpm dingtalk:test`、完整 `pnpm test`、`pnpm build` 与 `git diff --check` 通过。
- 当前浏览器控制插件存在版本入口漂移，未能完成真实浏览器或 Tauri WebView 的连续视觉验收。
- 本轮重新执行完整 `pnpm test`、`pnpm build`、`pnpm lint`、`pnpm verify:openclaw-docs` 与 `git diff --check` 均通过；模型目录的真实鼠标、触控板和键盘滚动仍待桌面应用验证。
