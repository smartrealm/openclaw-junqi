# 首次启动往返导航修复计划

日期：2026-08-08

状态：已完成。实现与验证结果见[首次启动往返导航修复验证](../../docs/installation/setup-round-trip-navigation-validation-2026-08-08.md)。

## 实施顺序

1. 将 `SetupStepTransition` 从退出与进入并存改为仅当前步骤入场，删除退出页交互辅助实现；前进从左向右收敛，返回从右向左收敛。
2. 在 `useSetupEnvironmentReview` 中同步维护环境动作引用和可渲染状态，向 `SetupFlow` 暴露统一忙碌语义。
3. 让环境页的上一步、重新检测和下一步按钮统一使用该忙碌语义。
4. 调整完整往返行为测试，覆盖动作开始、步骤离开、返回和再次前进。
5. 更新首次启动流程、动效设计记录和项目状态。

## 文件范围

- `src/motion/setupStepTransition.tsx`
- `src/motion/setupStepTransition.test.ts`
- `src/hooks/useSetupFlow/environmentReviewAction.ts`
- `src/hooks/useSetupFlow/environmentReviewAction.test.ts`
- `src/hooks/useSetupFlow/useSetupEnvironmentReview.ts`
- `src/hooks/useSetupFlow/index.ts`
- `src/hooks/useSetupFlow/types.ts`
- `src/pages/SetupPage/EnvironmentReviewScreen.tsx`
- `src/pages/SetupPage/EnvironmentReviewScreen.test.ts`
- `src/stores/setup-navigation.test.ts`
- `docs/installation/`
- `docs/previews/junqi-first-run-flow.html`
- `PROJECT_STATUS.md`

## 验证顺序

1. 运行环境动作、导航和动效定向测试。
2. 运行 TypeScript 与边界检查。
3. 运行前端和脚本完整测试。
4. 运行生产构建。
5. 执行 `git diff --check` 和修改文件完整 Emoji 扫描。
6. 记录亮色、暗色、键盘、窄窗口和真实安装包中尚未完成的视觉验收。

## 执行结果

- 步骤生命周期、操作门禁和完整往返回归均按计划完成。
- 定向测试、完整测试、静态检查和生产构建通过。
- macOS arm64 验收包已构建、校验、安装并获得正常使用反馈。
- 跨平台、减少动态效果和专项视觉边界继续保留为未验证，不纳入本计划的完成声明。
