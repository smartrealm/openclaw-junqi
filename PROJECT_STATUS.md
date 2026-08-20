# 项目交接状态

更新时间：2026-08-20

## 当前目标

OpenClaw 会话计划的真实数据链路修复和回归验证已经完成，本轮源码已经提交；版本、标签、Release 和安装包另行决定。当前公开的 `v3.2.1` 不包含本轮计划流兼容修复，不能把既有安装包当作本轮完成证据。

## 已完成内容

- 核对 OpenClaw 官方主线提交 `29cfd195d19d8d6b0dab41f80f540bfc4a562872` 的协议、Gateway、Android、iOS 和 macOS 客户端实现。
- 确认已发布 Gateway 仍使用官方 `agent` 事件的 `stream: "plan"`，而 JunQi `v3.2.1` 只读取 `progressCard.get`，导致用户环境中的计划 UI 实际不可达。
- 新增旧发布计划流的严格解码和临时进度卡投影，不读取 transcript，不从工具回执推断计划终态。
- 新增按物理连接绑定的兼容门禁：能力未知时暂存，精确未知方法后启用旧流，持久化读取成功后忽略双发旧流，重连后清空派生状态。
- 修正 `progressCard.changed`：只接受正安全整数或 `null`，`null` 立即清空并使在途旧读取失效，相同修订不重复读取。
- 计划 UI 继续位于输入区上方，默认显示紧凑进度按钮，点击或键盘激活后展开步骤详情；复用当前主题和共享组件。
- 新增规格、实施计划和运行时契约审计记录。

## 关键技术决策

- `progressCard.get` 与 `progressCard.changed` 仍是持久化权威链路；`stream: "plan"` 只是在真实 RPC 已证明持久化方法不存在时启用的官方运行中兼容投影。
- 不依据版本号或 `hello-ok.features.methods` 的缺失判定能力。只有当前已认证连接的结构化 RPC 结果可以切换兼容模式。
- 旧发布计划流不写入 transcript、不伪造工具结果、不定义新的任务状态机；本地修订号只服务同一连接内的稳定渲染。
- `revision: null` 是权威清空事实，不能再等待额外 RPC；在途读取和已排队刷新必须被围栏拦截。
- 本轮没有修改 Rust、Tauri command、安装器或发布配置，因此没有提前执行桌面安装包构建。

## 核心文件

- `specs/2026-08-20-openclaw-progress-card-release-compatibility.md`
- `plans/2026-08-20-openclaw-progress-card-release-compatibility.md`
- `docs/quality/runtime-contract-convergence-audit-2026-08-20.md`
- `src/progress-card/domain.ts`
- `src/runtime/OpenClawChatEventRuntime.ts`
- `src/services/gateway/OpenClawProgressCardClient.ts`
- `src/services/gateway/progressCardEventBridge.ts`
- `src/stores/progressCardCompatibilityGate.ts`
- `src/stores/progressCardRefreshGate.ts`
- `src/stores/progressCardStore.ts`
- `src/components/Chat/ProgressCard.tsx`

## 测试与验证

- 80 项进度卡定向测试通过。
- `pnpm lint` 通过：模块边界扫描 933 个生产文件，四处版本一致，TypeScript 类型检查无错误。
- `pnpm test` 通过：源码测试 2878 项、脚本测试 238 项，无失败。
- `pnpm build` 通过：协作与钉钉插件包契约有效，Vite 转换 9311 个模块。
- `pnpm verify:openclaw-docs` 通过。
- `git diff --check` 在代码完成阶段通过；提交前仍需再次执行完整文件 Emoji、敏感信息和工作树范围检查。

## 已知问题与未验证边界

- 尚未连接真实 `2026.7.1-2` Gateway 运行一次会产生计划更新的会话，因此旧计划流的真机展示仍未验证。
- 尚未连接支持 `progressCard.get` 的最新 Gateway 验证双发抑制、持久化恢复和 `revision: null` 清空。
- 亮色、暗色、窄窗口、键盘焦点、长计划滚动和动态岛同步尚未完成连续真机视觉验收。
- 本地浏览器验收入口未发现可用浏览器实例，因此本轮没有交互截图或连续抓帧证据。
- 当前公开 `v3.2.1` Release 不包含本轮修复；本轮源码已提交，但尚未打标签或发布新版本。
- 工作树原有未跟踪目录 `.pnpm-store/` 和 `outputs/` 不属于本任务，已保持不动。

## 失败方案

- 直接按 `hello-ok.features.methods` 是否列出 `progressCard.get` 判断能力不符合 JunQi 的保守发现规则，已改为真实 RPC 证据门禁。
- 只处理 `revision: null` 的界面清空会被晚到读取覆盖，已增加请求修订围栏并丢弃旧排队刷新。
- 首次应用包含测试文件的组合补丁时因跨文件上下文不匹配失败，随后拆分为精确文件补丁，没有产生部分 UI 修改。
- 尝试启动本地浏览器交互验收时没有可用浏览器实例，未改用无关自动化工具伪造视觉结论。

## 下一步顺序

1. 连接本机已发布 Gateway，运行真实计划任务，连续观察能力探测、计划更新、展开收起和完成清空。
2. 使用支持持久化进度卡的 Gateway 验证双发抑制、重连恢复和动态岛同步。
3. 完成亮色、暗色、窄窗口、键盘和长内容视觉验收。
4. 本次提交后，再由用户决定版本号、标签、Release 和安装包。
