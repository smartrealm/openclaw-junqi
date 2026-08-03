# OpenClaw 原生会话分组与 Jarvis 对齐计划

日期：2026-08-03

> 2026-08-04 校正：本计划依赖不存在的 `sessions.groups.*` Gateway 方法，已由
> [`2026-08-04-openclaw-session-category-authority-alignment.md`](2026-08-04-openclaw-session-category-authority-alignment.md)
> 取代；不得继续执行其中的 group catalog 工作项。

## 顺序

- [x] 阅读项目根文档、现有会话组织、Jarvis 唤醒与 Task checkpoint 实现。
- [x] 核对 OpenClaw 当前 groups schema、handler、method descriptor 与 category patch。
- [x] 审计分组 UI、store、Gateway adapter 与 Jarvis 唤醒调用链。
- [x] 将 group client 切换到普通连接，并严格解码官方 catalog/mutation 返回。
- [x] 移除 group/category/pin/unread/archive localStorage fallback，保持能力缺失时失败关闭。
- [x] 让 Jarvis 只写原生 category，并依赖当前官方 patch handler 登记非空 catalog entry。
- [x] 补充回归测试、全量验证、Unicode 扫描与中文提交。

## 文件范围

- `src/services/gateway/OpenClawSessionOrganizationClient.ts`
- `src/services/gateway/OpenClawSessionOrganizationClient.test.ts`
- `src/services/gateway/index.ts`
- `src/stores/chatStore.ts`
- `src/components/Chat/message-input/useComposerVoice.ts`
- 对应测试及 docs/specs/plans 索引

## 不做的事情

- 不把 JunQi localStorage group 提升为 OpenClaw capability。
- 不自行管理另一套 Agent、session 或 wake trigger authority。
- 不为 group catalog 竞争或网络失败编造成功、成员关系或重试结果。
