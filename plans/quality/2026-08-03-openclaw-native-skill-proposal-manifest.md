# OpenClaw 原生技能提案清单对齐计划

日期：2026-08-03

## 范围

- `src/services/openclawSkillsRuntime.ts`
- `src/services/openclawSkillsRuntime.test.ts`
- `src/pages/SkillsPage/index.tsx`
- `src/locales/en.json`
- `src/locales/zh.json`
- `src/locales/zh-TW.json`
- 本记录、规格和索引文档

## 实施顺序

1. 核对最新版 OpenClaw Skill Workshop 文档、Gateway schema、handler、权限目录与官方控制台的
   scope 绑定方式。
2. 为 `skills.proposals.list` 增加 capability 查询、完整 manifest decoder 和只读 RPC；明确未
   广告时阻止调用。
3. 在技能页新增条件性只读清单标签，按 Gateway 默认 scope 获取数据，不提供详情或操作。
4. 覆盖 decoder 和调用边界，执行类型、前端测试、lint、文档、构建及 diff 验证。

## 非目标

- 不接入 `skills.proposals.inspect`；agent scope 选择与绑定已在独立的 proposal scope 对齐项中处理，
  detail 的完整内容与安全边界仍需另行审查。
- 不接入 create、update、revise、evaluate、apply、reject、quarantine、history 或 events。
- 不将默认 Gateway scope 描述为当前会话、当前 agent 或本地 `/skill-hub`。
- 不读取、写入或猜测 workspace proposal 文件、运行时路径、权限或跨平台能力。

## 执行结果

1. 已确认 list 的可选 `agentId`、完整 manifest schema、workspace resolver、`operator.read`
   权限以及官方控制台依赖 selected agent scope 后才 inspect 的行为。
2. 已完成严格只读 runtime、条件标签和三语状态呈现；默认读取刻意省略 `agentId`。
3. 已补充完整 decoder、非法枚举、只读调用和方法发现遗漏仍请求的回归。
4. 最终命令验证和目标平台真机边界将在提交记录中按实际结果报告。
