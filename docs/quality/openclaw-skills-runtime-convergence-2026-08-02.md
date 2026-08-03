# OpenClaw 技能运行时出口收敛

## 依据

本机安装的 OpenClaw 版本只用于复现范围，不作为 JunQi 的能力开关或版本契约。
契约以 OpenClaw 官方协议、源码和 schema 为准；本次技能目录字段对齐核对了
[`gateway/protocol.md`](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)、
[`agents-models-skills.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)、
[`skills.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/gateway/server-methods/skills.ts)
与 [`clawhub-verdicts.ts`](https://raw.githubusercontent.com/openclaw/openclaw/main/src/skills/security/clawhub-verdicts.ts)：

- `skills.status`、`skills.search`、`skills.detail` 是 `operator.read` 操作；
- `skills.securityVerdicts` 是 `operator.read` 操作，只为已安装且带有 ClawHub 链接的技能生成安全判定；
- `skills.update` 与 `skills.install` 是 `operator.admin` 操作；
- `skills.upload.begin`、`skills.upload.chunk`、`skills.upload.commit` 与 `skills.install` 的 upload 分支是 `operator.admin` 操作，且归档安装受 `skills.install.allowUploadedArchives` 控制，默认关闭；
- `skills.update` 的配置模式只接受 `skillKey`、`enabled`、`apiKey` 与 `env`；
- `skills.install` 的 ClawHub 模式只接受 `source: "clawhub"`、`slug`、可选版本、强制安装与风险确认字段；
- 当前协议没有技能删除、上传取消、远端上传删除、目录导入、SkillHub CLI 安装或 ClawHub 登录 command。

## 原问题

`SkillsPage` 同时混合 Gateway RPC、浏览器 HTTP 和 `window.aegis` 兼容接口。后者在
Tauri adapter 中固定返回失败或空结果，但页面仍向用户显示导入、删除、SkillHub CLI
和 ClawHub CLI 操作。侧栏、Agent 页面、会话输入与技能页又各自解析
`skills.status` 并直接调用 `skills.update`，管理员权限与字段约束无法统一。

## 当前实现

- `src/services/openclawSkillsRuntime.ts` 是 Gateway 技能域唯一运行时出口。它校验输入、
  严格解析当前协议的 status/search/detail/securityVerdicts 返回，并让所有变更经 `callPrivileged` 发出。
  status 的名称、描述、source、disabled、eligible 与 userInvocable 缺失或类型错误时不再
  用默认值补齐；技能版本只从官方 status 的 `clawhub.installedVersion` 读取。
- `src/stores/skillsStore.ts` 复用该服务，供侧栏、Agent 页面和会话输入使用。
- `src/pages/SkillsPage/index.tsx` 缩分为已安装技能和 Gateway 目录两个视图，只提供
  OpenClaw 已声明的启停、搜索、详情和安装能力。
- `src/services/openclawSkillsRuntime.ts` 和已安装视图接入官方技能归档上传生命周期；只在
  commit 回执与本地 SHA-256 一致后调用 `skills.install(source: "upload")`，入口、边界和
  未验证项见 [技能归档上传能力对齐](openclaw-skills-upload-parity-2026-08-03.md)。
- Gateway 目录详情只展示官方 `skills.search` / `skills.detail` 返回的 score、版本、时间、
  owner、metadata、tags、channel 和 changelog。未返回的下载量、星标、安装量、README、
  版本历史、CLI 命令与外部链接不再以零值、空值或猜测 URL 填充。
- 已安装列表并行读取 `skills.securityVerdicts`。只有 verdict 的 `slug` 或
  `requestedSlug` 与 status 的 `skillKey` 精确相等时才关联；只有官方 `securityPassed` 明确为
  `true` 或 `false` 时显示图标，缺失、`null`、非 ClawHub 或匹配失败都保持未知。安全 RPC
  失败只显示非阻断提示，不把技能列表标成失败。
- `src/api/tauri-adapter.ts` 与 `src/types/global.d.ts` 删除了固定失败的 skills、
  skillshub、clawhub adapter 声明。
- `/skill-hub` 保留为 JunQi 本地目录与项目符号链接工具，不成为 Gateway 技能安装的
  伪替代品；归档上传失败时不静默切换到该本地路径。

## 验证

- `openclawSkillsRuntime.test.ts` 覆盖协议字段解析、异常条目拒绝和管理员变更出口。
- `SkillsPage/components.test.ts` 覆盖 README 清洗及伪造 marketplace 字段回归边界。
- `pnpm exec tsc --noEmit`、定向测试与 `git diff --check` 通过。

## 未验证边界

尚未对当前运行中的 Gateway 执行目录搜索、ClawHub 详情、实际安装、安全判定或归档上传操作。桌面真机仍需
验证管理员配对、网络失败、风险确认和安装后技能状态刷新；这些结果不能由本机协议源码
或单元测试替代。`skills.skillCard` 已作为已安装技能的独立只读内容入口接入，具体边界见
[OpenClaw 原生技能卡对齐](openclaw-native-skill-card-alignment-2026-08-03.md)。`skills.bins` 及技能提案等其他能力尚未在此页面接入；
`skills.securityVerdicts` 仅覆盖上述已安装 ClawHub 关联项，在取得其他能力的
官方 handler、权限和交互边界前不做推断性扩展。
