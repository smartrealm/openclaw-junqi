# OpenClaw Wizard 版本协商实施计划

日期：2026-08-14

## 实施顺序

### 阶段 A · 修复启动阻断

| 编号 | 文件 | 修改 |
| --- | --- | --- |
| WIZ-COMPAT-01 | `src/services/openclawWizard.ts` | 提取精确 schema 拒绝判据，并在 setup start 内进行一次无副作用参数协商 |
| WIZ-COMPAT-01 | `src/services/openclawWizard.test.ts` | 覆盖主线一次成功、stable 一次协商和其他错误禁止重试 |

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

### 阶段 D · 验证

1. 运行 Wizard 客户端、首次设置和页面定向测试。
2. 运行 TypeScript 类型检查和模块边界检查。
3. 运行完整前端测试与生产构建。
4. 运行 `git diff --check`、多语言 JSON 解析和修改文件 Emoji 扫描。
5. 记录 stable 真实 Gateway 启动与取消结果；不在用户配置上完成带写入副作用的整套 Wizard。
