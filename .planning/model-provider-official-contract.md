# 模型供应商官方契约修复计划

## 执行顺序

### Phase A — 官方适配内核

| Bug | 位置 | 修复 |
| --- | --- | --- |
| MP-02 | `src-tauri/src/commands/config.rs` | 增加候选配置官方 schema 验证门禁 |
| MP-03 | 新增 provider runtime command/service | 用官方 probe 替换 WebView 直连 |
| MP-01 | provider auth command + UI | 接入官方插件认证流程 |

### Phase B — 动态目录

| Bug | 位置 | 修复 |
| --- | --- | --- |
| MP-04 | provider catalog service/UI | 运行时读取官方目录并缓存 |
| MP-05 | catalog generator | 绑定明确 OpenClaw 源与版本，禁止静默自复制 |

### Phase C — 完整可视化

| Bug | 位置 | 修复 |
| --- | --- | --- |
| MP-06 | provider/model editors | schema 驱动高级字段分组表单 |
| MP-07 | credential editor | SecretRef 来源选择与无回显状态 |
| MP-08 | provider policy controls | mode、wildcard、auth order 专用 mutation |

### Phase D — 验证

1. 每个 BUG 至少一个会在旧实现失败的回归测试。
2. 使用 OpenClaw 2026.7.1 schema 跑合法/非法配置契约测试。
3. 前端单测、TypeScript、lint、生产构建、Rust fmt/clippy/test。
4. macOS 与 Windows CI 均验证命令定位、临时文件和无 shell 拼接。
5. 视觉验证新增/编辑/API Key/OAuth/本地模型/SecretRef 六条流程。
