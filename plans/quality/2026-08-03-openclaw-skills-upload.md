# OpenClaw 技能归档上传实施计划

1. 核对本机 OpenClaw schema、上传存储 handler、安装策略和 chunk 限制。
2. 在 `openclawSkillsRuntime` 集中实现 SHA-256、分块上传、回执校验和 uploaded archive 安装。
3. 在技能页已安装视图增加 ZIP 选择、slug、force、进度和错误/成功状态。
4. 补充技能运行时回归测试，覆盖多块归档、异常 offset、非法 slug 和安装确认。
5. 更新 docs/specs 索引，运行定向测试、TypeScript、lint、build 和 diff 检查。

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
