# 会话渠道来源呈现实计划

## 实施步骤

1. 核对当前 OpenClaw 文档、Gateway 会话投影和 `Session` 类型，确认可用来源字段。
2. 建立独立的纯渠道来源投影，集中字段优先级、显示标识和未知渠道回退。
3. 建立独立图标组件，已知渠道使用本地图标库，未知渠道使用通用图标。
4. 将侧栏会话行接入投影与三语辅助文案，保持 Agent 作为次级身份。
5. 添加投影行为测试并执行 TypeScript 检查。

## 文件范围

- `src/utils/sessionChannelPresentation.ts`
- `src/utils/sessionChannelPresentation.test.ts`
- `src/components/shared/SessionChannelIcon.tsx`
- `src/components/Layout/NavSidebar.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
