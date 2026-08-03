# OpenClaw 上下文压缩追溯实施计划

## 实施顺序

1. 核对当前 `SemanticBlock`、`ResponseGroup` 和追溯节点投影，确认压缩事件已有真实来源。
2. 扩展追溯节点联合类型和节点卡，不增加 Gateway RPC 或本地压缩逻辑。
3. 增加来源标识、顺序和多语言回归测试。
4. 运行追溯定向测试、TypeScript 检查、边界检查和全量测试。
5. 记录真实 Gateway、跨平台和视觉验收尚未覆盖的边界。

## 文件范围

- `src/components/Chat/chatResponseTrace.ts`
- `src/components/Chat/ChatResponseTraceNodeCard.tsx`
- `src/components/Chat/chatResponseTrace.test.ts`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 对应 `docs/`、`specs/`、`plans/` 记录
