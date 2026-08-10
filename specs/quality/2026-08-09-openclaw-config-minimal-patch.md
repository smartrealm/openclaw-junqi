# OpenClaw 配置最小补丁写入规格

## 问题

完整 `config.set` 写入会扩大 JunQi 对 OpenClaw 配置的覆盖范围。

## 约束

1. 仅使用官方 `config.patch`。
2. 已存在配置必须使用 `config.get` 返回的 `hash` 作为 `baseHash`。
3. 补丁必须表达用户实际变更；不得提交整份配置作为补丁。
4. 数组替换必须遵循 Gateway 的 `replacePaths` 契约。
5. 失败回执不得更新本地已保存状态。

## 验收

- 单个 `id` 条目编辑不提交同数组的其他条目，且没有 `replacePaths`。
- 条目删除、重排或非 `id` 数组编辑提交完整数组并声明准确替换路径。
- 配置页与渠道配置仓均无 `config.set` 写入入口。
- 回归、类型、构建和边界检查通过。
