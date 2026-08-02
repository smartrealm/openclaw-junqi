# OpenClaw 原生技能目录字段对齐计划

## 实施顺序

1. 以 OpenClaw 官方 protocol、schema、handler 和安全判定 source 核对
   `skills.search/detail/securityVerdicts` 字段与权限。
2. 收紧 `src/services/openclawSkillsRuntime.ts` 的 status/search/detail/securityVerdicts
   归一化器，拒绝非法必需字段并保留官方可选字段。
3. 更新 `src/pages/SkillsPage/index.tsx` 与 `components.tsx`，移除伪造 marketplace 字段，
   只渲染真实搜索分数、时间、版本、owner、metadata、changelog 和已安装技能的安全判定。
4. 更新三种 locale、运行时测试、页面边界测试与 `docs/`、`specs/` 记录。
5. 运行类型检查、定向测试、全量 lint/test/build、官方文档链接校验和 diff 检查。

## 文件范围

- `src/services/openclawSkillsRuntime.ts`
- `src/services/openclawSkillsRuntime.test.ts`
- `src/pages/SkillsPage/index.tsx`
- `src/pages/SkillsPage/components.tsx`
- `src/pages/SkillsPage/components.test.ts`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `docs/quality/`
- `specs/quality/`
- `plans/quality/`

## 验证与边界

自动化验证只能证明字段归一化和页面边界；真实 Gateway 搜索、ClawHub 详情、管理员安装、
安全判定、网络失败和跨平台桌面行为必须另行实测。`skills.securityVerdicts` 不覆盖目录搜索
项；未取得官方依据的 `skills.bins`、`skills.skillCard` 和提案能力保持未接入。
