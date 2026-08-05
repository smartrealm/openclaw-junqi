# OpenClaw 原生技能生命周期对齐计划

日期：2026-08-03

## 实施顺序

1. 核对官方 Skill Workshop 文档、schema、handler、curator source、权限目录与现有技能页。
2. 在统一技能 runtime 增加 capability 检查、完整 status decoder 与只读请求。
3. 将精确匹配的生命周期状态和 Gateway 汇总投影到已安装列表，保持错误非阻断。
4. 补充 decoder、方法发现遗漏仍请求及实际未知方法边界的回归测试，验证页面未绕过 Gateway runtime。
5. 执行 TypeScript、定向回归、locale、lint、完整测试、链接校验、构建和 diff 检查。

## 文件范围

- `src/services/openclawSkillsRuntime.ts`
- `src/services/openclawSkillsRuntime.test.ts`
- `src/pages/SkillsPage/index.tsx`
- `src/pages/SkillsPage/components.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `docs/quality/openclaw-native-skill-curator-alignment-2026-08-03.md`
- `specs/quality/2026-08-03-openclaw-native-skill-curator.md`
- `plans/quality/2026-08-03-openclaw-native-skill-curator.md`
- 相关索引和既有技能能力文档

## 非目标

- 不接入 curator 的任何写操作或自动 sweep。
- 不接入 proposal create、update、revise、evaluate、apply、reject、quarantine 或事件订阅。
- 不把本地 SkillHub、符号链接、技能卡、安全判定或安装状态伪装为 curator 数据。
- 不声称已完成真实 Gateway 或 macOS、Windows、CentOS、Ubuntu 真机验收。

## 执行结果

1. 已确认 `skills.curator.status` 的 schema、handler、`operator.read` 权限和状态语义。
2. 已完成严格只读 runtime 与已安装技能生命周期投影。
3. 已补充 decoder 与方法发现遗漏仍请求的边界回归，并记录未验证范围。
4. 已通过 TypeScript、定向回归、lint、完整前端测试、官方文档链接、协作包校验、生产构建和
   diff 检查；目标操作系统真机验收仍以验证记录中的未验证边界为准。
