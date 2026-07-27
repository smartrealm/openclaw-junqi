@AGENTS.md

# Claude Code Project Instructions

上面的 `AGENTS.md` 是本仓库所有编码代理共享的规范，必须完整遵守。本文件只补充 Claude Code 专属约定，避免两套工程规则产生漂移。

## 工作方式

- 对跨前端/Rust、安装、Gateway 生命周期、OpenClaw Wizard、凭据、发布或多文件状态机的改动，先进入 plan mode，完成只读证据收集并写出可验证计划后再编辑。
- 使用 `/context` 可以确认本文件及 `AGENTS.md` 已加载。发现长期有效的项目纠正时，更新 `AGENTS.md` 或对应领域文档，不要只留在 auto memory。
- 多步骤操作必须持续核对任务的最新用户要求。用户要求审查或解释时保持只读；只有明确要求修改、构建或部署时才执行相应写操作。
- `.claude/scheduled_tasks.lock` 是本机运行状态，不是项目规范或业务源码；不要编辑或提交它。
- 不要在 `CLAUDE.md` 重复 `AGENTS.md` 的项目规则。共享规则只维护一份，Claude 专属行为才放在这里。

## 证据与交付

- 引用外部行为时优先给出官方文档或官方源码链接，并在相关 audit/spec/plan/validation Markdown 中保存版本或 commit 依据。
- 使用 subagent 不能替代主会话读取规范文件、确认关键契约和审查最终 diff；对共享工作区中的并行改动保持所有权意识。
- 完成前重新读取 `git status` 和实际验证输出。不要根据命令已启动、文件已生成或子任务已返回就推断成功。

<!--
Claude Code 官方依据：
https://code.claude.com/docs/en/memory
该文档明确建议项目级 CLAUDE.md 保持简洁，并在已有 AGENTS.md 时通过 @AGENTS.md 导入共享规则。
-->
