# OpenClaw 原生技能卡对齐计划

日期：2026-08-03

## 实施顺序

1. 核对官方 schema、Gateway handler、方法权限目录和官方 UI 对 `skills.skillCard` 的读取行为。
2. 在统一技能运行时增加能力广告查询、严格回包解码和只读请求，不把路径暴露给页面。
3. 在已安装技能行接入按需查看入口，复用既有 Dialog、主题 token、错误和焦点语义。
4. 补充解码、明确不支持和只读请求的回归测试；验证既有页面 Gateway 边界未被绕过。
5. 执行 TypeScript、lint、前端测试、构建、文档链接、协作包校验和 diff 检查，记录真机边界。

## 文件范围

- `src/services/openclawSkillsRuntime.ts`
- `src/services/openclawSkillsRuntime.test.ts`
- `src/pages/SkillsPage/index.tsx`
- `src/pages/SkillsPage/components.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- `docs/quality/openclaw-native-skill-card-alignment-2026-08-03.md`
- `specs/quality/2026-08-03-openclaw-native-skill-card.md`
- `plans/quality/2026-08-03-openclaw-native-skill-card.md`
- 相关索引和既有技能能力文档

## 非目标

- 不接入 `skills.bins`、curator 或技能提案协议。
- 不读取、写入、复制或删除 Gateway workspace 中的技能文件。
- 不展示回包的绝对路径，不创建本地缓存，不把卡片内容写入 transcript。
- 不声称已完成真实 Gateway、macOS、Windows、CentOS、Ubuntu 的真机验收。

## 执行结果

1. 已确认官方 schema、handler、`operator.read` 权限目录与官方 UI 的请求模型一致。
2. 已实现严格 Gateway 技能卡读取，只有 Gateway 明确未广告时才禁用入口。
3. 已实现已安装技能的只读纯文本对话框，保留主题、键盘与错误状态。
4. 已补充服务层回归；页面保持统一服务边界。
5. 已通过 TypeScript、定向回归、lint、完整前端测试、官方文档链接、协作包校验、生产构建和
   diff 检查；目标操作系统真机验收仍以验证记录中的未验证边界为准。
