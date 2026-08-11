# 依赖安全收敛规格

## 目标

使项目锁定的 pnpm 9 依赖图不再包含本轮 Dependabot 和 npm audit 报告的公开漏洞版本，同时保持 OpenClaw 官方包和 JunQi 运行时边界不变。

## 验收条件

1. `package.json` 中的直接依赖满足对应公告修复下限。
2. `pnpm-lock.yaml` 中的 OpenClaw 传递依赖不再解析到受影响的 `@hono/node-server`、`tar` 和 `undici` 版本。
3. 用 `pnpm@9.15.9` 执行冻结安装后，`pnpm audit --json` 的低、中、高、严重计数均为零。
4. 依赖调整不改变 OpenClaw Gateway RPC、插件清单、配置或本地业务语义。

## 非目标

- 不升级或替换 OpenClaw Runtime。
- 不根据客户端推测未发布的 OpenClaw 能力。
- 不把本地审计结果表述为远端 Dependabot 已完成重新扫描。
