# 运行时契约收敛审计

日期：2026-08-20

## 审计范围

本轮以 JunQi 当前 `main`、OpenClaw 官方仓库当前 `main` 提交 `70b6f44f13e5a4c0c860e5412b9b5c3bb2272b1d`、相关协议 schema、Gateway handler、官方 Android、iOS 与 macOS 客户端、项目测试和本机可复现行为为依据，审查会话进度、DWS 子进程、Windows 语音唤醒、用量仪表盘和本机 Gateway 身份核验链路。

## 已确认缺陷

### BUG-RUNTIME-01：会话进度使用已淘汰的 transcript 推断链路

- 严重级别：高。
- 当前行为：JunQi 从 `update_plan` 工具调用历史重建执行计划，并把重建结果作为会话当前状态。
- 官方契约：OpenClaw 当前以 `progress_card` 写入持久状态，客户端通过 `progressCard.get` 读取，通过 `progressCard.changed` 刷新。transcript 只保留简短回执，不是状态来源。
- 影响：刷新、重连或只返回简短工具回执时，JunQi 无法还原当前进度；历史工具记录也可能被误显示成仍然有效的状态。
- 修复方向：删除 transcript 推断、旧语义块和旧合并逻辑，新增受连接身份围栏保护的官方进度卡读取与事件刷新投影。

### BUG-RUNTIME-02：DWS 完成事件可能早于最后一批输出

- 严重级别：高。
- 当前行为：Rust 后端以独立线程读取标准输出和标准错误，等待线程在子进程退出后不等待两个读取线程完成就发送终态事件。
- 影响：最后返回的结构化授权错误可能晚于终态。前端只诊断一次终态快照，因此会遗漏凭据库恢复提示。
- 修复方向：正常退出后先等待两个输出读取线程排空，再核验结果并发送终态事件；增加输出排空顺序回归测试。

### BUG-RUNTIME-03：全局会话模式下智能体语音路由生成错误主会话键

- 严重级别：高。
- 当前行为：显式智能体路由只读取 `mainKey`，忽略 `agents.list.scope`，在全局模式下生成 `agent:<id>:<mainKey>`。
- 官方契约：全局模式的规范会话键为 `global`；JunQi 本地必须以带智能体作用域的 `agent:<id>:global` 别名保存身份，再在 RPC 边界还原为 `global`。
- 影响：Windows 本地唤醒能找到智能体，却无法在已有全局会话投影中匹配目标，最终拒绝启动 Talk。
- 修复方向：显式智能体解析纳入 `scope`，并在匹配两侧统一通过会话目标解析器比较规范键。

### BUG-RUNTIME-04：全部用量未定价时同时显示两种费用提示

- 严重级别：低。
- 当前行为：没有任何可计价数据但存在 token 用量时，同时显示“未定价”和“部分估价”提示。
- 影响：同一区域给出相互矛盾的费用口径。
- 修复方向：以单一纯函数将状态归类为无数据、全部未定价、部分估价或完整估价，界面只渲染一个对应提示。

### BUG-RUNTIME-05：结构化进度设置写入上游旧配置路径

- 严重级别：高。
- 当前行为：设置页读取和写入 `tools.experimental.planTool`，并替换整个 `tools.experimental` 对象。
- 官方契约：当前开关是 `tools.updatePlan`；默认启用，`false` 表示关闭，删除字段表示恢复默认。旧路径只由官方修复命令迁移。
- 影响：用户操作可能不影响当前 `progress_card` 工具，同时整段替换会扩大配置写入范围。
- 修复方向：只读写 `tools.updatePlan`，恢复默认时使用 JSON merge patch 的 `null` 删除语义，不提交无关配置字段。

### BUG-RUNTIME-06：会话回放直接注入未净化的 transcript Markdown

- 严重级别：高。
- 当前行为：会话回放页使用 `marked.parse` 将 Gateway transcript 文本转换为 HTML，再通过 `dangerouslySetInnerHTML` 直接注入页面。
- 影响：transcript 中的原始 HTML、事件属性或危险链接可能进入桌面 WebView，形成脚本注入边界。
- 修复方向：复用聊天区不启用原始 HTML的 Markdown 渲染器，删除独立 `marked` 依赖和危险注入路径。

### BUG-RUNTIME-07：已发布 Gateway 的官方计划流没有进入进度卡

- 严重级别：高。
- 当前行为：JunQi 只读取新主线的 `progressCard.get`，真实 RPC 返回 `unknown method` 后仍丢弃官方 `stream: "plan"` 更新。
- 官方契约：OpenClaw 最新 Android、iOS 与 macOS 客户端明确说明，已发布的 `2026.8.x` 及更早 Gateway 只发计划流而没有持久化读取方法；官方客户端仅在确认方法不可用后投影该事件，并在支持持久化卡片时忽略双发流。
- 影响：当前安装渠道使用的 `2026.7.1-2` 即使模型真实更新计划，JunQi 的聊天输入区和动态岛也不会展示，已实现的交互在用户环境中实际不可达。
- 修复方向：以当前认证连接的精确未知方法响应作为门禁，接入已通过运行序号与会话归属核验的计划流；能力探测期间暂存最后更新，持久化读取成功时丢弃，连接变化时清空。

### BUG-RUNTIME-08：进度卡变更修订没有按官方语义去重和清空

- 严重级别：中。
- 当前行为：`progressCard.changed` 的任意有限数字都会触发读取，`revision: null` 也依赖额外 RPC 才能清空，相同修订会重复请求。
- 官方契约：修订只能是正整数或 `null`；`null` 是清空事实，相同修订无需读取，其他修订只作为重新读取提示。
- 影响：断线或高频更新时会产生无效读取，清空还会受额外请求失败影响。
- 修复方向：收紧事件解码，在当前连接和会话内直接处理清空与重复修订，其他变化继续读取权威卡片。

### BUG-RUNTIME-09：无真实进度卡时展示读取失败占位

- 严重级别：中。
- 当前行为：可选的 `progressCard.get` 读取失败且当前没有卡片时，聊天输入区上方持续展示“暂时无法读取”的警告。
- 影响：用户会把协议读取失败误解为存在一项失败任务；无任务时仍占用会话空间。
- 修复方向：只有 OpenClaw 返回真实进度卡时才渲染进度区域。读取失败只结束加载，不创建本地任务状态或错误卡片。

### BUG-RUNTIME-10：本机所选官方服务被瞬时 External 状态误判为远程

- 严重级别：高。
- 当前行为：`hello-ok` 身份解析直接采用 Gateway 生命周期内存快照。快照仍为 `None` 或 `External` 时，即使同端口实际由所选状态目录和配置对应的官方系统服务运行，也会生成 `remote_manual` 安装目标。
- 官方契约：OpenClaw 官方 `gateway status` 独立报告系统服务状态与 RPC 探测；端口健康不能代替服务归属核验。
- 本机证据：`ai.openclaw.gateway` LaunchAgent 正在运行，服务命令、工作目录、状态目录和配置路径均与 JunQi 当前选择一致。
- 影响：钉钉接入页把可管理的本机 Gateway 显示成外部或远程，并错误阻止插件与 DWS 生命周期操作。
- 修复方向：仅当当前选择为 Native、观测端点为所选本机端口且内存模式为 `None` 或 `External` 时，再次只读核验所选官方服务；只有确认该服务正在运行且属于所选状态后，才将身份解析为 `SystemService`。

## 验收边界

- 每个缺陷都有修复前可失败的行为回归测试。
- OpenClaw 方法、字段和事件只接受当前官方 schema，不引入别名回退。
- Gateway 连接变化时丢弃旧请求结果，清除旧连接派生的进度卡。
- 完整 TypeScript、Rust、插件、文档链接和生产构建验证通过。
- macOS、Windows、Linux 与 Docker 真机边界按实际执行结果分别记录，不以本机自动化代替。

## 修复结果

- 已发布 Gateway 的官方 `stream: "plan"` 在通过运行序号和会话归属核验后进入进度卡兼容门禁。门禁只在当前连接对 `progressCard.get` 返回精确未知方法后发布旧流；探测期间暂存最后更新，持久化读取成功后丢弃，连接变化后清空。
- `progressCard.changed` 现在只接受正安全整数或 `null`。`null` 立即清空并使在途读取失效；重复修订不再读取，其他修订继续从持久化存储获取权威卡片。
- 进度卡默认呈现紧凑按钮，点击或键盘激活后展开有界详情，继续复用 `StatusIcon`、`ChatMarkdownRenderer` 和 Aegis 主题 token。
- 新增严格的官方进度卡领域解码、`progressCard.get` 连接围栏客户端、`progressCard.changed` 事件桥和按会话共享状态。事件只作为刷新提示；并发读取期间出现新修订时，旧响应被抑制并立即重新读取。
- 聊天输入区上方与动态岛只消费当前官方进度卡。旧 `update_plan` 与 `progress_card` transcript 项只作为普通工具活动，不再推断当前步骤；旧执行计划领域、语义块、卡片、合并器和专属测试已删除。
- 结构化进度设置已收敛到 `tools.updatePlan` 的最小 JSON merge patch。恢复默认提交 `null` 删除字段，配置存在时继续要求官方 `config.get.hash` 作为 `baseHash`。
- DWS 等待线程在发布终态前等待标准输出和标准错误读取线程完成，最后一批结构化诊断不会再落到终态之后。
- Windows 本地唤醒在全局会话范围内生成 `agent:<id>:global` 本地身份，并在匹配双方都通过官方会话目标规则规范化后选择既有会话。
- 仪表盘费用提示由一个互斥分类函数决定：全部未定价只显示 Token 未估价，部分已估价只显示部分估价。
- 会话回放复用 `ChatMarkdownRenderer`，原始 HTML 只作为转义文本呈现；直接 HTML 注入和应用层 `marked` 依赖已删除。
- 没有真实进度卡时不再渲染读取失败占位；同一连接内此前已核验的卡片在暂时读取失败时保持不变。
- Gateway 身份解析在本机 Native 端点的瞬时模式为 `None` 或 `External` 时重新核验所选官方服务，确认归属后再授予本机系统服务身份；远程端点、Docker 选择和未确认服务不会被提升。

## 验证结果

- 80 项进度卡定向 TypeScript 行为测试通过，覆盖持久化响应、旧发布计划流、能力探测竞态、运行序号、连接变化、修订清空、重复修订和默认收起呈现。
- `pnpm lint` 通过，模块边界扫描 933 个生产文件，四处版本一致，TypeScript 类型检查通过。
- 完整 `pnpm test` 通过：源码测试 2878 项、脚本测试 238 项，无失败。
- `pnpm build` 通过，协作与钉钉插件包重新生成并核验，Vite 转换 9311 个模块。
- `cargo fmt -- --check`、`cargo check --lib` 和完整 `cargo test --lib` 通过：Rust 653 项通过，1 项会修改当前用户 macOS Keychain 的既有测试按设计忽略。
- `pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate`、`pnpm dingtalk:test` 和 `pnpm dingtalk:validate` 通过；协作插件 355 项、钉钉插件 21 项测试无失败。
- 全仓再次扫描 Gateway 生命周期直连、静默错误、直接 Tauri 调用、未净化 HTML 和旧执行计划引用；本轮新增确认并修复会话回放注入缺陷，未把无可复现证据的候选项描述为缺陷。
- 进度空投影与三语言资源定向测试 4 项通过；运行时身份定向 Rust 测试 9 项通过。
- 本轮完成后再次执行 `pnpm lint`、完整 `pnpm test`、`pnpm build`、`cargo fmt -- --check`、`cargo check --lib`、完整 `cargo test --lib` 和 `git diff --check`，均通过；Rust 656 项通过，1 项忽略。

## 未验证边界

- 已发布 Gateway 计划流和持久化进度卡仍需分别在真实 OpenClaw 运行中任务上核验展开、收起、实时修订、清空、长内容内部滚动和动态岛同步。
- 亮色、暗色、窄窗口、键盘焦点及系统减少动态效果尚未完成连续真机视觉验收。
- Windows SAPI、DWS 授权最后输出顺序、混合定价数据和 Docker 或远程 Gateway 仍未在对应目标环境实测。
- 本机服务再核验已由纯函数与 Rust 单元测试覆盖；安装新构建后的钉钉接入页身份文案仍需真实 UI 复验。
