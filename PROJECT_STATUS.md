# 项目交接状态

更新时间：2026-08-20

## 当前目标

将当前主线按用户要求发布为 JunQi Desktop `3.2.1`。本次是 `v3.2.0` 发布结果文档之后的补丁发布，不新增运行时能力；先完成本地发布验证，再通过不可变 `v3.2.1` 标签触发三平台制品与 GitHub Release。

## 已完成内容

- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 已统一更新为 `3.2.1`。
- 已新增 `v3.2.1` 标签发布验证记录，明确补丁版本依据、不可变标签发布顺序和制品信任边界。
- `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 已统一更新为 `3.2.0`。
- 已新增 `v3.2.0` 标签发布验证记录，明确远端 `main`、同提交 CI、不可变标签和三平台 Release 的先后门禁。
- 版本提交 `4893905a22aa62f5faa54a2293191c3f27c83bf5` 已推送到远端 `main`，同提交 `CI` 工作流 32318391003 全部成功。
- 带注释标签 `v3.2.0` 已推送并精确指向版本提交；`Tagged Desktop Release` 工作流 32318656779 全部成功。
- GitHub Release `JunQi Desktop 3.2.0` 已发布，共包含 11 个附件，覆盖 macOS ARM64、macOS x64、Windows x64、更新签名、内部测试证书说明和 `latest.json`。
- 会话进度已从 transcript 中的旧 `update_plan` 推断迁移到官方持久化进度卡。客户端通过 `progressCard.get` 读取，通过 `progressCard.changed` 刷新，不从历史工具回执补足当前状态。
- 新进度卡读取绑定已认证连接身份和精确会话作用域；连接变化、跨会话响应和刷新期间晚到的旧修订都不能覆盖当前投影。
- 聊天输入区上方新增可展开的当前步骤胶囊与有界详情面板，动态岛消费同一进度卡投影。旧执行计划领域、语义块、卡片、合并器及其专属测试已删除。
- 结构化进度设置只读写 OpenClaw 当前 `tools.updatePlan` 开关。恢复自动模式使用 JSON merge patch 的 `null` 删除语义，不再替换旧 `tools.experimental` 对象。
- DWS 子进程终态在标准输出和标准错误读取线程排空后发布，避免最后一批结构化授权诊断晚于完成事件。
- Windows 本地唤醒在全局范围内使用 `agent:<id>:global` 本地会话身份，并在目标和候选两侧统一规范化后匹配已有会话。
- 仪表盘将全部未定价、部分已估价、完整估价和无用量收敛为互斥费用提示状态，不再同时展示相互矛盾的标签。
- 会话回放改为复用聊天区安全 Markdown 渲染器。Gateway transcript 中的原始 HTML 只显示为转义文本，独立 `marked` 依赖和直接 HTML 注入已删除。
- 全仓静态审查覆盖 Gateway 生命周期直连、静默错误、直接 Tauri 调用、配置写入、未净化 HTML、旧执行计划引用和当前改动的无引用代码。除上述六项外，没有把缺少源码或运行证据的候选项判定为缺陷。
- 临时规格和实施计划已在结论收敛到长期质量记录后删除。

## 关键技术决策

- `v3.2.0` 之后没有运行时代码变更；用户明确要求发布当前主线，因此采用补丁版本 `3.2.1`，不覆盖或移动既有标签。
- `.github/workflows/tag-release.yml` 仍是正式发布入口；必须先推送版本提交并取得同提交 `CI` 成功，再推送带注释标签 `v3.2.1`。
- 相对 `v3.1.2` 的新增钉钉工作台、智能体工位、Windows 原生语音和官方进度卡属于向后兼容的新能力，因此采用次版本 `3.2.0`，不覆盖既有标签或 Release。
- `.github/workflows/tag-release.yml` 是本次正式发布入口；必须先推送版本提交并取得同提交 `CI` 成功，再推送带注释标签 `v3.2.0`。
- OpenClaw 官方仓库当前主线提交 `b934625d805` 的协议 schema、Gateway handler 和文档是本轮进度卡契约依据；本机安装版本只用于兼容性复现。
- `progressCard.changed` 只表示需要重新读取，不能直接当作完整卡片；官方返回 `card: null` 才能确认当前卡片已清空。
- `update_plan` 与 `progress_card` transcript 项都是普通工具活动，不是当前进度状态，也不提供客户端重建终态计划的依据。
- OpenClaw 配置存在时仍要求 `config.get.hash` 作为 `baseHash`；恢复默认只删除 `tools.updatePlan`，不写入无关字段。
- DWS 标准错误流只代表输出来源，不代表业务失败；终态和恢复判断继续服从进程结果与官方结构化核验。
- Token 记录与费用估算是不同事实。价格缺失时显示真实 Token，不补造费用；部分估价时明确只展示已知费用。
- UI 复用 `ChatMarkdownRenderer`、`StatusIcon` 和现有 `aegis-bg`、`aegis-card`、`aegis-border`、`aegis-text`、`aegis-primary`、状态色等主题 token，没有新增平行配色或独立 Markdown 安全边界。

## 核心文件

- `docs/quality/tag-release-validation-2026-08-20-v3.2.1.md`
- `docs/quality/tag-release-validation-2026-08-20.md`
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `src/progress-card/domain.ts`
- `src/progress-card/settings.ts`
- `src/services/gateway/OpenClawProgressCardClient.ts`
- `src/services/gateway/progressCardEventBridge.ts`
- `src/stores/progressCardStore.ts`
- `src/stores/progressCardRefreshGate.ts`
- `src/hooks/useOpenClawProgressCard.ts`
- `src/components/Chat/ProgressCard.tsx`
- `src/pages/ChatView.tsx`
- `src/dynamic-island/DynamicIslandRuntime.tsx`
- `src/services/gateway/OpenClawPlanToolSettings.ts`
- `src-tauri/src/commands/dws_operation.rs`
- `src/services/voice/NativeVoiceWakeRouting.ts`
- `src/pages/Dashboard/dashboardData.ts`
- `src/pages/Dashboard/index.tsx`
- `src/pages/SessionViewPage.tsx`
- `docs/quality/runtime-contract-convergence-audit-2026-08-20.md`

## 测试与验证

- `pnpm check:versions` 通过：四处版本均为 `3.2.1`。
- `pnpm lint` 通过：模块边界扫描 932 个生产文件，TypeScript 类型检查无错误。
- `pnpm test` 通过：源码测试 2868 项、脚本测试 238 项，无失败。
- `pnpm build` 通过：协作与钉钉插件包重新生成并校验，Vite 转换 9310 个模块。
- `cargo fmt --all -- --check`、`cargo clippy --all-targets`、`cargo check --all-targets`、`cargo test --lib --no-fail-fast` 通过：Rust 653 项通过，1 项按设计忽略；`clippy` 只有既有非阻断警告。
- `pnpm verify:openclaw-docs`、`pnpm collab:test`、`pnpm collab:validate`、`pnpm dingtalk:test` 和 `pnpm dingtalk:validate` 通过；协作插件 355 项、钉钉插件 21 项测试无失败。
- `pnpm check:versions` 通过：四处版本均为 `3.2.0`。
- 本轮定向 TypeScript 行为测试 43 项通过。
- `pnpm lint` 通过：模块边界扫描 932 个生产文件、四处版本一致、TypeScript 类型检查无错误。
- `pnpm test` 通过：源码测试 2868 项、脚本测试 238 项，无失败。
- `pnpm build` 通过：协作与钉钉插件包重新生成并校验，Vite 转换 9310 个模块。
- `cargo fmt --all -- --check`、`cargo clippy --all-targets`、`cargo check --all-targets`、`cargo test --lib --no-fail-fast` 通过：Rust 653 项通过，1 项会修改当前用户 macOS Keychain 的既有测试按设计忽略；`clippy` 只有既有非阻断警告。
- `pnpm verify:openclaw-docs` 通过。
- `pnpm collab:test` 与 `pnpm collab:validate` 通过：协作插件 355 项测试无失败，包契约有效。
- `pnpm dingtalk:test` 与 `pnpm dingtalk:validate` 通过：钉钉插件 21 项测试无失败，包契约有效。
- `git diff --check`、修改后完整文件 Emoji 扫描和暂存新增内容敏感信息扫描通过。
- 远端同提交 `CI` 工作流 32318391003 通过。
- `Tagged Desktop Release` 工作流 32318656779 通过：发布源校验、macOS ARM64、macOS x64 和 Windows x64 构建全部成功。
- GitHub Release `v3.2.0` 已核验为正式发布，共 11 个附件；远端标签解引用后指向 `4893905a22aa62f5faa54a2293191c3f27c83bf5`。

## 已知问题与未验证边界

- `v3.2.1` 尚未推送，远端同提交 CI、标签工作流、GitHub Release 和制品摘要尚未产生。
- 尚未在真实 OpenClaw 运行中任务上验收进度卡的实时修订、清空、重连恢复、长内容滚动和动态岛同步。
- 进度卡尚未完成亮色、暗色、窄窗口、键盘焦点及系统减少动态效果的连续真机视觉验收。
- Windows x64 真机 SAPI、全局会话路由和 Talk 接力尚未验证；当前 macOS 自动化不能替代目标平台结果。
- DWS 最后一批输出顺序尚未在真实授权、安装和多 Profile 操作中连续实测。
- 费用提示尚未用真实混合定价、多模型和跨日数据完成人工视觉验收。
- 会话回放安全回归证明原始 HTML 被转义，但尚未对长 Markdown、亮暗主题和窄窗口做真机视觉验收。
- 标签工作流已生成 macOS ARM64、macOS x64 和 Windows x64 安装制品，但尚未在目标设备完成安装、升级和运行验证；Linux 不在当前发布工作流的制品范围内。
- macOS 制品不代表 Developer ID 签名或公证已经完成；Windows 制品使用内部测试证书，不具备公共证书颁发机构信任。
- pnpm 9.15.9 在执行时仍输出根 `pnpm.overrides` 已忽略的警告，但当前锁文件顶部 overrides 与已解析依赖仍保留项目要求的安全版本。本轮未把该警告扩展为依赖布局迁移。

## 失败方案

- 直接使用 Node 测试入口时缺少仓库统一 WebView 环境，`i18n` 在读取 `localStorage` 时失败。改用 `test-setup.ts` 后定向测试通过；失败与业务修复无关。
- 初版会话回放安全断言错误地禁止转义文本中出现 `onerror` 字样。实际安全边界是不得生成真实 `script` 或 `img` 标签，测试已改为验证标签被 HTML 转义。
- 尝试通过 Corepack 固定 pnpm 版本时发现当前环境未安装 Corepack；随后核实系统 `pnpm` 为项目锁定的 9.15.9，并用该版本更新锁文件。

## 下一步顺序

1. 完成本地发布验证并提交、推送 `3.2.1` 版本变更到远端 `main`。
2. 等待同提交 `CI` 成功，创建并推送带注释标签 `v3.2.1`。
3. 跟踪 `Tagged Desktop Release` 到终态，核验 Release 标签、提交、制品名称、数量和更新清单。
4. 将线上结果回写本文件和发布验证记录后再次提交并推送。
5. 后续在目标设备补齐安装、签名信任、OpenClaw 运行、DWS 全流程和 UI 真机验收。
