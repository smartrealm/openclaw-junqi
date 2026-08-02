# OpenClaw 技能归档上传实施计划

## 实施顺序

1. 以 OpenClaw 官方 protocol、schema、上传存储和安装 handler 核对字段、权限、大小、TTL
   与错误边界。
2. 在 `openclawSkillsRuntime` 集中实现 SHA-256、分块上传、回执校验和 uploaded archive
   安装，保持 ClawHub 与本地 SkillHub 边界不变。
3. 在技能页已安装视图增加桌面 WebView ZIP 选择、slug、force、进度和错误/成功状态。
4. 补充技能运行时回归测试，覆盖多块归档、异常 offset、非法 slug、哈希和安装确认。
5. 更新 docs/specs 索引，运行类型检查、定向测试、lint、完整测试、build、官方文档链接和
   diff 检查。

## 文件范围

- `src/services/openclawSkillsRuntime.ts`
- `src/services/openclawSkillsRuntime.test.ts`
- `src/pages/SkillsPage/SkillArchiveUploadPanel.tsx`
- `src/pages/SkillsPage/index.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `docs/quality/openclaw-skills-upload-parity-2026-08-03.md`
- `specs/quality/2026-08-03-openclaw-skills-upload.md`
- `plans/quality/2026-08-03-openclaw-skills-upload.md`

## 验证与边界

自动化验证只能证明字段、权限出口、分块和页面状态；真实 Gateway 上传、管理员配对、配置
门禁、网络失败和 Windows/Linux/macOS 桌面行为仍需另行实测。未取得官方取消或删除协议前，
保持不接入。
