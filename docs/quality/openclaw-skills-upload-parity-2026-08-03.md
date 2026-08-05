# OpenClaw 技能归档上传能力对齐

日期：2026-08-03

## 依据

本次能力以 OpenClaw 官方文档、公开 schema 和 handler 源码为契约。本机安装的 OpenClaw
源码只用于复现请求和响应，不作为 JunQi 的版本开关、能力判断或兼容条件。

- [`gateway/protocol.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
  定义 `skills.upload.begin`、`skills.upload.chunk`、`skills.upload.commit` 与
  `skills.install(source: "upload")` 的方法、参数和 `operator.admin` 权限。
- [`tools/skills.md`](https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md)
  说明归档上传是关闭状态下的私有技能安装路径，需要 Gateway 配置
  `skills.install.allowUploadedArchives: true`。
- [`agents-models-skills.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
  定义上传 begin/chunk/commit 和 install upload 分支的字段。
- [`skills-upload.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/gateway/server-methods/skills-upload.ts)、
  [`upload-store.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/skills/lifecycle/upload-store.ts)
  和 [`upload-install.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/skills/lifecycle/upload-install.ts)
  定义管理员上传、临时归档、偏移、SHA-256、TTL、大小和安装回执行为。

官方 handler 当前约束归档不超过 256 MiB，单个解码块不超过 4 MiB，上传由 Gateway 临时目录
管理并在 TTL 到期后清理。JunQi 选择 3 MiB 客户端块，保持在官方上限内；这只是客户端传输
策略，不改变 OpenClaw 的协议限制。

## 原问题

JunQi 已经通过 `skills.status`、`skills.search`、`skills.detail` 和 ClawHub 形式的
`skills.install` 管理 Gateway 技能，但技能页没有官方归档上传入口。旧的本地 ZIP 导入
语义不能直接写入当前 Gateway workspace，也不能据此声称远端安装成功。

## 当前行为

- `src/services/openclawSkillsRuntime.ts` 提供 `installArchive`，先在内存中计算 SHA-256，
  依次调用官方 begin/chunk/commit，再只在 commit 回执完整且哈希一致时调用
  `skills.install` 的 `source: "upload"` 分支。
- 上传的所有阶段均通过 `callPrivileged` 发出；slug、uploadId、大小、偏移、哈希和安装回执
  都严格校验，Gateway 返回错误或不一致时不显示成功。
- `hello-ok.features.methods` 的遗漏不决定上传入口或调用资格；上传只在用户显式提交后按官方顺序真实请求，
  Gateway 的正式错误决定是否可用，不把发现信息当成支持结论。
- `src/pages/SkillsPage/SkillArchiveUploadPanel.tsx` 使用桌面 Tauri WebView 的文件选择器
  读取 ZIP 字节，显示阶段进度、slug、显式替换选项和真实错误；不发起浏览器 HTTP 请求，
  不写本地技能目录，也不持久化归档内容或凭据。
- 成功后重新读取 `skills.status` 和 `skills.securityVerdicts`，已安装列表仍以 Gateway
  的原生状态为准。
- `/skill-hub` 继续表示 JunQi 本地目录和项目符号链接工具，与 Gateway 归档上传保持边界，
  不作为上传失败时的替代安装路径。

## 验证结果

- `openclawSkillsRuntime.test.ts` 覆盖多块归档、管理员调用顺序、哈希确认、异常 offset、
  非法 slug 和安装回执校验。
- 已通过定向 TypeScript 检查、技能运行时定向测试、`pnpm lint`、`pnpm test`、`pnpm build`、
  `pnpm verify:openclaw-docs` 和 `git diff --check`；完整测试结果为源代码 2380 项通过、脚本
  233 项通过，构建产物生成成功。
- 三套 locale JSON 可解析。

## 未验证边界

尚未连接真实 Gateway 执行上传，也没有在 Windows、Linux 或 macOS 真机上完成技能页手工
验收。Gateway 未开启 `skills.install.allowUploadedArchives`、旧 Gateway 不声明上传方法、
网络中断、管理员配对失败和安装策略拒绝时，JunQi 只展示原生错误，不代替用户修改配置或
伪造成功。

OpenClaw 当前没有上传取消或远端临时归档删除 RPC，JunQi 不提供对应的假动作。ZIP 内部结构、
安全扫描和安装副作用由 OpenClaw 处理，JunQi 不复制一套解析器或安全判定。
