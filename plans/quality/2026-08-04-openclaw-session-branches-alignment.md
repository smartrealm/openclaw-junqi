# OpenClaw 原生会话分支对齐计划

1. [x] 核对官方 schema、Gateway handler、Control UI 分支重载流程与 JunQi 当前 history/leaf 链路。
2. [x] 新增严格分支列表/切换 client，并与既有会话 mutation 串行器绑定；列表走日常读取连接，
   切换走一次性管理员授权连接。
3. [x] 在会话上下文栏加入按需分支面板、确认切换与成功后的 history/目录重载。
4. [x] 添加协议行为回归与多语言 UI 文案。
5. [ ] 在真实 Gateway 和 macOS、Windows、CentOS、Ubuntu 上验证多客户端分支切换。

## 文件范围

- `src/services/gateway/OpenClawSessionBranchesClient.ts`
- `src/services/gateway/OpenClawSessionBranchesClient.test.ts`
- `src/services/gateway/index.ts`
- `src/hooks/useSessionBranches.ts`
- `src/components/Chat/SessionBranchesControl.tsx`
- `src/components/Chat/SessionContextBar.tsx`
- `src/locales/{zh,en,zh-TW}.json`
