# 首次设置前置门禁实施计划

## 顺序

1. BUG-01：新增独立 `update-openclaw` 页面状态；已有 Native 安装从运行时配置页进入该状态，检查完成后才进入官方配置，本次新安装跳过该状态。
2. BUG-02：增加结构化 Wizard 参数拒绝分类；命中时停留在 OpenClaw 配置页，删除同一无效请求的恢复入口，并在已核验 Guided 可用时提供直接返回操作。
3. BUG-03：删除初始状态中的递归容量统计及其专属字段，保留迁移校验统计。
4. BUG-04：把“需要更新”改为“Classic Wizard 参数不兼容”，核对当前 stable 正式 Guided 方法，彻底删除协议错误到更新页的错误耦合。
5. BUG-05：保留 npm `latest` 的官方 stable 安装契约，在更新状态、Rust 更新 command 和首次设置继续操作三个边界实施生产渠道门禁；拒绝 beta、dev 与未知渠道，不自动切换。
6. BUG-06：按结构化 unknown-method 协商 `openclaw.setup.*` 与 `crestodian.setup.*`，绑定后续方法族，并用 stable activate 的真实模型调用结果完成交接。
7. 更新首次启动流程预览与当前验证记录。
8. 运行定向前端测试、Rust 测试、lint、完整测试、构建、Emoji 扫描和差异检查。

## 文件范围

- `src/components/shared/OpenClawUpdatePanel.tsx`
- `src/pages/SetupPage/ProgressScreen.tsx`
- `src/pages/SetupPage/OpenClawUpdateScreen.tsx`
- `src/pages/SetupPage/GatewayStartingScreen.tsx`
- `src/types/setupNavigation.ts`
- `src/stores/setup-navigation.ts`
- `src/services/setup/onboardingPresentation.ts`
- `src/services/openclawWizard.ts`
- `src/services/gateway/OpenClawGuidedSetupClient.ts`
- `src/services/setup/openClawSetupHandoff.ts`
- `src/hooks/useSetupFlow/useWizardSession.ts`
- `src-tauri/src/commands/storage.rs`
- `src-tauri/src/commands/openclaw_update.rs`
- 对应测试、国际化、流程文档与 `PROJECT_STATUS.md`
