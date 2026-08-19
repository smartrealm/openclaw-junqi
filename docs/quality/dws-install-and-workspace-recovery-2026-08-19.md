# DWS 安装与工作区恢复审计

日期：2026-08-19

## 依据

- [DWS 官方 README](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/README.md) 将 `npm install -g dingtalk-workspace-cli` 列为 Node.js/npm 安装方式；登录仍由官方 `dws auth login` 或 headless 环境的 `dws auth login --device` 承担。
- JunQi 只在已核验的所选 Native 或 Docker OpenClaw 运行时中执行该安装命令，安装后以 DWS 的结构化 JSON 命令核验，不读取或展示凭据。
- Gateway 重启只通过 `gatewayLifecycle.restart` 协调；工作区入口以当前连接的 OpenClaw 会话快照为放行事实。

## 根因

`dws_operation` 原先只转发 npm 的标准输出和标准错误。npm 在下载或解析依赖的静默阶段不会产生行输出，界面只能永久显示“等待输出”。

同一操作的子进程若在前端收到 `start_dws_operation` 返回的 `operationId` 前结束，完成事件会先到达。旧页面丢弃了尚未关联当前弹窗的终态，随后把弹窗写为 `running`，没有任何后续事件可以收敛。

Gateway 重启后的数据轮询还存在独立缺陷：`sessions.list` 返回与重启前相同的会话投影时，数据层只清除 loading 而未更新 `lastFetch.sessions`。工作区首屏门禁将这个时间戳与本次 `connectionStartedAt` 比较，于是把已成功返回的当前快照误判为旧连接数据，持续显示“正在同步工作区”。智能体范围读取失败也会阻断会话读取，但旧失败判定没有将其作为可重试的首屏失败。

## 目标行为

- DWS 子进程成功启动后立即发送本地派生的事实状态；每 15 秒发送一次仍在等待的实际时长。该状态不表示 npm 已完成，也不伪造百分比。
- 输出和完成事件按 `operationId` 缓存。页面建立该操作投影后消费已到达的终态，并只执行一次后续 DWS 配置、统一 Gateway 重启和刷新。
- 每个当前连接的成功 `sessions.list` 快照都更新会话读取时间，即使会话内容没有变化。
- 由于智能体范围是当前会话读取的前置条件，智能体请求在已结算后失败时，首屏显示可重试错误，不能无限显示同步中。

## 验证

- DWS 前端事件缓存回归测试通过，覆盖终态早于启动响应时保留输出与终态。
- Gateway 数据层回归测试通过，覆盖相同会话快照在新连接中仍更新读取时间，以及智能体前置请求失败进入可重试错误。
- Rust DWS 单元测试通过，覆盖凭据输出隐藏、所选 npm 前缀、结构化核验，以及无 npm 输出时的启动和等待状态。

## 未验证边界

- 未在重新打包后的 macOS 应用完成 DWS 安装、授权、Gateway 重启和工作区恢复的连续真机验收。
- 未在 Windows、Linux 或 Docker 真机验证 DWS 安装输出和 DWS 凭据库行为。
