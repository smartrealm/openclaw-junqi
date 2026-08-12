# OpenClaw 渠道绑定加固计划

## 执行顺序

### 阶段 A：协议与身份

| 缺陷 | 文件 | 修复 |
| --- | --- | --- |
| BUG-CHB-01 | `src/services/openclawWizard.ts`、`src/pages/ChannelsCenter/` | 增加隔离的 channels Wizard 客户端与对话框，消费官方终态。 |
| BUG-CHB-02 | `src/services/openclawChannelRuntime.ts`、`src/pages/ChannelsCenter/index.tsx` | 增加唯一 provider 身份判据，删除未围栏的二维码入口。 |

### 阶段 B：状态与账号能力

| 缺陷 | 文件 | 修复 |
| --- | --- | --- |
| BUG-CHB-03 | `src/services/channelConfig.ts`、渠道详情组件 | 收紧 ready 判定并分别展示显式连接失败。 |
| BUG-CHB-04 | `src/services/openclawChannelRuntime.ts` | 归一化全部 capability 行并按账号选择。 |

### 阶段 C：配置和交互

| 缺陷 | 文件 | 修复 |
| --- | --- | --- |
| BUG-CHB-05 | `src/pages/ConfigManager/`、`src/pages/ChannelsCenter/ChannelAccountDialog.tsx` | 完整投影 uiHints、联合 primitive 与草稿有效性。 |
| BUG-CHB-06 | 渠道二维码与 Wizard 授权组件 | 增加身份、失败反馈和字符二维码折叠。 |

### 阶段 D：验证与文档

1. 为每个缺陷增加行为或渲染回归测试。
2. 更新渠道支持文档、流程预览和项目状态。
3. 运行定向测试、`pnpm lint`、完整测试、构建与 `git diff --check`。

## 实施约束

- 不按 OpenClaw 版本号启用能力。
- 不新增 OpenClaw 未定义的 RPC、字段或成功状态。
- 不让 channels Wizard 与首次 setup Wizard 共享 sessionId。
- 不在错误时静默切换 Native 与 Docker Runtime。
- 不覆盖当前工作树中的 Wizard 终态未知加固。
