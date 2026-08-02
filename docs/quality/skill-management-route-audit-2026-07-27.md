# 技能管理入口与双路由审计

## 问题

侧栏、欢迎页和智能体详情中的“技能管理”入口跳转到 `/skill-hub`。该页面的源码注释明确将其定义为从早期 JunQi/Nezha 架构移植的伴生工具，并说明界面刻意保持简陋；它只负责扫描指定 Hub 目录，以及把技能以符号链接安装到 Claude/Codex 项目。

项目同时保留了 `/skills` 完整技能中心。该页面才包含用户预期的已安装技能列表、启停、删除、本地目录/ZIP 导入、分享包，以及 SkillHub/ClawHub 浏览和安装流程。普通入口被指向伴生工具后，用户看到英文路径表单和低层项目 ID，而不是既有的技能管理 UI。

## 依据

- `src/pages/SkillHubManager.tsx`：文件头将页面描述为 `minimal` companion view，并经 `skillHubRuntime` 调用 `get_skill_hub_config`、`list_skills`、`install_skill` 等本地目录/符号链接 commands。
- `src/pages/SkillsPage/index.tsx`：定义 `my`、`skillhub`、`clawhub` 三个视图，并实现已安装技能启停、删除、本地导入和市场安装。
- `src/components/shared/AppSettingsDialog.tsx`：已提供 Skill Hub 根目录的选择和清除操作，因此普通用户无需进入伴生页才能设置 Hub 路径。
- Git 历史 `2dda64b`：引入 `SkillHubManager` 时，源码已经说明它不与完整 `SkillsPage` 竞争；后续入口却逐步指向了该伴生页。

## 目标行为

- 所有标为“技能管理”或“管理”的普通入口统一打开 `/skills`。
- `/skill-hub` 路由和实现继续保留，作为已有项目符号链接安装的高级兼容入口，避免删除独有能力或破坏书签。
- 不合并两套后端语义：OpenClaw Gateway 管理的技能继续由 `/skills` 负责，JunQi 本地 Hub 的项目链接继续由 `/skill-hub` 负责。

## 验证

- `SkillManagementNavigation.test.ts` 锁定侧栏、欢迎页和智能体页不再导航到 `/skill-hub`。
- 同一测试确认 `/skills` 与 `/skill-hub` 两条路由仍同时存在。
- 定向技能管理测试 5 项通过。
- `pnpm test`、`pnpm lint` 和 `pnpm build` 通过。
- 本地 Vite 服务已在 `http://127.0.0.1:5173/` 启动；当前执行会话没有可用的内置浏览器连接，因此未完成截图级视觉验收。

## 未变更边界

- 未修改技能安装、卸载、冲突解决或 Gateway RPC。
- 未删除 `SkillHubManager` 和对应 Tauri commands。
- 未对 SkillHub/ClawHub 第三方服务协议作任何推断或变更。
- 本地 Hub command 的 renderer 参数与返回 DTO 统一定义在 `src/api/tauri-commands.ts`，页面不直接调用 Tauri `invoke`；欢迎页的本地技能计数复用同一 typed command。

## 2026-08-02 后续记录

该审计中的 `/skills` 市场、导入和删除描述已不再代表当前实现。当前安装 OpenClaw
Gateway 没有对应删除或本地导入 command，因此 `/skills` 仅展示 Gateway 声明的
status、search、detail、update 与 install 能力。完整依据和验证边界见
[`openclaw-skills-runtime-convergence-2026-08-02.md`](openclaw-skills-runtime-convergence-2026-08-02.md)。
