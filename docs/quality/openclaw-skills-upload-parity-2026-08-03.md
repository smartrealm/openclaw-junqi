# OpenClaw 技能归档上传能力对齐

日期：2026-08-03

## 依据

- 本机安装的 OpenClaw `2026.7.1-2`（源码目录 `/Users/wei/.npm-global/lib/node_modules/openclaw`）。
- 随包 schema `dist/schema-DtyqV_v0.d.ts` 定义 `skills.upload.begin`、`skills.upload.chunk`、`skills.upload.commit`，并定义 `skills.install` 的 `source: "upload"` 分支。
- 随包 handler `dist/skills-ieKSTXPw.js` 定义 256 MiB 归档上限、每块 4 MiB 解码上限、上传 TTL、顺序 offset、SHA-256 校验和 `skills.install.allowUploadedArchives` 配置门禁。

## 原问题

JunQi 已经通过 `skills.status`、`skills.search`、`skills.detail` 和 ClawHub 形式的 `skills.install` 管理 Gateway 技能，但技能页没有官方归档上传入口。旧的本地 ZIP 导入语义不能直接写入当前 Gateway workspace，也不能据此声称远端安装成功。

## 目标行为

- 技能页的已安装视图提供 ZIP 归档上传入口，用户明确填写 Gateway 使用的 skill slug。
- 客户端先用 SHA-256 和 `skills.upload.begin` 创建或恢复上传，再按 3 MiB 解码块调用 `skills.upload.chunk`，最后调用 `skills.upload.commit`。
- commit 返回的 `uploadId`、`receivedBytes` 和 SHA-256 必须与本地归档一致；校验通过后才调用 `skills.install` 的 `source: "upload"` 分支。
- 所有上传和安装变更均使用一次性 `callPrivileged`，不把归档内容、Gateway token 或凭据写入 localStorage、日志或 Markdown。
- UI 显示阶段与进度，失败时显示真实 Gateway 错误；不把失败当成成功，也不伪造远端删除。当前协议没有上传删除 command，未完成或失败的临时归档由 OpenClaw 的 TTL 清理。
- `force` 只在用户明确勾选时发送，slug 校验与 OpenClaw 当前规则一致：ASCII 字母、数字和连字符，且不能以连字符开头或结尾。

## 实现位置

- `src/services/openclawSkillsRuntime.ts`：上传分块、哈希、响应校验和 `source: "upload"` 安装。
- `src/pages/SkillsPage/SkillArchiveUploadPanel.tsx`：ZIP 选择、slug、替换选项、进度和错误状态。
- `src/pages/SkillsPage/index.tsx`：在已安装技能视图挂载上传入口。
- `src/services/openclawSkillsRuntime.test.ts`：分块顺序、哈希确认、异常 offset 和非法 slug 回归测试。

## 验证结果

本记录创建后需执行：技能运行时定向测试、TypeScript 检查、lint、生产构建和 `git diff --check`。当前没有在真实 Gateway 上上传归档，也没有在 Windows、Linux 或 macOS 真机上完成技能页手工验收。

## 未验证边界

- Gateway 配置未启用 `skills.install.allowUploadedArchives` 时，真实服务会拒绝安装；JunQi 只展示该错误，不代替用户修改配置。
- 远端上传临时目录的 TTL 和重启后的恢复由 OpenClaw 管理，当前 JunQi 没有上传取消或删除 RPC，因此不能提供本地“清理远端归档”的假动作。
- ZIP 内部必须满足 OpenClaw 的技能归档结构和安全策略，JunQi 不在上传前复制一套归档解析器。
