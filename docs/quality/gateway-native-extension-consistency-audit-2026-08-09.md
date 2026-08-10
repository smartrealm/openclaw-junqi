# Gateway 原生能力与扩展一致性审计

日期：2026-08-09

> 本文记录整改前的审计事实。当前实现与自动化结果见
> `gateway-native-extension-consistency-validation-2026-08-09.md`。

## 审计结论

JunQi 当前没有在生产代码中调用无法由最新版 OpenClaw 核对的字面量 Gateway 方法。配置控制面、
Gateway 方法发现、浏览器控制、协作插件和钉钉插件的主要边界也符合“OpenClaw 拥有协议语义，JunQi
只做桌面投影和正式扩展”的定位。

但是当前仓库不能判定为全量一致。已确认 5 项高优先级问题和 5 项中优先级问题：模块边界检查器会
错误放行真实违规；二维码登录使用普通连接调用管理员方法；Chat 流式投影未实现官方 `deltaText`
契约；Wizard 会用本地配置推断官方成功；启动阶段仍向 WebView 广播无消费者的 Gateway token。
这些问题会分别造成架构检查失真、权限失败、流式内容缺失、官方状态被伪造和不必要的凭据暴露。

审计阶段只形成问题和整改设计。后续实现结果分别记录在验收规格、实施计划和验证记录中：

- `specs/quality/2026-08-09-gateway-native-extension-consistency-remediation.md`
- `plans/quality/2026-08-09-gateway-native-extension-consistency-remediation.md`
- `docs/quality/gateway-native-extension-consistency-validation-2026-08-09.md`

## 范围与权威依据

审计覆盖：

- `src/services/gateway/`、`src/stores/`、渠道二维码登录和首次启动 Wizard；
- `src-tauri/` 的 Gateway 启动、凭据和 Tauri command 暴露面；
- `packages/junqi-collab/` 与 `packages/junqi-dingtalk/` 的 OpenClaw 插件边界；
- 模块边界检查、IPC 契约测试和当前插件验证脚本。

OpenClaw 权威基线使用本地官方仓库 `origin/main`，提交为
`7a8eee4a363b6fd097a40d221aedcff14e61cc8c`，提交日期为 2026-08-08。JunQi 当前依赖和本机安装
版本只用于复现，不作为能力开关。官方工作区未切到最新提交，因此本轮所有上游证据均通过
`git show origin/main:<path>` 和 `git grep origin/main` 读取，未使用旧工作树内容替代最新版契约。

本轮重点核对的官方来源包括：

- `src/gateway/methods/core-descriptors.ts`：方法、权限、广告与处理族；
- `src/shared/session-method-scopes.ts`：会话动态权限；
- `src/gateway/server-methods/wizard.ts` 与
  `packages/gateway-protocol/src/schema/wizard.ts`：Wizard 会话；
- `src/gateway/server-chat.ts` 与 `ui/src/pages/chat/chat-gateway.ts`：Chat 事件和增量合并；
- `src/gateway/server-methods-list.ts`：Gateway 事件目录；
- `src/plugins/plugin-api.types.ts` 与插件注册器：正式插件扩展点。

## 已验证一致的部分

### 1. Gateway 协议版本和方法名称

- 最新官方 `PROTOCOL_VERSION` 与 `MIN_CLIENT_PROTOCOL_VERSION` 均为 4；JunQi 的 operator 客户端
  使用同一边界。
- 对 JunQi 生产代码中 85 个字面量 RPC 方法做静态集合比较后，均可在最新版官方核心方法目录或
  官方 Browser 插件中找到；未发现伪造的普通 Gateway RPC。
- `browser.request` 属于官方内置 Browser 插件的管理员方法。
- `junqi.collab.*` 不属于核心方法，但由 JunQi 插件通过官方 `registerGatewayMethod` 注册，属于正式
  插件扩展，而不是客户端伪造核心协议。

该结论只覆盖可静态识别的字面量方法。动态插件方法仍须由实际 Gateway 注册结果和调用回执证明。

### 2. 方法发现保持保守语义

`GatewayCapabilityRegistry` 将 `hello-ok.features.methods` 仅记录为 advertised 证据。方法未出现在列表中
不会被直接判定为 unsupported；实际请求的结构化成功或失败才更新能力结论。这与根规范中“方法目录不是
完整可调用清单”的要求一致。

### 3. 配置控制面

当前配置写入链路会先验证官方 `config.get` envelope 的 `exists`、`valid`、`config` 和 `hash`。既有配置
写入使用同一快照的 `hash` 作为 `baseHash`，没有把裸配置、猜测字段或本地文件写入作为兼容路径。

### 4. 协作与钉钉扩展

- 协作插件的 43 个 RPC 均通过官方插件 API 注册，并为读写方法声明权限；注册唯一性、错误隐藏、
  幂等、持久化和回执行为有自动化覆盖。
- 钉钉插件通过官方 `registerTool`、工具元数据和 `before_tool_call` 审批边界提供能力。业务写操作均需
  审批；DWS 子进程使用 `shell: false`、受限环境、路径唯一性校验、输出上限、超时和取消。
- Tauri 的 DWS command 只负责安装和授权，不直接执行钉钉业务写操作。

插件包当前以 OpenClaw `2026.7.1-2` 作为开发依赖，peer 范围为 `>=2026.7.1`。源码接口仍能在最新版
官方主线找到，但本轮没有把两个插件装入最新版真实 Gateway 做运行验收，因此这里只能确认静态和包契约。

## 已确认问题

### GNE-01 高：模块边界检查器错误放行真实违规

`scripts/check-boundaries.mjs` 将 `@/services/foo` 解析为 `services/foo`，却继续用
`@/services/**` 作为禁止模式匹配，因此别名导入不会命中。测试文件复制了另一套实现，并错误声称生产
脚本会保留 `@/` 前缀；最后的真实仓库测试只断言脚本退出码为 0，因而与生产缺陷一起通过。

现有命令输出：

```text
PASS Module boundaries clean (checked 916 files)
```

按规则本意修正别名后进行只读扫描，得到 130 个真实违规：

- `components -> services`：119；
- `services -> stores`：11。

已确认的循环包括：

- `chatStore -> gateway facade -> ChatHandler -> chatStore`；
- `Connection -> gatewayDataStore -> Connection`。

影响：`pnpm lint` 的模块边界结论不可信，现有“边界已通过”文档证据失效。不能直接机械迁移 130 个
导入；应先让检查器使用一个可导出的实现，再按依赖倒置逐批拆除循环。

### GNE-02 高：二维码登录使用普通连接调用管理员方法

最新版官方方法目录将 `web.login.start` 和 `web.login.wait` 定义为不广告的
`operator.admin` 方法。`ChannelQrLoginSession` 接收一个通用 `gateway.call`，
`ChannelQrLoginDialog` 注入的也是全局普通 Gateway facade。真实环境会返回
`missing scope: operator.admin`。

现有测试只提供无权限语义的 mock，因此验证了状态机，却没有验证请求通道。

目标：二维码会话只依赖一个窄化的管理员请求端口；渠道状态核验继续使用只读连接。测试必须断言
`start/wait` 进入管理员通道，且普通通道没有这两个调用。

### GNE-03 高：Chat 流式投影未实现最新版 `deltaText` 契约

最新版官方 Chat 载荷包含 `status`、`delta`、`final`、`aborted` 和 `error`。`delta` 可只携带
`deltaText`，并通过 `replace` 表达替换；官方 UI 会在增量、累计快照和丢包恢复之间进行合并。官方测试
明确覆盖“没有完整 message 快照时追加 deltaText”。

JunQi `ChatHandler` 仍从 `p.message?.content` 提取增量文本，从未读取 `deltaText`，也没有投影
`status` 的启动阶段。当前测试构造的是带 `message` 的旧式 delta，因此全部通过但无法证明最新契约。

影响：当 Gateway 发送只有 `deltaText` 的合法事件时，实时正文为空，直到终态或历史刷新才出现；
`replace` 也无法按官方增量语义生效。启动阶段 `preparing_workspace`、`provisioning_environment`、
`preparing_context` 和 `starting_model` 没有真实 UI 投影。

同时，Connection 只校验通用事件 envelope，ChatHandler 以 `any` 消费 Chat 和 Agent payload。除
`session.tool`、`session.operation` 等少数事件外，协议漂移会越过解码边界。

目标：增加 Chat 和 Agent 的判别式解码器，由投影层实现与官方一致的 delta/snapshot/replace 合并；
无效载荷不得推进序列、运行状态或正文。这里适合使用按事件变体分派的策略或访问者，不适合为每个事件
建立抽象类继承树。

### GNE-04 高：Wizard 会用本地配置推断官方成功

审计时 `useWizardSession` 在官方 Wizard 会话丢失后检查本地配置结构；如果配置看起来完整，直接构造
`{ done: true, status: "done" }`。终态说明后的连接超时也使用同样逻辑构造成功结果。

这违反“JunQi 不得从超时、本地状态或文本推断官方成功”的边界。本地配置完整只能证明配置事实，不能
证明原 Wizard 会话完成、第三方步骤成功或 Gateway 已确认终态。

修复：会话丢失时不再读取本地配置或合成 `done`，直接由 `restartAfterSessionLoss()` 创建新的官方
Wizard 会话；交接超时保留错误与待重试状态。`wizard.status` 会清理当前进程内会话，因此恢复使用
无答案的 `wizard.next`；仅当 Gateway 返回终态时才进入完成路径。

`isOpenClawWizardNonBlockingProbeFailure` 还通过 title/message 正则将部分失败解释为非阻断。官方步骤
没有对应结构化字段；文本只能用于展示，不能改变协议失败语义。最新版官方 `wizard.start` 已支持可选的
`flow: "setup" | "channels"`，但这不授权客户端从标题推断 flow 或终态。

### GNE-05 高：启动阶段仍广播无消费者的 Gateway token

`src-tauri/src/lib.rs` 在应用 setup 阶段调用 `detect_gateway_config`，随后向主 WebView 广播
`gateway-config`，载荷包含 token、WebSocket URL、HTTP URL 和端口。全仓没有该事件的前端订阅者，
而且事件发生在前端加载前，不能形成可靠配置来源。

`src/services/gateway/configResolvers.ts` 中的 `EventPayloadResolver`、`CachedTokenResolver`、
`FileReadResolver` 和 `ConfigResolverChain` 没有生产消费者，只被自身测试引用。当前连接目标实际由
`GatewayConnectionTargetResolver` 解析。

影响：凭据被不必要地扩展到 WebView 事件面，且保留一套已失去消费者的旧解析架构。

目标：删除 `gateway-config` 事件和死解析链及其专属测试、导出和文档。连接目标继续只走当前受控的
运行时身份、凭据提供器和 Tauri IPC 边界。

### GNE-06 中：Gateway 数据仓库仍处理非官方顶层事件

最新版官方 `GATEWAY_EVENTS` 不包含以下顶层事件：

- `session.started`、`session.running`、`session.ended`、`session.stopped`、`session.idle`；
- `agent.spawned`、`agent.created`；
- `task-status`、`task-session`。

后两类 task 事件是 JunQi Rust hook 发出的 Tauri 事件，已有独立 Tauri 订阅者，不应同时出现在 Gateway
事件投影。Talk 内部的 `session.started` 也嵌套于 `talk.event`，不是同名顶层 Gateway 事件。

目标：先确认所有已打包插件没有注册这些同名顶层事件，再删除 Gateway switch 中的遗留分支。Tauri
hook 状态继续走单独的本地事件适配器，不能混入 Gateway 权威事件目录。

### GNE-07 中：会话模型切换请求权限高于官方要求

最新版官方动态权限规则允许仅修改 `model` 的 `sessions.patch` 使用 `operator.write`。JunQi
`SessionSettingsClient.setModel` 仍强制使用管理员连接；thinking、fast、verbose、trace 等运行参数走管理员
连接是正确的。

影响：普通模型选择可能触发不必要的管理员凭据获取、审批或权限失败。

目标：模型字段改走普通写连接，并为每个会话字段建立由官方动态权限规则驱动的可执行测试，避免客户端
自建更宽的权限表。

### GNE-08 中：WebView 暴露面存在无静态消费者的 Tauri command

当前 `generate_handler!` 注册约 300 个 command。只读静态比较发现 39 个注册名没有生产前端的字面量
`invoke` 消费者。动态调用、Rust 内部调用和生成代码可能使部分结果成为误报，因此不能一次性删除全部。

其中以下凭据和 OAuth command 没有发现生产前端消费者：

- `get_provider_secret`、`delete_provider_secret`、`list_provider_secrets`；
- `read_provider_api_key`、`start_provider_oauth`；
- `store_provider_secret` 没有前端消费者，但仍由 Rust OAuth command 内部调用。

目标：逐项核对静态导入、动态字符串、Rust 内部调用、插件清单和测试。确认无 WebView 消费者的 command
应从 `generate_handler!` 移除；仍需内部复用的函数保留为普通 Rust 函数，不必继续暴露给 WebView。

### GNE-09 中：IPC 守护测试大量依赖源码文本

`src/api/tauriCommandsContract.test.ts` 读取约 40 个源码文件并使用正则或源码切片断言具体写法。该方式
守护的是变量名、表达式和位置，不是可执行的序列化契约，违反根规范中的测试要求。

目标：优先将高风险 Gateway 和 Tauri 边界迁移为可执行 schema、导出的纯解析器、生成的 command
注册表或 Rust/TypeScript 共享 fixture。少量注册 smoke test 可以保留，但不能把源码文本匹配当作字段和
权限一致性的主要证据。

### GNE-10 中：插件尚未在最新版真实 Gateway 验证

协作和钉钉插件的单元测试、TypeScript 构建和包契约均通过，最新版官方源码也仍提供所用注册 API。
但是开发依赖固定在 `2026.7.1-2`，本轮没有在官方提交 `7a8eee4...` 对应的真实 Gateway 加载插件，
也没有执行真实租户 DWS 行为。

目标：使用受控测试 Gateway 完成插件发现、方法和工具注册、权限、审批、重启恢复与失败关闭验收。
在该验证完成前，不把 `peerDependencies >=2026.7.1` 解释为已证明所有未来版本兼容。

## 设计模式与面向对象结论

### 适合保留或加强的模式

- 端口与适配器：二维码登录、Wizard、Session 设置只依赖窄化 request port；普通、管理员和审批连接由
  组合根注入。
- 观察者：Connection 只发布连接生命周期和原始已解码事件，store 订阅投影；避免 transport 直接导入
  Zustand store。
- 策略与访问者：按 Chat/Agent 的判别式事件变体分派，不在一个 `any` switch 中混合协议解析与 UI 状态。
- 命令模式：管理员写操作、协作写操作和外部副作用保留命令身份、幂等键、权限和待核验终态。
- 仓储：凭据、协作审计和任务状态由各自受控仓储管理；WebView 不接触原始 secret。
- 状态机：Wizard 可以用状态机组织 UI，但状态只能来自官方会话、连接和分离的配置核验事实。

### 不应采用的做法

- 不为每个 RPC 或事件建立抽象基类和工厂层；类型联合、纯解码器和组合已足够。
- 不增加兼容包装、旧字段 fallback 或双轨事件名。
- 不以通用 facade 持有 transport、store、UI 回调、权限和投影全部职责。
- 不为了“使用设计模式”引入没有第二个消费者的接口或配置层。

## 验证结果

本轮实际执行：

- 8 个定向测试文件，共 179 项，通过；
- `pnpm collab:test`，368 项，通过；
- `pnpm collab:validate`，通过；
- `pnpm dingtalk:test`，12 项，通过；
- `pnpm dingtalk:validate`，通过；
- `pnpm test`，前端 2847 项与脚本 243 项，共 3090 项，通过；
- `pnpm lint` 的版本一致性和 TypeScript 检查通过；
- `pnpm verify:openclaw-docs`，通过；
- `pnpm check:boundaries` 和 `pnpm test:boundaries` 均通过，但已证明该结果是假阴性，不能作为有效证据；
- 修正规则后的只读扫描检查 916 个生产 TS/TSX 文件，确认 130 个边界违规。

定向测试通过说明当前实现被既有测试稳定复现，不表示它符合最新版协议。特别是 QR、Chat、Wizard 和
边界测试需要先补能在当前实现上失败的回归，再修改生产代码。

## 未验证边界

- 未连接真实最新版 Gateway 执行 QR 登录、Wizard 进程交接和仅 `deltaText` 的 Chat 事件回放；
- 未在真实最新版 Gateway 加载协作和钉钉插件；
- 未执行 macOS、Windows、Linux 的凭据库和 Tauri command 最小暴露面真机验证；
- 未运行完整 Rust library tests 和 Tauri 打包；本轮没有修改生产代码，也不把文档审计描述为真机修复；
- 130 个模块边界违规尚未整改，不能在修复检查器后立即把全部违规加入同一个无边界重构提交。
