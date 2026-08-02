# 定时任务 OpenClaw Agent 路由验证

日期：2026-08-02

## 实现结果

- 定时任务创建表单可以选择 `agents.list` 中的 Agent。
- 快速模板使用同一 Agent 选择。
- 任务列表和详情显示已存储的 `agentId`；未固定时显示默认智能体。
- 详情可以通过 `cron.update` 固定 Agent，或发送 `agentId: null` 清除固定值。
- Agent 选择器复用 `src/components/ui/select.tsx` 的 Radix Select，并使用 Aegis surface、border、text 和 primary focus token。
- 保存 Agent 时选择器保持用户刚选的值；失败时回退到 Gateway 返回值并在控件旁内联报错。
- 创建对话框补充 dialog 语义、可访问标题、关闭按钮名称、Escape 行为、焦点样式和窄窗口滚动边界。
- 根级 `AGENTS.md` 已增加 UI 主题与交互一致性规则，约束后续主题 token、共享组件、完整交互状态、可访问性、响应式和验证要求。
- 定时任务页面、快速模板和日历提醒的 `cron.add` 均改为官方顶层参数，不再使用 `{ job: ... }`。
- 所有 JunQi agent-turn 创建入口显式发送 `sessionTarget: "isolated"`、`wakeMode: "now"` 和 `delivery: { mode: "none" }`。

## 协议验证

使用当前锁定 OpenClaw `2026.7.1` 导出的 `validateCronAddParams` 和 `validateCronUpdateParams` 检查代表性参数：

- 带 `agentId: "ops"` 的创建参数通过；
- 带 `agentId: null` 的更新 patch 通过。

npm `latest` `2026.7.1-2` 的 cron 文档与本地 `2026.7.1` 文档在 Agent 选择章节无差异。

## 自动化结果

- cron contract、Agent 状态、安装 Shell 布局、维护页面和 Gateway data 定向测试：13/13 通过。
- `pnpm lint`：通过。
- 模块边界：723 个文件通过。
- release version consistency：四处版本均为 `1.5.6`。
- TypeScript：通过。
- 三种 locale JSON 解析：通过。
- `git diff --check`：通过。

## 完整测试边界

`pnpm test` 在整改后重新执行，结果为 2200 通过、13 失败，仍由本任务外的 voice source-contract 与 Gateway credential-security 回归阻塞；cron、Agent 状态与安装 Shell 布局定向测试全部通过：

- 4 项 voice source-contract 回归，包括 CHAT-09、BUG-08、BUG-09 和 BUG-21；
- 9 项 Gateway credential-security 回归。

失败引用 `src/services/voice/voiceAuditRegression.test.ts`、Chat voice 路径检查和 `src/services/gateway/gatewayCredentialSecurity.test.ts`。本次没有修改相关 voice 或 credential-security 实现。Cron 相关定向测试均通过，不能把完整前端套件描述为通过。

## AGENTS.md 复审整改

复审发现的 BUG-CRON-04 至 BUG-CRON-10 已完成代码整改：

- Agent 请求失败、加载中、真实空列表和正常数据已有独立状态；失败可就地重试。
- `cron.update` 后要求刷新成功并确认目标任务的 Agent 值；读回失败不再静默显示旧快照。
- 已删除或未知 Agent 在 Select 中保留为不可用当前项。
- 快速模板和创建任务均复用 Radix Dialog，模板在窄窗口使用单列布局。
- cron 新增测试改为纯函数行为测试，不再读取 Cron 页面源码守护变量名或调用文本。
- 三个修改后的 locale 完整文件禁用符号扫描为零匹配。

自动化证明了协议、状态判定和结构边界；真实主题、焦点和 Gateway 行为仍按下节列为未验证。

## 未验证

- 未连接真实 Gateway 创建、修改或运行任务。
- 未验证指定非默认 Agent 后的实际 workspace、模型、技能和工具策略。
- 未验证应用重启后的任务持久化和 Agent 显示。
- 未在亮色和暗色主题下进行视觉检查。
- 未验证键盘焦点进入、焦点约束、Escape 和焦点归还。
- 未验证窄窗口中的模板单列布局和提交按钮可达性。
- 未验证 Agent 加载失败、真实空列表和 cron 读回失败界面。
- 未接入官方 cron 的完整 schedule、delivery、model、failure alert、command、trigger、status 和 runId 轮询能力。
