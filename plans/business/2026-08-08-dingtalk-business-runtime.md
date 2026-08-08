# 钉钉业务工作台运行时实施计划

日期：2026-08-08

状态：阶段 1、阶段 2 已实现；阶段 0 与真实租户验收仍待完成

## 实施原则

- 先完成可复现契约实验，再写生产业务工具。
- 先交付 readiness 与只读端到端链路，再开放写操作。
- 每个阶段删除被替代的旧实现，不保留 Tauri 直连、Chat bridge 或多平台静态目录兼容路径。
- 任何阶段发现官方 schema、源码与运行结果冲突时，先记录差异并停止受影响实现。

## 阶段 0：DWS 与 OpenClaw 契约实验

- [ ] 在隔离环境安装正式 DWS 发布包，记录来源、校验、版本和目标平台。（官方源码已核对，正式发布包待验证）
- [ ] 运行并脱敏保存 `auth status`、`profile list` 和首批 product compact schema 样本。
- [ ] 获取首批 leaf full schema，确认 parameters、required、effect、risk、confirmation、idempotency 和 interface binding。
- [ ] 复现 DWS 正常读取、认证失败、参数失败、超时、取消与 recovery event。
- [ ] 在测试 OpenClaw Gateway 注册最小探针插件，验证动态工具、optional 工具、`tools.effective`、`tools.invoke` 和插件审批。
- [ ] 将证据写入新的 validation 文档；未取得真实样本的字段保持待验证。

完成门禁：只有真实发布包和真实 Gateway 的最小只读工具往返成功后进入阶段 1。

## 阶段 1：插件运行时骨架

目标文件范围：

```text
packages/junqi-dingtalk/
  openclaw.plugin.json
  package.json
  src/index.ts
  src/runtime-probe.ts
  src/profile-repository.ts
  src/schema-catalog.ts
  src/tool-registry.ts
  src/command-runner.ts
  src/approval-policy.ts
  src/result-normalizer.ts
  src/*.test.ts
```

- [x] 创建独立 OpenClaw 插件包与最小 manifest，不修改 `junqi-collab` 领域模型。
- [x] 实现受控 DWS 路径解析、运行时身份、版本与 auth probe。
- [x] 实现精确 profile 读取和显式选择，不自动持久切换 DWS 默认 profile。
- [x] 实现按 leaf schema 读取、摘要校验和漂移失败关闭。
- [x] 实现无 shell 的参数数组 runner、强制 JSON、输出上限、超时、取消和环境边界。
- [x] 实现固定工具 allowlist 与 schema 漂移失败关闭。
- [x] 实现 `before_tool_call` 写操作审批，固定 `allow-once` 与 `deny`。
- [x] 实现结构化错误、恢复事件与脱敏输出。
- [x] 加入 workspace 构建、测试、校验、打包和资源同步流程。

完成门禁：DWS 缺失、auth 无效、profile 未选、schema 漂移和非法输出的契约测试全部通过。

## 阶段 2：JunQi 单平台运行时接入

目标文件范围：

```text
src/business-applications/
src/pages/BusinessApplicationsPage.tsx
src/components/BusinessApplications/
src/services/gateway/
src/stores/
src/locales/
```

- [x] 将已确认 HTML 布局迁移到生产组件，复用 `aegis-*` token 和现有共享控件。
- [x] 绑定当前真实 Session、Gateway identity 和现有 `tools.effective` store。
- [x] 只投影 `junqi-dingtalk` 插件工具，不从静态 catalog 生成可用状态。
- [x] 复用 `invokeOpenClawTool`，不新增第二个 Gateway requester。
- [x] 接入 OpenClaw 工具调用与本地脱敏活动投影；正式审批状态仍以 Gateway 事件为准。
- [x] 新增不保存参数和原始输出的 `BusinessActivityProjection`，明确非 transcript 权威。
- [x] 删除旧 Chat bridge、静态 Journal、飞书与 Google descriptor、专属测试和无引用导出。
- [ ] 若当前 edition 只有钉钉一个真实消费者，不新增一值平台配置；第二个平台真实实现时再引入单选配置。

完成门禁：页面在无插件、无 DWS、无 auth、无 profile、无有效工具和 Gateway 断开时均如实显示；`git diff` 中不存在旧双轨调用。

## 阶段 3：只读 MVP

- [ ] 身份：当前用户与 profile 摘要。
- [ ] 通讯录：用户搜索、部门搜索、部门成员。
- [ ] OA：可见表单、表单 schema、待办、我发起的、详情、任务与记录。
- [ ] 考勤：我的考勤、月度汇总、班次、规则与假期余额。
- [ ] 日历：日历与事件列表、详情、忙闲、会议室查询。
- [ ] 待办：列表与详情。
- [ ] 为每个领域补充 list/detail parser、空态、分页、观察时间与错误状态测试。
- [ ] 在真实测试租户执行最小读取验收并记录权限范围。

完成门禁：所有只读能力均从 `tools.effective` 可见、通过 `tools.invoke` 执行，并可在 UI 与 Chat 中取得一致结构结果。

## 阶段 4：中风险写入

- [ ] 待办创建、更新、完成。
- [ ] 日程创建、更新、参会人变更和响应。
- [ ] 为每个动作实现操作计划、一次性审批、进行中去重、正式结果和权威重读。
- [ ] 覆盖拒绝、超时、无审批路由、断线、响应丢失和重读失败。

完成门禁：未知结果不重放、不显示成功；实体重读能收敛或明确保留待核验。

## 阶段 5：高风险业务动作

- [ ] OA 表单 schema 到动态草稿表单的映射验证。
- [ ] OA 流程预测和 `create-instance` 发起链路。
- [ ] OA 同意、拒绝、撤销、转交、评论与抄送。
- [ ] 待办删除、日程删除及其他 destructive 操作。
- [ ] 为 `non_idempotent` 和 `unknown` 操作建立响应丢失后的人工对账流程。
- [ ] 验证 DWS recovery plan/execute/finalize 的展示与明确用户触发边界；不自动恢复。

完成门禁：真实测试租户完成最小高风险操作验收、权威重读和审计核对，且没有保存敏感正文或凭据。

## 每阶段验证

按改动范围至少执行：

```bash
pnpm lint
pnpm test
pnpm build
pnpm collab:validate
git diff --check
```

新增插件包后补充其独立 `test`、`build`、`validate` 和 package 内容检查。涉及 Rust 或 Tauri 时再执行对应 Rust 命令；本规划本身不授权新增 Tauri DWS command。

UI 真机验收必须覆盖亮色、暗色、键盘焦点、窄窗口、审批弹层、Gateway 断开和减少动态效果。真实钉钉租户、Windows、Linux、Docker Gateway 未验证时必须单独列出，不能合并描述为已完成。
