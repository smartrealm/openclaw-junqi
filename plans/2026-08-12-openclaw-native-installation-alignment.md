# OpenClaw 原生安装对齐实施计划

状态：配置接管代码与完整自动化验证已完成，真机验收待执行

## 原则

- 先修 P0 与 P1，不同时增加新业务功能。
- 按正式 RPC 响应协商 Guided 与 Classic；不以版本号或功能清单猜测能力。
- 删除被替代的旧完成凭据判断和错误文档，不增加兼容 fallback。
- 每个阶段先写可失败回归，再实现，再运行定向验证。

## 第一阶段：接入正式 guided setup 协议

1. 在服务层定义并严格校验 `openclaw.setup.detect`、`auth.start`、`prepare.start`、`activate`、`verify` 与 `openclaw.chat` 的正式 envelope。
2. 全部请求复用 `gateway.callPrivileged()`，保留 `operator.admin`、runtime identity 和 Gateway 地址作用域。
3. 新建单一 guided onboarding controller，负责检测、认证或准备、激活、验证和 chat session；页面只消费状态，不直接调用 Gateway。
4. 把首次设置默认入口从 `OpenClawWizardClient.start()` 切换到 guided controller。
5. `openclaw.setup.detect` 明确返回 unknown-method 时进入官方 Classic；连接、权限和响应错误保留原失败语义。

定向测试：协议解析、权限失败、方法缺失、检测完成、检测未完成、激活失败、激活成功、验证失败、断线未知、chat exit、chat open-agent。

## 第二阶段：收敛完成门禁

1. 将 `resolveActiveRuntimeOnboardingRequirement()` 改为协商当前 Gateway 的配置协议：Guided 读取 `setup.detect`，Classic 只消费当前官方 Wizard 的终态证明。
2. 保留本地安装健康检查，但只让它判断包、image 和存储事务，不判断模型配置。
3. Guided fresh activation 必须通过 `setup.verify`；Classic 以官方 `done` 进入同一连接与 Runtime 交接门禁。
4. 删除被替代的 `wizardCompletionAttestation` 默认路径及其专属测试；classic session 需要的进程内防重放状态留在 classic controller 内部，不扩散为全局完成事实。
5. 明确 classify：未授权、方法不存在、Gateway 不可达、配置未完成、验证失败和结果未知。
6. 交接优先复用当前已核验连接；仅在连接失效时通过统一生命周期重连，并用连接标识围栏 Runtime 探测、配置检测和模型验证。

定向测试：marker 存在但模型未配置、marker 存在但 Gateway 未授权、fresh activation 断线、配置完成重复启动、组件重建不重复执行副作用。

## 第七阶段：收敛活动配置与认证连接接管

1. 严格按 `done === true` 判定 Wizard 终态，所有 Guided、Classic 与渠道消费者复用同一终态谓词。
2. 终态后重新解析当前所选 Runtime 的端点与凭据，不使用向导前的旧 token、其他 Runtime 的设备凭据或手工地址。
3. 在已核验连接围栏内读取 `config.get`，用非空 `configRevisionHash === appliedConfigHash` 证明活动 Runtime 已采用磁盘配置。
4. 用单一绝对截止时间覆盖官方重载等待、重连、最多一次补偿重启和最终二次核验；普通超时保持待核验。
5. 仅当正式配置明确 `gateway.reload.mode: off`，或官方健康响应明确 `configReload.hotReloadStatus: disabled` 时，通过唯一生命周期协调器补发一次重启，并在新连接上重新完成身份和修订核验。
6. 把 Runtime Identity 核验失败、传输层重试耗尽和目标解析失败作为绑定当前连接代次的终态诊断；进程观察瞬时错误只作为等待诊断。连接关闭或换代时同步作废等待中的身份核验，新的 `connect` 响应清理旧配对状态。
7. 在 Runtime 与模型核验完成后再次读取活动配置修订；漂移时回到同一事务，不能提交旧连接的成功状态。
8. 特权临时连接在发送 RPC 前复核主连接标识、端点和凭据，来源变化时在副作用发生前拒绝。
9. 生命周期屏障携带真实原生重启尝试代次；事务等过恢复内部重启或屏障之间发生快速重启时，禁止再次补偿。
10. Gateway Manager 与 Connection 使用单一重试所有权：同目标显式连接先断开旧传输，配对取消经 Manager 收敛，健康观察不重置退避。

定向测试：非终态 `status: done`、旧连接失效、凭据重读失败、配置字段缺失、配置读取瞬时失败、官方重载超时不重启、重载关闭最多一次重启、恢复内部重启不重复补偿、屏障间快速重启、最终核验漂移、共享截止时间、身份核验失败立即返回、同目标连接重建、配对 timer gap 取消和取消后显式恢复。

## 第三阶段：修复 npm 安装完整性

1. 在 Rust npm 命令构造中加入与官方一致的 `--allow-scripts=openclaw`。
2. 增加命令参数单元测试，覆盖普通安装、强制重装和备用源。
3. 根据官方 bundled plugin 安装产物扩展 staging contract 验证，避免 npm 成功退出但 postinstall 缺失。
4. 核对 npm 11、npm 12 和目标 Node.js engines；记录实际验证版本，不用版本号作为 OpenClaw 能力开关。

定向测试：命令构造、脚本被阻止的失败样本、完整 staging、缺失 bundled plugin、事务回滚。

## 第四阶段：分离 guided 与 classic 生命周期

1. 默认设置 UI 只呈现 guided inference。
2. 增加简短的“详细配置”次级入口，显式启动 classic setup Wizard。
3. classic start options 补齐正式参数映射，不再丢失 `workspace` 与 daemon 选择语义。
4. 根据官方选择核验生命周期：要求 daemon 时执行官方服务交接；明确不安装时保持前台所有者并标记后台常驻未启用。
5. 渠道中心继续使用现有 channels Wizard，不与首次 guided provider 设置混合。
6. 官方步骤正文复用共享稳定内容槽；用户导航使用方向过渡，后台状态只淡入，并尊重系统减少动态效果。
7. 删除既有数据位置读取后的重复完成页和读取路径中的阶段完成调用；读取只填表，保存成功才执行阶段转换。
8. 首次设置启动所选 Runtime 前断开旧连接；连接动作只在该路径忽略历史手动地址，并以统一 Runtime Identity 门禁替换布尔 connected 判断。
9. 删除数据位置提交时的独立进度投影，提交期间保留原表单并锁定交互；安装日志由共享页面骨架统一保持默认收起。

定向测试：guided 默认、classic 显式、install-daemon、no-daemon、channels 隔离、取消、session 丢失与未知终态。

## 第五阶段：删除旧路径并同步文档

1. 删除声称 `openclaw.setup.*` 不存在的旧审计结论、规格、计划和测试。
2. 更新安装流程、Wizard 流程、首次启动 HTML 预览和文档索引。
3. 更新 PROJECT_STATUS，只保留当前目标、实际验证和未验证边界。
4. 全局检查无引用服务、旧 i18n key、旧完成状态和仅为 classic 默认路径存在的包装层。

## 第八阶段：修正首次数据位置提交门禁

1. 从存储事务实际副作用推导是否需要核验 Gateway 服务，不再使用 bootstrap 是否存在作为唯一判据。
2. 当前目录的无服务绑定变更只提交布局，让缺少 OpenClaw 的首次安装继续进入运行时安装。
3. 原生运行时位置变化、配置路径变化、未完成恢复和真实数据迁移继续失败关闭，不省略服务身份核验。
4. 增加纯判据回归和本机首次设置实测，确认修复不会放宽迁移路径。

定向测试：bootstrap 存在但无绑定变更、原生运行时变更、配置路径变更、恢复待处理、无 bootstrap。

## 第六阶段：收敛最新版 Guided 契约

1. 候选梯子跳过明确无凭据项，并在已有默认模型激活失败时停止自动替换。
2. 自动激活成功后增加当前有效路径确认；改选时保留已激活事实，只有用户确认使用后进入 onboarding chat。
3. Classic 与 Guided 复用最新版 setup admission busy 判定，分别进入 reclaim 与可重试错误。
4. 呈现官方不可用候选、认证或手动修复入口和推荐安装建议。
5. 为 Provider Wizard 与 chat 内嵌 Wizard 补齐官方取消操作和失败反馈。
6. 删除当前协议已移除且全仓无消费者的 `codexAppServerDetected`，保留 `configuredModel` 作为检测契约字段但不伪造独立 UI。

定向测试：无凭据候选、已有模型失败停止、自动路径确认、admission busy、不可用入口、推荐安装、两类取消和检测字段严格解析。

## 验证顺序

1. 最小 TypeScript 协议和 controller 测试。
2. Setup 页面和导航回归。
3. Rust 安装命令与 staging contract 测试。
4. `pnpm lint`。
5. `pnpm test`。
6. `pnpm test:rust`。
7. `pnpm build`。
8. `pnpm verify:openclaw-docs`。
9. `git diff --check`。
10. macOS Native 真机：全新安装、已有有效配置、无效凭据、guided、classic 两种 daemon 选择。
11. Docker 真机：全新安装、已有配置、容器停止恢复。
12. Windows 与 Linux：安装脚本、系统服务、权限、窄窗口和键盘流程。

## 当前进度

- 第一阶段已完成：正式 guided setup 协议、候选激活、供应商 Wizard 与 onboarding chat 已接入。
- 第二阶段已完成：冷启动官方探测和 Guided、Classic 共用的同连接交接门禁已实现。
- 第三阶段已完成代码部分：npm 12 脚本授权与官方 postinstall inventory 校验已接入 Rust 安装验证。
- 第四阶段已完成代码部分：Guided 默认、Classic 显式，二维码随当前官方步骤销毁，官方步骤在稳定内容槽内按导航方向切换。
- 第四阶段补充修复已完成代码部分：已删除数据位置读取后的自动推进，并固定“用户提交成功才推进”的状态机。
- 第二阶段补充修复已完成代码部分：首次设置不再复用旧连接或历史手动地址，配置协商必须等待当前连接的 Runtime Identity 核验。
- 第二阶段连接竞态补充修复已完成：显式启动结束前状态订阅只更新诊断，首次连接由启动成功终态单独触发。
- 第四阶段布局补充修复已完成代码部分：稳定页面骨架与步骤正文高度解耦，短步骤不再强制满高。
- 第四阶段国际化补充修复已完成代码部分：数据位置进度使用明确字符串叶子，资源加载和测试拒绝同路径类型冲突。
- 第四阶段交互补充修复已完成代码部分：数据位置提交不再渲染客户端自造进度页；依赖安装宽窗口按左右栏展示步骤和记录，窄窗口保留用户控制的切换。
- 第四阶段官方步骤层级已收敛：配置页只在首个正式步骤准备完成后进入；普通提示、操作和进度共用紧凑摘要，保留上游原文并等待结构化终态。
- 第二阶段呈现补充修复已完成代码部分：Gateway 认证连接与运行时身份核验原地替换安装摘要，内部 `gateway-ready` 不再生成独立视觉页面。
- 第二阶段配置交接补充修复已完成代码部分：运行时页面先取得 Guided 可操作状态或 Classic 首个官方步骤，再一次进入配置页；配置页不再以挂载后的自动启动产生连接占位页和二次跳变。
- 第二阶段交接补充修复已完成代码部分：官方配置终态后的重连会重新解析当前所选 Runtime 的连接目标与凭据，不复用历史连接目标。
- 第六阶段已完成代码部分：候选梯子、激活后确认、admission busy、检测详情呈现、两类取消与遗留字段删除均已实现并通过定向回归。
- 第二阶段会话生命周期补充修复已完成代码部分：首次设置 Classic Wizard 显式关闭其 daemon 安装分支，避免 Gateway 自重启销毁进程内 session；真实会话丢失仍保留未知终态和人工确认。
- 第四阶段过渡补充修复已完成代码部分：同一配置内容槽等待旧步骤退出后再挂载新步骤，消除前进和后退时的正文重叠。
- 第四阶段短步骤视觉补充修复已完成代码部分：共享摘要按提示、待执行和处理中状态复用现有主色与警告色 token，只增加轻量引导线和图标层级。
- 第七阶段已完成代码部分：官方终态、活动配置修订、绝对截止时间、结构化重载禁用、真实重启尝试代次、同连接同修订二次核验、待定身份失效、单一连接重试所有权、配对取消收敛和特权写前来源围栏已接入并通过定向回归。
- 第五阶段自动化部分已完成：完整前端测试、脚本测试、lint、生产构建和官方文档链接验证通过；目标平台真机验收待执行。
