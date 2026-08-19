# OpenClaw 运行时命令导航

日期：2026-08-19

## 上游依据

OpenClaw Gateway 官方 `commands.list` 是按 Agent、Provider、Scope 返回运行时命令目录的 `operator.read` 方法。官方协议明确 `category`、`textAliases`、`nativeName` 与参数详情都由 Gateway 返回；JunQi 不维护本地命令注册表。

## 当前行为

运行时命令页和左侧导航分别读取当前会话 Agent 的 `commands.list` 目录，并以 Gateway 返回的 `category` 分组。导航项的命令数量和类别均来自该响应；没有 `category` 的条目显示为“未分类”。点击类别只定位到页面中对应的真实命令分区，不调用命令、不改变会话，也不将类别推断为命令可执行性。

连接断开、目录读取中、Gateway 不支持该方法或返回不可验证内容时，左侧保留对应的真实状态说明，不显示本地伪造的类别或命令。

## 验证

- 分组回归测试覆盖 Gateway 已返回类别和缺失类别的保留行为。
- `pnpm lint`、`pnpm test`、`pnpm build` 和 `git diff --check` 已执行通过。

## 未验证边界

- 本次未在不同 Gateway Provider 和所有命令类别上完成真机点击定位验收；类别和数量仍完全由实际 `commands.list` 响应决定。
