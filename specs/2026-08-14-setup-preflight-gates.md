# 首次设置前置门禁规格

## BUG-01 · 更新检查位置

当前：更新面板随 Gateway 启动页闪过，用户可未经检查进入配置。

目标：Native Runtime 在本次设置开始前已经安装时，“正在配置 JunQi Desktop”完成后进入独立的“OpenClaw 更新”步骤，再进入 Guided 或 Classic 官方配置。该步骤自动执行一次官方更新检查；检查失败时保留重试，不伪报已检查。更新成功后重新读取 Runtime 与 Gateway 状态。

验收：

- 已有安装按“运行时配置完成 → OpenClaw 更新 → OpenClaw 官方配置”的顺序呈现三个独立页面状态。
- 运行时配置完成页对已有安装显示“下一步”，对本次新安装显示“核验配置”，文案与实际目标一致。
- 本次流程中新安装的 OpenClaw 不重复进入已有安装更新步骤。
- 检查完成前不能启动 Guided 或 Classic 配置。
- 可用更新保持用户明确确认，不自动修改本地安装。

## BUG-02 · Wizard 启动参数协商

当前：封闭 schema 拒绝 `installDaemon` 后仍提供相同请求的重试。

目标：主线 Runtime 首次请求保留 `installDaemon:false`。只有 stable 在创建会话前以精确 `INVALID_REQUEST` 拒绝该字段时，才在同一操作仍有效的前提下改用主线与 stable 的公共参数启动一次；其他错误不得重试或降参。

验收：

- 主线 Runtime 只收到一次含 `installDaemon:false` 的请求。
- stable 精确拒绝该字段时，第二次请求只包含 `mode` 与可选 `workspace`，并继续呈现官方步骤。
- 通用网络、权限、其他未知参数错误和 channels flow 不触发该协商。
- 第一次响应返回后操作已失效时，不发送第二次请求。

## BUG-03 · 存储状态读取

当前：初次状态响应等待递归目录统计。

目标：初始状态只返回表单所需的存在性与路径；不递归统计目录容量。

验收：

- `get_storage_setup_status` 不调用 `collect_stats`。
- 迁移事务内用于复制完整性校验的统计保持不变。
- 前端字段和 Tauri 序列化契约同步删除无消费者的容量字段。

## BUG-04 · 配置协议与更新可用性

当前：当前 Runtime 拒绝正式 Wizard 参数后，界面直接显示“需要更新”，并把完成更新当作唯一解除条件；该错误本身没有证明当前渠道存在更新或更新后会兼容。

目标：客户端必须继续核对当前 Runtime 是否提供稳定版正式 `crestodian.setup.*` Guided 方法，并按 BUG-02 协商 Classic Wizard 启动参数。更新检查仍返回真实阶段和 `available` 字段，不能把字段差异推导为存在更新。

验收：

- `installDaemon` 的精确字段拒绝由 Wizard 客户端内部完成安全协商，不映射为“需要更新”或永久“协议不兼容”。
- `openclaw.setup.detect` 精确 unknown-method 后调用正式 `crestodian.setup.detect`；其他错误不切换方法名。
- Guided 方法成功后，后续 activate 与 chat 必须绑定同一方法族；两个 detect 都明确 unknown-method 才进入 Classic。
- Wizard 启动错误不得触发更新页导航；无法安全协商的真实错误原样停留在当前准备边界。
- 稳定 activate 的真实模型调用成功可作为本次流程的模型证据；不得调用不存在的 verify 或重复 activate。

## BUG-05 · 生产发布渠道门禁

当前：新安装使用官方定义为 stable 的 npm `latest`。已有安装的受管 updater 跟随本地持久化渠道，`beta` 或 `dev` 仍可被检查、安装并继续配置。

目标：JunQi 新安装继续使用 npm `latest`，不从版本字符串自造渠道判断；已有安装仅允许官方 `stable` 与 `extended-stable` 进入受管更新和配置。`beta`、`dev`、其他值与缺失渠道均失败关闭，不自动改写用户的持久化渠道。

验收：

- 新安装目标仍由官方 npm `latest` 契约解析，不引入版本号或版本名字样门禁。
- 更新状态通过明确的结构化字段区分允许、不支持和未知渠道。
- 不支持或未知渠道不显示可执行更新操作，且首次设置的“下一步”保持禁用。
- Rust 更新 command 在 Gateway 维护交接前再次拒绝不支持或未知渠道。
- stable 与 extended-stable 可保留各自官方 updater 语义；客户端不使用版本号推断渠道。
- 协议修复只存在于 beta 时，界面明确等待稳定发布，不引导安装 beta。

## BUG-06 · 官方 Guided 方法族协商

当前：JunQi 只认识最新版 `openclaw.setup.*` 方法名，忽略 npm stable 2026.7.1-2 已注册的 `crestodian.setup.*`。

目标：用正式 unknown-method 响应协商官方方法族，不以版本号、渠道名称或 `hello-ok.features.methods` 作为能力开关。

验收：

- 当前方法族成功时不调用 Crestodian 方法。
- 当前 detect 精确 unknown-method 时调用 Crestodian detect，并把稳定 schema 缺少的新版扩展列表规范化为空列表。
- 稳定 activate 不发送其 schema 未定义的 `modelRef`。
- 两个正式 detect 都不支持时才选择 Classic。
- 稳定 activate 成功后可完成配置交接，且不伪造 verify RPC。
