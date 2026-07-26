# OpenClaw 渠道 Runtime 权威源修复计划

## 执行顺序

### Phase A — 删除会写入错误配置的静态定义

| Bug | 文件 | 修复 |
|---|---|---|
| CRA-01 | `channelTemplates.ts`, `channelConfig.ts`, Channels UI | 删除模板、默认值和静态凭据判断，改用 capability/status |
| CRA-02 | Setup、channel enrollment 前后端 | 删除飞书专项协议，保留通用 QR renderer |

### Phase B — 删除跨功能静态渠道集合

| Bug | 文件 | 修复 |
|---|---|---|
| CRA-03 | Calendar types/modal/store | Runtime 动态加载投递渠道，默认 `last` |
| CRA-04 | AgentSettingsPanel | 删除固定快捷创建，跳转动态渠道中心 |
| CRA-06 | Native pairing module/handler | 删除无调用的渠道专属文件配对死链 |

### Phase C — 展示来源统一

| Bug | 文件 | 修复 |
|---|---|---|
| CRA-05 | Channels Center、Config Manager、Agent Hub | Runtime label/catalog 或原始 ID |

### Phase D — 回归和全仓禁止规则

1. 添加动态 catalog/capability/status 单元测试。
2. 添加源代码契约测试：钉钉例外目录外不得出现渠道 ID 逻辑。
3. 运行 TypeScript、前端测试、Rust 测试、lint、边界检查和 `git diff --check`。
4. 再次对 `src/`、`src-tauri/src/`、`scripts/` 全量扫描具体渠道名称。
