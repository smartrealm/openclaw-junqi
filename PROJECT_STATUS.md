# 项目交接状态

更新时间：2026-08-11

## 当前目标

修复 OpenClaw 配置向导确认提示的重复渲染，并在精简向导步骤中自动展开日志，同时保持 OpenClaw 原生本地化与步骤语义。

## 已完成内容

- 已直接核验当前 Gateway 的官方 `usage.cost` 响应：30 天存在 30 个日期桶、17 天有非零费用；Token 与可估价费用是不同信号。
- 已确认部分历史调用返回 `missingCostEntries`，JunQi 保留“未估价”语义，不以零费用伪造结果。
- Dashboard 在费用数据尚未返回时显示加载态，不再在 effect 发起请求前错误显示空状态。
- `cost` 和 `usage` 改为可释放的页面级轮询：Dashboard、活动中心与已打开的智能体设置面板持有读取，最后一个消费者离开后停止对应定时器。
- 手动刷新仅执行一次官方读取，不再意外启动长期的费用或历史用量后台轮询。
- 会话列表使用递归投影比较替换完整 `JSON.stringify` 比较；无变化 Gateway 快照不会触发 Zustand 更新和订阅者重渲染。
- 确认步骤的 Runtime 提示只由确认控件渲染，不再同时作为页面副标题重复显示。
- 配置 OpenClaw 的整个官方 Wizard 默认展开现有日志，用户可手动收起。
- 已核验 JunQi 启动时使用 Gateway 配置的 `OPENCLAW_LOCALE`，首次创建配置才按当前应用语言写入该值。当前已安装第三方 DingTalk 插件将凭据保留提示静态写为英文，未使用 OpenClaw 本地化接口；客户端不重写第三方 Runtime 文案。

## 关键技术决策

- OpenClaw 的 `usage.cost` 是仪表盘按日费用与按日 Token 的权威来源；`sessions.usage` 仅用于需要会话或智能体历史聚合的可见页面。
- 客户端不根据 Token 推算或补写费用。缺少官方模型定价或历史归属信息时保留未知费用。
- 重型数据轮询由消费者引用计数控制，连接断开时暂停；连接恢复且页面仍持有消费者时恢复读取。

## 核心文件

- `src/stores/gatewayDataStore.ts`
- `src/stores/gatewayDataStore.test.ts`
- `src/pages/Dashboard/index.tsx`
- `src/pages/ActivityCenter.tsx`
- `src/pages/AgentHub/AgentSettingsPanel.tsx`
- `docs/gateway/gateway-lifecycle-unification-validation-2026-08-10.md`
- `src/pages/SetupPage/WizardScreen.tsx`
- `src/pages/SetupPage/wizard/WizardStepRenderer.tsx`
- `src/components/setup/SetupFlowPanels.tsx`
- `docs/installation/junqi-installation-flow.md`

## 测试与验证

- `node --import ./test-setup.ts --import tsx --test src/stores/gatewayDataStore.test.ts src/pages/Dashboard/dashboardInteraction.test.ts` 通过，50 项测试通过。
- `pnpm lint` 通过：模块边界检查、版本一致性检查和 TypeScript 类型检查通过。
- `pnpm build` 通过：协作插件、钉钉插件、TypeScript 与 Vite 生产构建通过。
- `git diff --check` 通过。
- 本机 Gateway 诊断仍记录过事件循环延迟；修复后尚未进行目标平台长时间帧率与 CPU 对比。
- 尚未在目标设备使用该第三方 DingTalk 插件完成向导；其英文凭据保留提示需要插件提供方接入 OpenClaw 原生 locale 后验证。
- 本机 `pnpm tauri build` 已完成 arm64 Rust 编译与 `.app` 生成，但内置 DMG 美化脚本失败；已对应用包执行 ad-hoc 重签名和严格校验，并以 `hdiutil` 创建、校验本地 DMG。

## 已知问题与未验证边界

- 尚未在真实 macOS、Windows、Linux 安装包上执行长时间窗口帧率、CPU 与内存对比；不能将当前源码验证描述为目标平台性能验收。
- 历史调用的可估价性取决于 OpenClaw 转录中的 Provider、Model 与运行时定价配置；未定价条目需要在模型供应商配置中补足真实价格后由官方统计重新聚合。
- 本地 DMG 为 ad-hoc 签名，未进行 Developer ID 签名或 Apple 公证；仅可描述为本机安装验证包。

## 失败方案

- 将 Token 总量直接显示为费用：会掩盖上游明确返回的未定价条目，违反 OpenClaw 统计语义。
- 在用户离开 Dashboard 后继续全局请求 `sessions.usage`：该方法会扫描历史会话与转录，当前数据规模下会放大 Gateway 和 WebView 的卡顿风险。

## 下一步顺序

1. 在 macOS、Windows 与 Linux 目标设备持续运行 Dashboard 和 Chat，采集修复前后的帧率、CPU、内存与 Gateway 诊断。
2. 为缺少定价的实际模型补充经供应商确认的价格配置，并复核 OpenClaw 重新聚合后的费用结果。
3. 在第三方 DingTalk 插件接入 OpenClaw 本地化后，以 `zh-CN`、`zh-TW` 和 `en` 完成官方 Wizard 真机验证。
