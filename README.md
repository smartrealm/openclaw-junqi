# JunQi Desktop

JunQi Desktop（浚启桌面）是一款基于 Tauri、React 和 OpenClaw 的桌面 AI 工作台，由陕西浚启智境科技有限公司开发。

它将 OpenClaw 的安装、Gateway 生命周期、智能体、会话、技能、渠道、终端、配置和运行诊断整合到一个跨平台桌面应用中。

> 开发版本以 `package.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 中保持一致的版本字段为准。
>
> 当前仓库为开发仓库；自动化测试通过不等同于所有平台的真机验收完成。

## 主要能力

- **OpenClaw 首次安装**：存储位置、Native/Docker runtime、Node/npm、Git、OpenClaw 与 Gateway 引导。
- **Gateway 生命周期**：启动、停止、恢复、官方服务交接、开机自启动与归属校验。
- **智能体与会话**：智能体配置、会话管理、工作区和活动记录。
- **终端工作台**：集成终端、工作区、Git worktree 与文件浏览。
- **配置中心**：模型 Provider、渠道、Secrets、Agent 和高级配置。
- **技能与协作**：技能管理以及基于 OpenClaw 的持久化多智能体协作。
- **运维诊断**：安装日志、Gateway 恢复、维护中心和运行状态观测。

## 技术栈

- Tauri 2 / Rust
- React 18 / TypeScript
- Vite 6 / Tailwind CSS 4
- pnpm workspace
- OpenClaw Gateway

## 开发环境

建议使用仓库锁定的工具版本：

- Node.js：见 `.tool-versions`
- pnpm：`9.15.9`
- Rust：见 `rust-toolchain.toml`

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

仅启动前端开发服务器：

```bash
pnpm dev
```

## 构建

```bash
pnpm build
pnpm tauri build
```

桌面安装包由 Tauri 构建。当前正式发布覆盖 macOS ARM64/x64 与 Windows x64；Windows 使用 NSIS。

## 验证

```bash
# TypeScript 与模块边界
pnpm lint

# 前端和脚本测试
pnpm test

# Rust 测试
pnpm test:rust
```

提交前至少运行与改动范围对应的定向测试，并执行：

```bash
pnpm lint
pnpm test:rust
git diff --check
```

## 项目结构

```text
src/                  React 前端
src-tauri/            Tauri/Rust 后端与安装器配置
packages/             Workspace packages
scripts/              构建、验证和发布脚本
docs/                 设计、审计和验证记录
specs/                按领域组织的规格与验收条件
plans/                按领域组织的实施计划
.github/workflows/     CI 与发布工作流
```

## 文档

- [文档索引](docs/README.md)
- [规格与验收索引](specs/README.md)
- [实施计划索引](plans/README.md)
- [协作领域术语](CONTEXT.md)
- [中国大陆网络与安装源策略](docs/installation/mainland-china-network-policy.md)
- [Windows 安装阶段全量复审](docs/installation/windows-installation-full-audit-2026-07-24.md)
- [Windows 卸载流程复审](docs/installation/windows-uninstall-flow-audit-2026-07-26.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

`docs/` 保存问题事实、设计和验证结论；`specs/` 定义目标与验收条件；`plans/` 描述实施顺序。历史审计文档不应被当作当前功能承诺，最终状态以代码、测试和对应 validation 文档为准。

## 平台说明

Windows、macOS 和 Linux 的能力可能因系统服务、凭据库、安装器和容器环境不同而存在差异。涉及安装、升级、卸载、系统服务、自启动和凭据存储的改动，必须在目标平台进行真实验收。

## License

本项目采用 [MIT License](LICENSE)。第三方资源许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
