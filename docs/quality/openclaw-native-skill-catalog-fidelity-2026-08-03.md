# OpenClaw 原生技能目录字段对齐

## 依据

本记录不把某个 OpenClaw 安装版本写成 JunQi 的能力契约。实现依据来自 OpenClaw 官方协议、
schema 和 handler：

- [Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [技能协议 schema](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [技能 Gateway handler](https://raw.githubusercontent.com/openclaw/openclaw/main/src/gateway/server-methods/skills.ts)

官方 schema 定义了 `skills.search` 的 `score`、`slug`、`displayName`、可选 `summary`、
`version`、`updatedAt`，以及 `skills.detail` 的 `skill`、`latestVersion`、`metadata` 和
`owner`。detail 的 `skill` 还可能返回 `tags`、`channel`、`isOfficial`、`createdAt` 和
`updatedAt`。这些字段由 OpenClaw 返回时才可进入 JunQi 展示。

## 原问题

Gateway 技能目录已经使用原生 `skills.search/detail`，但页面模型仍沿用 marketplace 数据
结构，把官方没有返回的下载量、星标、安装量、README、版本历史、CLI 安装命令和 ClawHub
页面 URL 填成零值、空值或猜测值。这会把“当前未知”错误呈现为“真实为零”，也会把 JunQi
自己的目录假装成 OpenClaw 能力。

## 当前行为

- `src/services/openclawSkillsRuntime.ts` 严格校验 search/detail 的官方字段；缺少必需字段或
  字段类型错误时丢弃该结果，不生成默认数值。
- `src/pages/SkillsPage/index.tsx` 只把 Gateway 返回的字段映射为 UI 模型。详情请求失败时
  保留搜索结果，不补空 README、空版本记录或伪造来源链接。
- `src/pages/SkillsPage/components.tsx` 展示检索分数、真实版本、更新时间、owner、官方
  metadata、tags、channel 和 latest changelog；安装命令与外部链接仅在调用方提供真实值
  时显示。
- README 清洗逻辑仍保留，以便未来官方返回可渲染内容时不把未清洗 HTML 直接插入 DOM。
- `/skill-hub` 仍是 JunQi 本地目录和符号链接工具，不与 Gateway 技能目录混合。

## 边界

本次不接入 `skills.bins`、`skills.skillCard`、技能提案或安全审计协议，也不把本地 SkillHub
字段投影到 Gateway 页面。后续接入必须先核对官方 handler、权限、能力广告和错误返回；没有
权威依据时保持不可用，不猜测字段或状态。

## 验证

- `pnpm exec tsc --noEmit`
- `node --import ./test-setup.ts --import tsx --test src/services/openclawSkillsRuntime.test.ts src/pages/SkillsPage/components.test.ts src/pages/SkillsPage/skillsGatewayBoundary.test.ts`
- `git diff --check`
- 三种 locale JSON 解析通过。

## 未验证边界

尚未连接真实 Gateway 做目录搜索、详情读取或安装；网络、管理员配对、ClawHub 风险确认和
安装后状态刷新仍需桌面真机验证。自动化结果不等价于 Windows、macOS、CentOS 或 Ubuntu
上的真实运行结果。
