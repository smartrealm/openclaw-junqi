# 主题 Token 收敛计划

日期：2026-08-04

## 实施顺序

1. 在四个具体主题中补齐共享阴影、遮罩、状态和萌宠文字 token。
2. 将 Tailwind 阴影与仍在迁移中的旧语义 palette 绑定到 Aegis token。
3. 迁移工作台、终端、Git diff、动态岛和文件预览等高频 chrome。
4. 让 xterm 主题构建器按当前文档主题生成，并在主题变化时原地刷新。
5. 增加运行时覆盖、Tailwind 桥和固定颜色预算测试。
6. 运行边界检查、类型检查、前端测试和生产构建。

## 文件范围

- `src/styles/themes/`
- `src/styles/index.css`
- `src/styles/terminal.css`
- `src/styles/terminal-kooky.css`
- `src/pages/AgentWorkspace/`
- `src/pages/TerminalPage/`
- `src/components/Terminal/`
- `src/components/Git/`
- `src/components/FileExplorer/`
- `src/components/GatewayErrorScreen.tsx`
- `src/dynamic-island/`
- `src/pet/`

## 验证

最小验证为主题覆盖、Tailwind 桥、产品 chrome 颜色预算和萌宠对比度测试；完成实现后追加 `pnpm lint`、`pnpm test`、`pnpm build` 与 `git diff --check`。目标平台的原生窗口视觉验证单独记录，不以本机浏览器预览替代。
