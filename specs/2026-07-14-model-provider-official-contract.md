# 模型供应商官方契约修复规格

## BUG-MP-01 · 官方认证编排

**Current**：OAuth 只改变表单 mode，不产生 OpenClaw 可用凭据。

**Target**：后端统一执行 `openclaw models auth login` / API-key 官方写入流程，返回结构化结果并刷新 auth profile 列表。

**Acceptance**：
- [x] OAuth 成功后 `models auth list --json` 可见档案。
- [x] 取消或失败时不写伪档案。
- [x] Windows/macOS 均使用同一命令抽象，不硬编码 shell 字符串。

## BUG-MP-02 · 官方 schema 写盘门禁

**Current**：仅浅层 JSON shape 检查。

**Target**：候选配置在隔离临时路径通过当前 OpenClaw `config validate --json` 后才能原子写盘。

**Acceptance**：
- [x] 无效 adapter、模型必填字段和未知字段被拒绝。
- [x] 正式配置在验证失败时字节不变。
- [x] 错误包含精确配置路径并可在 UI 展示。

## BUG-MP-03 · 官方连接探测

**Current**：WebView 直接 fetch 上游接口。

**Target**：通过 OpenClaw probe 取得 provider/profile/model 的结构化状态。

**Acceptance**：
- [x] 支持 API Key、OAuth、SecretRef 和本地供应商。
- [x] 展示 auth/rate_limit/billing/timeout/format/no_model 等官方状态。
- [x] 探测不污染正式配置，临时文件始终清理。

## BUG-MP-04/05 · 动态官方目录

**Current**：generated catalog 是手写模板的复制品且型号过期。

**Target**：目录由当前 OpenClaw CLI/package 生成或运行时读取，静态表仅作离线兜底并带来源版本。

**Acceptance**：
- [x] OpenClaw 升级后可刷新目录，无需修改 React 代码。
- [x] UI 显示目录来源和 OpenClaw 版本。
- [x] 2026.7.1 基线包含 GPT-5.6、Claude Sonnet 5、Grok 4.3。

## BUG-MP-06 · Schema 驱动高级表单

**Current**：provider 仅 Base URL/API，model 仅 alias/image。

**Target**：从官方 schema 派生字段元数据，按连接、容量、请求、运行时、本地服务、模型能力分组渲染。

**Acceptance**：
- [x] 官方 provider/model 字段均可查看，常用字段可视化编辑。
- [x] 数字范围、枚举、必填和嵌套结构提交前校验。
- [x] 不认识的未来字段读写无损。

## BUG-MP-07 · SecretRef 来源选择

**Current**：新密钥主要进入配置内 `env.vars`。

**Target**：支持 env/file/exec SecretRef 与外部环境变量，UI 不读取或回显真实密钥。

**Acceptance**：
- [x] 可创建三种官方 SecretRef。
- [x] SecretRef 解析失败有明确状态，不降级成明文。
- [x] 删除供应商不会误删其他引用者共享的 secret source。

## BUG-MP-08 · 目录模式、通配符与认证顺序

**Current**：缺少 `models.mode`、`provider/*`、`auth.order` 管理。

**Target**：提供专用控件与 mutation，保持官方字段语义。

**Acceptance**：
- [x] merge/replace 可视化且有影响说明。
- [x] `provider/*` 只写入 `agents.defaults.models`。
- [x] 多认证档案可排序，保存为 `auth.order.<provider>`。

## 验证记录

- 前端与脚本测试：全部通过。
- Rust 单元测试：288 项通过，2 项按预期忽略。
- 生产构建、`cargo fmt --check`、`git diff --check`：通过。
- OpenClaw 2026.7.1 实测：完整候选配置通过官方校验；无效 adapter 和缺少模型名称均返回精确字段路径。
- 1440px 与 760px 视口完成界面截图检查，无内容重叠或横向溢出。
