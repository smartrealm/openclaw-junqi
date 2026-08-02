# 首次安装底部操作区响应式修复计划

1. [x] 核对储存步骤的加载状态、回退保护和共享底部操作容器。
2. [x] 将窄窗口底栏切换为稳定的纵向分区，保留桌面左右布局。
3. [x] 添加渲染结构回归检查并记录未完成的桌面人工验收。

## 验证

```bash
node --import ./test-setup.ts --import tsx --test src/components/setup/SetupFlowPanels.test.tsx
pnpm exec tsc --noEmit
pnpm build
git diff --check
```
