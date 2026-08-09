# OpenClaw Runtime 配置 Schema 信封修复规格

日期：2026-08-09

## 问题

JunQi 将官方 `config.schema` 响应信封当成 JSON schema 根节点，导致配置中心多个结构化编辑器错误进入不可用状态，
并且成功缓存没有绑定 Gateway 连接身份。

## 约束

- 以 OpenClaw 官方 `ConfigSchemaResponse` 和 `config.schema` handler 为唯一协议依据。
- 不接受裸 schema、别名字段、版本分支或本地 fallback。
- 不以 `hello-ok.features.methods` 是否列出方法作为可用性判断。
- 不覆盖 `ProvidersTab.tsx` 中现有的用户未提交改动。

## 验收条件

1. 加载器只返回官方响应中的 `schema`，并校验 `uiHints`、`version` 和 `generatedAt` 的必需结构。
2. 同一 Gateway 连接可复用并发或后续读取；连接 ID 变化后必须重新请求。
3. 请求返回期间连接变化时，结果失败关闭，不得缓存或呈现旧 Runtime schema。
4. 强制重试绕过当前连接的成功缓存；失败结果不得长期缓存。
5. 工具页区分“schema 请求失败”和“schema 已加载但没有工具配置字段”，请求失败提供可访问的重试按钮。
6. 工具页不再声称存在未经当前产品入口证明的原始编辑器或通用 Wizard 修复路径。
7. 工具目录、有效工具和工具调用面板在工具配置字段不可编辑时仍保持可用并呈现真实 RPC 状态。
8. 回归测试至少覆盖官方信封解析、非法响应、同连接缓存、连接切换、迟到响应围栏和强制重试。
9. TypeScript 检查、相关测试、生产构建、`git diff --check` 和修改文件 Emoji 扫描通过。

## 真机验收

在亮色、暗色和窄窗口下验证加载、失败、空字段、重试、键盘焦点和 Gateway 重连后的工具页状态。该项必须与自动化
验证分开记录。
