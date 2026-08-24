# 目标环境证据与副作用链路代码审查

日期：2026-08-24

## 范围与证据边界

本次审查只读取受版本控制的仓库源码、规格和测试，以及 Node.js 官方文档。没有使用代理所在环境的 PATH、已安装包、运行进程、配置、凭据、网络、操作系统、命令输出或工具版本作为依据。

审查范围为：

1. Native Node.js 与 OpenClaw 首次安装链路。
2. 钉钉 DWS 子进程、取消信号和写操作链路。
3. 运行时代码读取目标桌面环境时，是否将探测结果错误提升为已验证事实。

目标桌面的 PATH、用户目录和系统能力是运行时输入，不等同于代理所在本地环境。单纯读取这些目标输入不构成违规；本记录只报告其越过已定义证据或副作用边界的路径。

## 结论

确认两项需要修复的问题：

| 编号 | 严重度 | 链路 | 结论 |
| --- | --- | --- | --- |
| BUG-01 | P0 | Node.js 到 OpenClaw 首次安装 | 目标包 `engines.node` 尚未取得时，以 `*` 安装 Node.js，违反精确目标契约先行与禁止猜测性 fallback 的约束。 |
| BUG-02 | P1 | OpenClaw 工具取消到 DWS 子进程 | 已中止的 `AbortSignal` 仍可启动 DWS 写操作，取消无法阻止副作用开始。 |
| BUG-03 | P1 | Native 安装失败到运行时切换补偿 | OpenClaw 未安装时，失败补偿仍尝试恢复先前 Native Gateway，导致第二条无效启动错误覆盖安装根因。 |
| BUG-04 | P0 | Native 首次 npm 安装目录 | 未经选择即采用 npm 默认全局前缀，可能将桌面应用安装写入管理员目录。 |

## 修复状态

- BUG-01 已修复：首次安装先解析目标包元数据。存在完整 Node/npm 对时读取该对的 npm 配置；不存在时只读取公开 npm 元数据。`LegacyFallback` 不再进入 OpenClaw 安装前的 Node.js 写入路径。
- BUG-02 已修复：DWS runner 在解析可执行文件前和启动前拒绝已中止信号，并将信号传给 Node.js `spawn`。已启动写操作的中止、超时、输出截断、非零退出或无效结果统一返回 `DWS_SIDE_EFFECT_UNVERIFIED`，不推断副作用未发生。
- BUG-03 已修复：运行方式选择在落库前记录先前 Gateway 是否经当前端点探测为运行中。安装失败后的补偿只在该证据成立时恢复先前 Gateway；未运行或缺少 OpenClaw 时只回滚运行方式，不再发起无效启动。
- BUG-04 已修复：Native npm 安装只接受用户在存储设置中显式选择的 OpenClaw npm 目录，绝不读取 npm 默认全局前缀。npm 缓存目录也仅在该显式 npm 安装方式下传给子进程。
- 设置页会读取同一保存的 npm 安装目录；未选择时禁用缓存编辑并说明前置条件，后端也拒绝保存无安装目录的缓存覆盖。
- 已新增目标元数据 Node/npm 配对回归、预先中止不启动 DWS 回归，以及待核验错误的脱敏序列化回归。未执行测试；运行验证必须由目标系统的独立证据完成。

## 已核对且不构成问题的边界

- `src-tauri/src/commands/system.rs` 将 Node.js 与其自带 npm 作为同一运行时契约解析，不借用 PATH 中另一套 npm。
- `packages/junqi-dingtalk/src/dws-runner.ts` 对子进程环境使用显式白名单，未传递 OpenClaw Gateway token、DWS access token 或通用云凭据。
- `packages/junqi-dingtalk/src/index.ts` 的 `before_tool_call` 对所有 `effect: "write"` 工具请求 OpenClaw 审批；本次没有将静态 `confirmation` 字段当作绕过审批的证据。

## 问题

### BUG-04：未授权使用 npm 默认全局前缀

用户指出全局 npm 前缀与 JunQi 的默认安装目标无关。源码原先在没有保存安装目录时调用 npm 查询其有效全局前缀并写入该目录；该目录可能由管理员或系统包管理器拥有。缓存目录同样可在未选择 npm 安装方式时被注入 npm 子进程。

修复方向：

1. Native npm 安装必须要求用户明确选择 OpenClaw npm 目录；未选择时保留待配置语义，不查询或写入 npm 默认全局前缀。
2. npm 缓存选择只在显式 npm 安装方式启用时生效。
3. 删除默认全局前缀安装、对应安装目标投影、测试样例和本地化文案。

### BUG-03：未运行的先前 Gateway 被失败补偿错误恢复

用户提供的实际日志显示，Node.js 与其自带 npm 已被复用，随后 OpenClaw 因 npm 全局前缀不可写而安装失败；紧接着又出现 Gateway 启动和 `OpenClaw not found`。源码链路表明，`runNativeSetup` 遇到安装错误不会执行自身末尾的启动调用，但 `executeRuntimeSelectionTransaction` 会在已暂存运行方式的失败补偿中无条件调用 `restoreGateway(previousMode)`。

影响：

- 用户看到的第二条 Gateway 错误不属于安装动作，掩盖了真正的可写目录问题。
- 当先前 Native 运行时没有可解析的 OpenClaw 二进制时，恢复调用必然失败，并被呈现为“部分恢复操作未完成”。

修复方向：

1. 在暂存运行方式前捕获先前 Gateway 是否已被当前所选端点确认运行。
2. 失败补偿只在该确认结果为真时调用恢复入口；否则仅完成持久化回滚。
3. 增加事务行为回归，证明未运行 Gateway 的安装失败不调用恢复入口。

### BUG-01：首次安装在目标包契约未知时以通配范围写入 Node.js

位置：

- `src-tauri/src/commands/node_runtime.rs:4`
- `src-tauri/src/commands/setup/openclaw.rs:64`
- `src-tauri/src/commands/setup/openclaw.rs:1045`
- `src-tauri/src/commands/setup/node.rs:1050`

`FALLBACK_NODE_REQUIREMENT` 固定为 `"*"`。首次安装链路先调用 `ensure_installable_node_runtime(..., NodeRuntimeRequirement::fallback())`，此调用在没有可用 Node.js 时会进入安装逻辑；之后才通过该 bootstrap Node/npm 查询目标 OpenClaw 包并读取 `engines.node`。

这与现有规格相冲突：`specs/2026-08-24-target-runtime-node-resolution.md` 要求 Node.js 范围来自当前目标 npm 包，且目标包范围无法取得时不得继续写入安装。`docs/quality/target-runtime-node-resolution-2026-08-24.md` 也明确禁止以宽松范围作为安装写入依据。

影响：

- 目标包元数据尚未确认时，可能先下载、安装或覆盖一个不受目标 OpenClaw 契约约束的 Node.js 版本。
- 后续取得真实 `engines.node` 后可能发生第二次运行时安装；首次写入已无法被“最终校验通过”抵消。
- 目标元数据取得失败的场景将“待验证”降级为可写入的通配兼容结论。

修复方向：

1. 将 `LegacyFallback` 限制为纯只读状态探测，禁止传入任何安装、更新、修复或覆盖函数。
2. 为首次安装建立不写入的元数据解析路径；无法取得目标包准确 `engines.node` 时返回结构化失败。
3. 只有取得目标契约后才能调用 `ensure_installable_node_runtime`，并用该契约完成一次 Node/npm 解析或安装。
4. 增加回归测试，证明任何 `*` 要求都不能到达 Node 安装函数。

### BUG-02：已取消的工具调用仍会启动 DWS 子进程

位置：

- `packages/junqi-dingtalk/src/index.ts:147`
- `packages/junqi-dingtalk/src/dws-runner.ts:195`
- `packages/junqi-dingtalk/src/dws-runner.ts:202`
- `packages/junqi-dingtalk/src/dws-runner.ts:240`

OpenClaw 将工具调用的 `AbortSignal` 传给 `DwsRunner.run`。`run` 先执行 `spawn`，之后才注册 `abort` 监听器；它没有在解析可执行文件前、创建子进程前或注册监听器前检查 `signal.aborted`。因此信号若已中止，事件不会再次发出，DWS 命令仍会启动。

这条链路可以执行 `effect: "write"` 的工具。虽然后置 `close` 回调会返回 `DWS_CANCELLED`，但该结果只说明客户端拒绝采用结果，不能证明远端副作用没有发生。

Node.js 官方文档明确建议在注册 `abort` 监听器前检查 `AbortSignal.aborted`，且 `spawn` 原生支持 `signal` 选项用于中止子进程：[Node.js AbortSignal 文档](https://nodejs.org/api/globals.html)，[Node.js child_process 文档](https://nodejs.org/api/child_process.html)。

影响：

- 用户取消、Gateway 中止或超时传入已中止信号时，非幂等审批创建、撤销等操作仍可能被执行。
- UI 收敛为取消不能代表 DWS 或钉钉侧未发生副作用，违反未知结果必须待核验的边界。

修复方向：

1. 在任何 DWS schema 查询或业务命令前检查 `signal?.aborted` 并拒绝执行。
2. 将 `signal` 直接传入 `spawn` 选项，并保留现有 close/error 去重。
3. 对已中止、spawn 后中止和已启动写操作中止分别建模；后者必须返回待核验语义，而不能仅返回已取消。
4. 增加行为回归：预先 abort 的信号不得启动伪 DWS 可执行文件；写操作启动后 abort 的结果不得被标记为无副作用。

## 修复顺序

1. P0：删除安装路径中的 `LegacyFallback`，先取得精确目标包契约再写入 Node.js。
2. P1：收紧 DWS 的取消门禁与子进程信号传递，保留副作用结果待核验。
3. 为两个问题分别补充行为测试、静态接口检查和全局旧路径引用检查。

## 未验证边界

- 本次没有执行测试、构建、安装器或真实 Gateway/DWS 操作；结论来自静态调用链与官方 Node.js API 文档。
- DWS 对接的最终取消结果、进程树终止和钉钉服务端副作用必须在目标系统按正式协议进行验证，不能由客户端返回值推断。
