# OpenClaw 原生技能目录字段对齐

## 依据

本记录不把某个 OpenClaw 安装版本写成 JunQi 的能力契约。实现依据来自 OpenClaw 官方协议、
schema 和 handler：

- [Gateway protocol](https://github.com/openclaw/openclaw/blob/main/docs/gateway/protocol.md)
- [技能协议 schema](https://raw.githubusercontent.com/openclaw/openclaw/main/packages/gateway-protocol/src/schema/agents-models-skills.ts)
- [技能 Gateway handler](https://raw.githubusercontent.com/openclaw/openclaw/main/src/gateway/server-methods/skills.ts)
- [技能 status source](https://raw.githubusercontent.com/openclaw/openclaw/main/src/skills/discovery/status.ts)
- [ClawHub 安全判定 source](https://raw.githubusercontent.com/openclaw/openclaw/main/src/skills/security/clawhub-verdicts.ts)

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
  字段类型错误时丢弃该结果，不生成默认数值。`skills.status` 同样要求官方
  `SkillStatusEntry` 的名称、描述、source、disabled、eligible 和 userInvocable；版本只
  从官方 `clawhub.installedVersion` 读取。
- `src/pages/SkillsPage/index.tsx` 只把 Gateway 返回的字段映射为 UI 模型。详情请求失败时
  保留搜索结果，不补空 README、空版本记录或伪造来源链接。
- `src/pages/SkillsPage/components.tsx` 展示检索分数、真实版本、更新时间、owner、官方
  metadata、tags、channel 和 latest changelog；安装命令与外部链接仅在调用方提供真实值
  时显示。
- 已安装列表通过原生 `skills.securityVerdicts` 读取安全判定；只按 `slug` 或 `requestedSlug`
  与 status `skillKey` 精确关联，只有官方 `securityPassed` 明确为布尔值时显示通过或未通过
  图标。安全 RPC 失败以非阻断提示呈现，未返回或未匹配的技能不显示伪造结论。
- README 清洗逻辑仍保留，以便未来官方返回可渲染内容时不把未清洗 HTML 直接插入 DOM。
- `/skill-hub` 仍是 JunQi 本地目录和符号链接工具，不与 Gateway 技能目录混合。

## 边界

本次不接入 `skills.bins` 或技能提案，也不把本地 SkillHub 字段投影到
Gateway 页面。`skills.securityVerdicts` 仅覆盖已安装且有 ClawHub 链接的技能，不代表目录
搜索项的安全结论。后续能力接入必须先核对官方 handler、权限、能力广告和错误返回；没有权威
依据时保持不可用，不猜测字段或状态。

`skills.skillCard` 已在已安装列表独立接入，且只显示其官方返回的纯文本内容；具体的协议、
路径处理和验证边界见 [OpenClaw 原生技能卡对齐](openclaw-native-skill-card-alignment-2026-08-03.md)。

## 验证

- `pnpm exec tsc --noEmit`
- `node --import ./test-setup.ts --import tsx --test src/services/openclawSkillsRuntime.test.ts src/pages/SkillsPage/components.test.ts src/pages/SkillsPage/skillsGatewayBoundary.test.ts`
- `git diff --check`
- 三种 locale JSON 解析通过。

## 未验证边界

尚未连接真实 Gateway 做目录搜索、详情读取、安装或安全判定；网络、管理员配对、ClawHub
风险确认和安装后状态刷新仍需桌面真机验证。自动化结果不等价于 Windows、macOS、CentOS
或 Ubuntu 上的真实运行结果。
