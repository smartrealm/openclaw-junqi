# 业务引导平台实施计划

## 实施顺序

1. 审计会话、模型、Channels、Agent、协作和工作台的现有成功回执、导航入口、持久化边界与翻译目录；建立事实来源矩阵。
2. 创建 `src/business-guide/domain/`：声明式任务类型、模块注册表、任务投影和版本迁移测试。领域层不导入 React、页面、services 或 stores。
3. 创建事实适配器：将当前连接身份、Gateway 投影和业务写入确认转换为领域事实；每个适配器按现有业务边界放置，不能跨越组件/服务/store 约束。
4. 创建只保存非敏感展示偏好的 `BusinessGuideStore` 与持久化 adapter；先定义版本、迁移、跳过、恢复和 runtime identity 失效规则。
5. 实现总览欢迎面板和可收起任务区，接入现有布局；增加键盘导航、焦点管理、窄窗口和空/受阻状态。
6. 按模块逐个接入页面内引导，先完成会话、模型、Channels，再接入 Agent、追溯、协作和工作台。每次只由已有业务事件触发重新投影。
7. 在会话模块实施前审计排序能力。若无持久化排序契约，先在会话领域独立实现、测试和文档化该能力，再接入引导。
8. 补齐三种语言，执行定向测试、`pnpm lint`、`pnpm test`、`pnpm build`、`git diff --check`；按 Native、Docker、Windows、macOS 和真实渠道分别记录人工验收。

## 文件边界

- 领域与注册表：`src/business-guide/domain/`。
- 事实适配器与协调器：`src/business-guide/adapters/`、`src/business-guide/BusinessGuideCoordinator.ts`。
- 展示状态：`src/stores/businessGuideStore.ts`。
- UI：`src/components/BusinessGuide/`，不直接调用 Gateway services。
- 页面接入：会话、Provider、Channels、Agent、协作、工作台页面只接收领域事件和导航提示。
- 文档和翻译：`docs/design/`、`specs/quality/`、`plans/quality/`、`src/locales/`。

## 验证边界

- 自动化不能证明真实渠道授权、二维码、运行时切换或远程 Gateway 的引导结果。
- 不得把开发机已有模型、渠道账号、会话、排序偏好或凭据作为任何新用户默认条件。

## 2026-08-02 修复顺序

1. 修复引导已查看状态的持久化和重新打开语义。
2. 将总览面板限制为总览路由，保留独立弹窗层。
3. 提取只读渠道状态适配器，并用现有账号就绪判定投影渠道任务。
