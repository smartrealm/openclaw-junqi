# OpenClaw 核心操作引导审计

## 依据与问题

原首页引导把 Gateway 已返回模型、智能体、会话和渠道等运行时事实显示为用户完成进度，并把 JunQi 终端工作台的“打开项目”混入 OpenClaw 新手流程。集中清单移除后，引导仍在任意目标点击后延迟 120ms 推进，因此打开弹窗被误当成完成，保存失败和会话创建失败也无法阻止跳步。

官方依据：

- OpenClaw Control UI 正式提供模型供应商配置入口：[Model providers](https://docs.openclaw.ai/concepts/model-providers)。
- 渠道账号、运行状态和新增流程属于 OpenClaw 渠道能力：[Channels CLI](https://docs.openclaw.ai/cli/channels) 与 [Configuration — channels](https://docs.openclaw.ai/gateway/config-channels)。
- 独立智能体及其工作区、认证和路由由 OpenClaw 管理：[Agents CLI](https://docs.openclaw.ai/cli/agents)。
- OpenClaw 官方首页将 Control UI 聊天和渠道聊天列为快速开始入口：[OpenClaw Docs](https://docs.openclaw.ai/)。
- OpenClaw 当前配置说明明确区分供应商认证与默认模型选择，重新认证不会覆盖已有 `agents.defaults.model.primary`：[Configure](https://docs.openclaw.ai/cli/configure)。
- OpenClaw 当前 Control UI 以新会话首条消息提交作为会话与运行的真实起点，发送失败时保留原提示并在已有会话上重试：[Control UI](https://docs.openclaw.ai/web/control-ui)。JunQi 现有桌面会话创建交互暂不在本次改写，本引导只消费其真实成功结果。

## 目标行为

- 首页只显示一次简短欢迎起点，不展示任务清单或完成率。
- 主引导固定覆盖供应商入口、真实保存、新建桌面会话、首次消息与首次回复；渠道和智能体作为完成后的独立扩展入口。
- 引导用于教学。已有模型可由用户明确选择继续使用，但只由后续真实回复证明本次端到端链路可用。
- “打开项目”属于 JunQi 终端工作台，不进入 OpenClaw 核心操作引导。
- 渠道配置继续由 OpenClaw 官方流程拥有，引导只定位已有入口。
- 用户跳过或完成欢迎起点后，可通过标题栏指南入口重新打开。
- 目标查找限时八秒，超时显示可重试错误；浮层根据可用空间在目标四周换位，窄窗口保持可达。

## 验证

- 回归覆盖步骤顺序、分类型完成判据、首条回复谓词、位置计算和稳定操作选择器。
- TypeScript、完整前端测试、生产构建和本机界面连续操作结果在本轮结束时记录到 `PROJECT_STATUS.md`。

## 未验证边界

OpenClaw 官方 Control UI 当前把新会话创建与首发合并为一次 `sessions.create`，JunQi 现有桌面会话创建仍是独立动作；本次只修引导，不改变该协议适配。暗色主题、窄窗口、键盘焦点、减少动态效果、供应商 OAuth、渠道授权和不同 Runtime 数据组合仍需在打包应用中逐项实测。
