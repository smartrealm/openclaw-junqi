# OpenClaw Wizard 版本协商实施计划

日期：2026-08-14

验证更新：2026-09-11

## 实施顺序

### 阶段 A · 修复启动阻断

| 编号 | 文件 | 修改 |
| --- | --- | --- |
| WIZ-COMPAT-01 | `src/services/openclawWizard.ts` | 提取精确 schema 拒绝判据，并在 setup start 内进行一次无副作用参数协商 |
| WIZ-COMPAT-01 | `src/services/openclawWizard.test.ts` | 覆盖主线一次成功、stable 一次协商和其他错误禁止重试 |
| WIZ-COMPAT-04 | `src/pages/SetupPage/OpenClawUpdateScreen.tsx` | 配置准备失败时在更新页显示共享错误状态并保留重新核验入口 |
| WIZ-COMPAT-04 | `src/pages/SetupPage/OpenClawUpdateScreen.test.tsx` | 覆盖失败详情的就地呈现 |

### 阶段 B · 删除失效状态

| 编号 | 文件 | 修改 |
| --- | --- | --- |
| WIZ-COMPAT-02 | `src/hooks/useSetupFlow/useWizardSession.ts` | 删除永久协议不兼容分类和错误文案 |
| WIZ-COMPAT-02 | `src/hooks/useSetupFlow/types.ts`、首次设置 UI | 删除无消费者恢复模式和专属交互 |
| WIZ-COMPAT-02 | 相关测试 | 将阻断断言改为客户端内部协商契约 |

### 阶段 C · 同步事实文档

| 编号 | 文件 | 修改 |
| --- | --- | --- |
| WIZ-COMPAT-03 | 安装文档、规格、预览、项目状态 | 区分主线显式关闭和 stable 官方 daemon 步骤 |

### 阶段 D · 打通恢复更新门禁

| 编号 | 文件 | 修改 |
| --- | --- | --- |
| WIZ-COMPAT-05 | `src/services/openclawUpdateLifecycle.ts` | 维护检查前经统一生命周期恢复当前所选 Runtime 的已核验连接 |
| WIZ-COMPAT-05 | `src/services/collaboration/client.ts` | 为维护门禁提供只读取稳定身份字段的窄能力投影，避免被旧插件的非维护字段差异阻断 |
| WIZ-COMPAT-05 | `src-tauri/src/commands/collaboration_bootstrap.rs`、`src/services/collaboration/CollaborationAbsenceAttestation.ts` | 为旧 Gateway 上已安装但未加载的协作插件建立绑定运行时身份和本地权威探针的短期恢复证明；宿主版本不兼容只由已核验安装目录中的正式 `pluginApi` 范围与当前 Gateway 版本判定 |
| WIZ-COMPAT-05 | `src/services/collaboration/MaintenanceCoordinator.ts` | 仅为精确的协作服务启动、Schema 故障或权威的插件待修复证明提供 OpenClaw 恢复更新例外，并在写入前重读 |
| WIZ-COMPAT-05 | 对应服务与 Rust 测试 | 覆盖重连、正常复用、精确故障放行、插件待修复证明、宿主版本不兼容证明、其他动作阻断和写入前状态变化 |

### 阶段 E · 解耦可选更新与继续配置

| 编号 | 文件 | 修改 |
| --- | --- | --- |
| WIZ-COMPAT-06 | `src/hooks/openclawUpdateState.ts` | 保留已经验证的渠道检查结果，不让后续更新执行错误抹除继续配置资格 |
| WIZ-COMPAT-06 | `src/components/shared/OpenClawUpdatePanel.tsx` | 向首次设置页发布独立于更新执行结果的结构化检查投影 |
| WIZ-COMPAT-06 | `src/pages/SetupPage/OpenClawUpdateScreen.tsx` | 更新可用时将主操作明确标为“跳过更新并继续” |
| WIZ-COMPAT-06 | 对应状态与页面测试 | 覆盖更新执行失败后的继续资格和无检查证据时的失败关闭 |

### 阶段 F · 验证

1. 运行 Wizard 客户端、首次设置和页面定向测试。
2. 运行 TypeScript 类型检查和模块边界检查。
3. 运行完整前端测试与生产构建。
4. 运行 `git diff --check`、多语言 JSON 解析和修改文件 Emoji 扫描。
5. 记录 stable 真实 Gateway 启动、更新维护门禁与取消结果；不在用户配置上完成未经用户确认的配置写入。

### 阶段 G · 接管已有 Classic Runtime

| 编号 | 文件 | 修改 |
| --- | --- | --- |
| WIZ-COMPAT-07 | `src/services/gateway/OpenClawConfigApplicationClient.ts` | 从正式 `config.get` 信封投影磁盘配置 `hash`，不改变活动修订字段语义 |
| WIZ-COMPAT-07 | `src/services/setup/classicOpenClawModelVerification.ts` | 使用唯一临时 Session 执行官方 `agent` 与 `agent.wait`，忽略正文并强制清理 |
| WIZ-COMPAT-07 | `src/services/setup/openClawSetupHandoff.ts` | 为无写入的已有 Classic Runtime 增加稳定连接、稳定配置快照和真实模型门禁；保留所有写后活动修订门禁 |
| WIZ-COMPAT-07 | `src/hooks/useSetupFlow/index.ts` | 检测到已有 Classic Runtime 时复用接管门禁，不自动重启官方 Wizard |
| WIZ-COMPAT-07 | 对应服务测试 | 覆盖成功、连接漂移、配置持续漂移、模型失败、清理失败和默认 Web Crypto 调用 |

真机验收顺序：选择现有数据位置，保持 JunQi 独立安装关闭，跳过可选更新，核验现有配置与真实模型，进入 Ready 后再进入仪表盘。整个路径不得触发 OpenClaw 安装、更新或配置写入。

### 阶段 H · 统一更新与维护探针的原生运行时

| 编号 | 文件 | 修改 |
| --- | --- | --- |
| WIZ-COMPAT-08 | `src-tauri/src/commands/openclaw_cli.rs` | 固定原生 CLI 目标携带已核验 `NativeOpenclawRuntime`，命令通过同一 Node.js 与 JavaScript 入口执行 |
| WIZ-COMPAT-08 | `src-tauri/src/commands/collaboration_bootstrap/target.rs` | 协作变更目标在固定二进制前解析并核验兼容原生运行时 |
| WIZ-COMPAT-08 | `src-tauri/src/commands/collaboration_bootstrap.rs` | 持久恢复目标重新核验同一原生启动契约，测试覆盖宿主兼容性与启动器选择 |

验证顺序：先运行固定原生启动器和插件宿主兼容性两项 Rust 回归，再执行 Rust 格式、检查与完整库测试；随后在真实 Tauri 流程中确认官方更新成功、Gateway 报告目标版本，并继续完成钉钉插件安装与工具投影核验。
