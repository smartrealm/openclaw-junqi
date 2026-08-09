# Gateway 原生能力与扩展一致性验证

日期：2026-08-09

## 结果

本轮已关闭审计中的直接协议错误和已确认的架构循环：边界扫描器与测试共用同一实现，生产扫描从
130 个违规收敛为零；二维码登录、Chat 增量、Wizard、会话模型权限和 Gateway 事件分派均回到
最新版 OpenClaw 官方契约。启动 token 广播、旧配置解析链、写死供应商 OAuth 和无消费者的供应商
密钥命令已删除。

本轮没有声称全量关闭审计。Agent stream 的剩余严格解码、全部 Tauri command 消费者矩阵、源码文本
契约测试迁移，以及最新版真实 Gateway 和三平台真机验收仍未完成。

## 已验证实现

### 模块边界与组合根

- `scripts/check-boundaries.mjs` 统一解析别名、相对路径、静态导入、类型导入、动态导入和再导出。
- `scripts/check-boundaries.test.mjs` 直接调用生产扫描器，不再复制算法。
- `Connection` 不再导入 Gateway 数据 store；`App` 组合根根据连接状态启停轮询。
- `chatStore` 只依赖窄化的会话和发送操作端口，不再导入包含事件运行时的 Gateway 总 facade。
- Chat 发送协调器保持纯服务；应用级单例移到 `runtime/chatSendCoordinator.ts`。
- 组件、纯投影、运行时副作用、状态和值类型分别迁入 `components`、`processing`、`runtime`、`stores`
  和 `types` 边界。生产扫描检查 920 个文件，结果为零违规。

### OpenClaw 协议

- `web.login.start` 与 `web.login.wait` 只通过管理员连接调用，渠道状态读取继续使用普通连接。
- Chat 增量按官方 `deltaText`、累计快照和 `replace` 语义合并；启动状态只接受四个官方 phase。
- Wizard 会话丢失后只重新调用官方 `wizard.start`。本地配置、超时、标题和消息文本都不能合成
  `done`、完成按钮或非阻断失败。
- 会话 `model` 单字段 patch 使用普通写连接；其他运行参数继续使用管理员连接。
- Gateway 数据投影已删除非官方顶层 session、agent 和本地 task 事件分支。

### 凭据与 Tauri 暴露面

- `gateway-config` WebView 事件及其 token 载荷已删除。
- `configResolvers.ts` 及专属测试已删除，连接目标继续由当前运行时身份和凭据提供器解析。
- 删除无消费者且写死第三方 OAuth 配置的 `provider_oauth.rs`。
- 删除供应商密钥的通用 WebView 命令和直接读取配置文件明文 API Key 的 command。
- `secret_store.rs` 只保留 Gateway 设备凭据实际使用的系统凭据库适配，不提供通用 WebView 密钥接口。

## 自动化证据

本轮实际执行并通过：

- `pnpm lint`：边界、版本一致性和 TypeScript 检查通过；
- `pnpm test`：前端 2849 项、脚本 234 项通过；
- `cargo fmt -- --check`、`cargo check --lib`；
- `cargo test --lib`：687 项通过、2 项明确忽略；
- `pnpm build`：协作与钉钉资源打包、TypeScript 和 Vite 生产构建通过；
- `pnpm collab:test && pnpm collab:validate`：368 项和插件包契约通过；
- `pnpm dingtalk:test && pnpm dingtalk:validate`：12 项和插件包契约通过；
- `pnpm verify:openclaw-docs`：官方命令文档链接验证通过；
- `git diff --check` 与全部修改后文件的 Unicode Emoji 扫描通过。

测试输出仍包含既有 Node loader 弃用提示和 Radix 服务端渲染提示，不影响退出结果。

## 未验证边界

- 尚未在官方提交 `7a8eee4a363b6fd097a40d221aedcff14e61cc8c` 对应的真实 Gateway 回放二维码、
  Chat、Wizard、协作插件和钉钉插件。
- 尚未完成 macOS、Windows、Linux 的凭据库、WebView、窗口和真实 UI 验收。
- 尚未生成全部 Tauri command 的 WebView、Rust 内部、插件与测试消费者矩阵。
- `src/api/tauriCommandsContract.test.ts` 等历史源码文本守护尚未全部迁移为可执行契约。
- Chat 事件已有严格纯解析入口；Agent stream 仍需按官方判别联合完成剩余严格解码。
- 未执行 Tauri 安装包构建、正式签名、公证或 Release 发布。
