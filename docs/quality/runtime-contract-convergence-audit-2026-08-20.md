# 运行时契约收敛审计

日期：2026-08-20

## 审计范围

本轮以 JunQi 当前 `main`、OpenClaw 官方仓库当前 `main` 提交 `b934625d805`、相关协议 schema、Gateway handler、项目测试和本机可复现行为为依据，审查会话进度、DWS 子进程、Windows 语音唤醒和用量仪表盘链路。

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

## 验收边界

- 每个缺陷都有修复前可失败的行为回归测试。
- OpenClaw 方法、字段和事件只接受当前官方 schema，不引入别名回退。
- Gateway 连接变化时丢弃旧请求结果，清除旧连接派生的进度卡。
- 完整 TypeScript、Rust、插件、文档链接和生产构建验证通过。
- macOS、Windows、Linux 与 Docker 真机边界按实际执行结果分别记录，不以本机自动化代替。

## 修复结果

- 新增严格的官方进度卡领域解码、`progressCard.get` 连接围栏客户端、`progressCard.changed` 事件桥和按会话共享状态。事件只作为刷新提示；并发读取期间出现新修订时，旧响应被抑制并立即重新读取。
- 聊天输入区上方与动态岛只消费当前官方进度卡。旧 `update_plan` 与 `progress_card` transcript 项只作为普通工具活动，不再推断当前步骤；旧执行计划领域、语义块、卡片、合并器和专属测试已删除。
- 结构化进度设置已收敛到 `tools.updatePlan` 的最小 JSON merge patch。恢复默认提交 `null` 删除字段，配置存在时继续要求官方 `config.get.hash` 作为 `baseHash`。
- DWS 等待线程在发布终态前等待标准输出和标准错误读取线程完成，最后一批结构化诊断不会再落到终态之后。
- Windows 本地唤醒在全局会话范围内生成 `agent:<id>:global` 本地身份，并在匹配双方都通过官方会话目标规则规范化后选择既有会话。
- 仪表盘费用提示由一个互斥分类函数决定：全部未定价只显示 Token 未估价，部分已估价只显示部分估价。
- 会话回放复用 `ChatMarkdownRenderer`，原始 HTML 只作为转义文本呈现；直接 HTML 注入和应用层 `marked` 依赖已删除。

## 验证结果

- 43 项本轮定向 TypeScript 行为测试通过，覆盖进度卡解码、连接变化、离屏旧缓存、事件刷新竞态、配置补丁、全局语音路由、费用提示和会话回放 HTML 安全边界。
- `pnpm lint` 通过，模块边界扫描 932 个生产文件，四处版本一致，TypeScript 类型检查通过。
- 完整 `pnpm test` 通过：源码测试 2868 项、脚本测试 238 项，无失败。
- `pnpm build` 通过，协作与钉钉插件包重新生成并核验，Vite 转换 9310 个模块。
- `cargo fmt -- --check`、`cargo check --lib` 和完整 `cargo test --lib` 通过：Rust 653 项通过，1 项会修改当前用户 macOS Keychain 的既有测试按设计忽略。
- `pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate`、`pnpm dingtalk:test` 和 `pnpm dingtalk:validate` 通过；协作插件 355 项、钉钉插件 21 项测试无失败。
- 全仓再次扫描 Gateway 生命周期直连、静默错误、直接 Tauri 调用、未净化 HTML 和旧执行计划引用；本轮新增确认并修复会话回放注入缺陷，未把无可复现证据的候选项描述为缺陷。

## 未验证边界

- 官方进度卡仍需在真实 OpenClaw 运行中任务上核验展开、收起、实时修订、清空、长内容内部滚动和动态岛同步。
- 亮色、暗色、窄窗口、键盘焦点及系统减少动态效果尚未完成连续真机视觉验收。
- Windows SAPI、DWS 授权最后输出顺序、混合定价数据和 Docker 或远程 Gateway 仍未在对应目标环境实测。
